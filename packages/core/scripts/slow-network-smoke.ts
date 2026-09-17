/**
 * 회선이 나쁠 때의 동기화.
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/slow-network-smoke.ts
 *
 * 끊기는 것 자체는 막을 수 없다. 여기서 지키려는 것은 **끊긴 뒤에도 따라잡는가**이다.
 *
 *   1. 한 쪽이 커서 시간 제한에 걸리면 줄여서 다시 청한다. 줄이지 않으면 같은 크기로
 *      영영 다시 시도해, 느린 회선의 기기는 첫 쪽을 넘지 못한다.
 *   2. 밀어 올리는 묶음도 같다. 여러 날치를 한 요청에 밀면 늘 끊기고, 그 기기는 적어 둔
 *      것을 영영 올리지 못한다.
 *   3. 한 번의 동기화가 큐를 끝까지 비운다. 묶음보다 긴 큐가 남아 다음 기회를 기다리면
 *      그 "다음"이 언제인지는 아무도 모른다.
 *   4. 정말로 네트워크가 없으면 오프라인으로 끝나고 **큐는 그대로 남는다.**
 */
import { setRandomBytes, type SyncDto } from '@money/types';

import { LocalStore } from '../src/data/local-store';
import { syncProject } from '../src/data/sync-engine';
import { nodeSqliteDriver } from './node-sqlite-driver';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

const KST = 'Asia/Seoul';
const PID = 'project-1';

let seed = 3;
setRandomBytes((size: number) => {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    bytes[i] = seed % 256;
  }
  return bytes;
});

/** 요청 시간 제한. axios 가 응답을 받지 못했을 때의 모양 그대로다. */
const timeout = () => Object.assign(new Error('timeout of 10000ms exceeded'), {
  code: 'ECONNABORTED',
});

function emptyPull(version: number): SyncDto.PullResponse {
  return {
    projectId: PID,
    since: 0,
    version,
    hasMore: false,
    tombstones: [],
    tombstoneFloor: 0,
    changes: {
      project: null,
      members: [],
      people: [],
      accounts: [],
      categories: [],
      tags: [],
      cards: [],
      entries: [],
      budgets: [],
      budgetOverrides: [],
      exchangeRates: [],
      assetValuations: [],
      installmentPlans: [],
      entryDrafts: [],
    },
  };
}

async function main() {
  const store = new LocalStore(nodeSqliteDriver());
  await store.init(PID, KST);
  await store.ensureClient(() => 'client-under-test');

  // ── 1. 받는 쪽: 큰 쪽이 끊기면 줄여서 청한다 ──
  const asked: number[] = [];
  const slowPull = async (query: SyncDto.PullQuery) => {
    asked.push(query.limit ?? 0);
    if ((query.limit ?? 0) > 100) throw timeout();
    return emptyPull(7);
  };

  const caught = await syncProject(store, slowPull, PID, KST);
  eq('느린 회선에서도 끝까지 간다', caught.offline, false);
  eq('쪽을 반으로 줄여 가며 청한다', asked.join(','), '500,250,125,62');
  eq('받은 번호가 커서에 남는다', (await store.cursor(PID))?.version, 7);

  // ── 2. 밀어 올리는 쪽: 묶음이 커서 끊기면 줄인다 ──
  for (let i = 0; i < 3; i += 1) {
    await store.enqueue({
      projectId: PID,
      mutationId: `m${i}`,
      kind: 'entry.create',
      targets: [`e${i}`],
      payload: { id: `e${i}` },
      observed: null,
    });
  }
  eq('큐에 셋이 쌓였다', (await store.outboxCount(PID)).pending, 3);

  const sizes: number[] = [];
  const slowPush = async (request: { mutations: Array<{ mutationId: string }> }) => {
    sizes.push(request.mutations.length);
    // 회선이 좁아 두 건이 넘으면 끊긴다.
    if (request.mutations.length > 2) throw timeout();
    return {
      results: request.mutations.map((mutation) => ({
        mutationId: mutation.mutationId,
        status: 'applied' as const,
      })),
    };
  };

  const pushed = await syncProject(
    store,
    async () => emptyPull(7),
    PID,
    KST,
    slowPush as never,
  );
  eq('밀어 올리는 것도 끝까지 간다', pushed.offline, false);
  eq('묶음을 반으로 줄여 간다', sizes.slice(0, 6).join(','), '3,3,3,3,3,3');
  eq('한 건씩이라도 다 보낸다', pushed.pushed, 3);
  // ── 3. 한 번의 동기화가 큐를 비운다 ──
  eq('큐가 비었다', (await store.outboxCount(PID)).pending, 0);

  // ── 4. 정말로 없으면 오프라인이고 큐는 남는다 ──
  await store.enqueue({
    projectId: PID,
    mutationId: 'm-offline',
    kind: 'entry.create',
    targets: ['e-offline'],
    payload: { id: 'e-offline' },
    observed: null,
  });

  const floors: number[] = [];
  const deadPull = async (query: SyncDto.PullQuery) => {
    floors.push(query.limit ?? 0);
    throw timeout();
  };

  const offline = await syncProject(store, deadPull, PID, KST, async () => {
    throw timeout();
  });
  eq('네트워크가 없으면 오프라인으로 끝난다', offline.offline, true);
  eq('적어 둔 것은 큐에 남는다', (await store.outboxCount(PID)).pending, 1);
  /*
   * 받기는 시작조차 하지 않는다. 밀어 올리다 끊겼으면 받기도 되지 않으므로,
   * 큰 쪽을 몇 번씩 더 청하며 시간을 쓰지 않는다.
   */
  eq('밀어 올리기가 막히면 받기는 건너뛴다', floors.length, 0);

  console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
