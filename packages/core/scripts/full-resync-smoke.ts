/**
 * 델타로 따라잡을 수 없는 기기가 사본을 처음부터 다시 받는지 검사.
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/full-resync-smoke.ts
 *
 * 왜 이것을 검사하는가. 서버는 보관 기간이 지난 자리표를 지운다. 그 뒤로 오래된 커서를
 * 든 기기는 놓친 삭제를 받을 길이 없다 -- **지운 거래가 그 기기에 영영 남는다.** 화면에는
 * 아무 표시가 나지 않고, 그 유령 행이 합계에 계속 들어간다.
 *
 * 판단은 기기가 한다(서버는 바닥 번호만 알려 준다). 그 판단이 두 방향으로 조용히 틀린다.
 *
 *   - 덜 버리면 유령 행이 남는다.
 *   - 더 버리면 **큰 사본을 영영 다 받지 못한다.** 처음부터 받는 중인 기기도 커서가
 *     바닥보다 낮아서, 커서만 보고 판단하면 받다가 되돌리기를 되풀이한다.
 *
 * 그래서 네 갈래를 본다. 오래된 커서는 버리고, 받는 중이면 두고, 바닥이 더 오르면 다시
 * 버리고, 평소에는 아무 일도 하지 않는다. 아웃박스는 어느 갈래에서도 살아남아야 한다.
 */
import type { SyncDto } from '@money/types';

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

/** 서버가 한 번에 주는 답. 사람 몇 명과, 그때의 번호와 바닥이다. */
interface Reply {
  version: number;
  tombstoneFloor: number;
  people: string[];
  hasMore?: boolean;
}

function emptyChanges(): SyncDto.Changes {
  return {
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
  };
}

function response(since: number, reply: Reply): SyncDto.PullResponse {
  return {
    projectId: PID,
    since,
    version: reply.version,
    hasMore: reply.hasMore ?? false,
    changes: {
      ...emptyChanges(),
      people: reply.people.map((id) => ({
        id,
        name: id,
        isActive: true,
        updatedVersion: reply.version,
      })),
    },
    tombstones: [],
    tombstoneFloor: reply.tombstoneFloor,
  };
}

/**
 * 커서에 따라 다른 답을 주는 가짜 서버.
 *
 * `since` 로 고르는 것이 요점이다. 사본을 버린 기기는 0 부터 다시 묻는데, 그때 오는
 * 것은 델타가 아니라 지금 서버에 있는 전부다. 두 답을 나눠 두어야 "버린 뒤에 무엇을
 * 받는가"를 검사할 수 있다.
 */
function server(plan: Array<{ since: number; reply: Reply }>) {
  const asked: number[] = [];
  const pull = async (query: SyncDto.PullQuery): Promise<SyncDto.PullResponse> => {
    const since = query.since ?? 0;
    asked.push(since);
    const found = plan.find((row) => row.since === since);
    if (!found) throw new Error(`가짜 서버가 모르는 커서입니다: ${since}`);
    return response(since, found.reply);
  };
  return { pull, asked };
}

/** 사본에 남아 있는 사람의 id. 무엇이 사라지고 무엇이 남았는지를 이것으로 본다. */
async function peopleIds(store: LocalStore): Promise<string> {
  const rows = await store.people(PID);
  return rows
    .map((row) => row.id)
    .sort()
    .join(',');
}

(async () => {
  const driver = nodeSqliteDriver();
  const store = new LocalStore(driver);

  // ── 준비: 사람 둘이 든 사본과, 아직 보내지 못한 명령 하나 ──
  const seed = server([{ since: 0, reply: { version: 100, tombstoneFloor: 0, people: ['a', 'b'] } }]);
  await syncProject(store, seed.pull, PID, KST);
  eq('처음에는 둘이 들어온다', await peopleIds(store), 'a,b');

  // 명령에는 기기 이름과 순번이 실린다. 그 이름을 먼저 만들어 둔다.
  await store.ensureClient(() => '019273cc-0000-7000-8000-0000000000c1');
  await store.enqueue({
    projectId: PID,
    mutationId: '019273cc-0000-7000-8000-000000000001',
    kind: 'entry.delete',
    targets: ['019273cc-0000-7000-8000-0000000000aa'],
    payload: { id: '019273cc-0000-7000-8000-0000000000aa' },
  } as unknown as Parameters<LocalStore['enqueue']>[0]);

  /*
   * ── 1. 커서가 바닥보다 오래되면 사본을 버리고 처음부터 받는다 ──
   *
   * 서버는 100 번 뒤의 델타를 줄 수 있지만, 그 사이의 삭제 중 일부는 이미 지워졌다
   * (바닥이 500 이다). 그 델타를 그대로 적용하면 지워진 'a' 가 사본에 남는다.
   */
  const stale = server([
    { since: 100, reply: { version: 520, tombstoneFloor: 500, people: ['c'] } },
    { since: 0, reply: { version: 520, tombstoneFloor: 500, people: ['b', 'c'] } },
  ]);
  const rebuilt = await syncProject(store, stale.pull, PID, KST);
  eq('사본을 처음부터 다시 받았다고 알린다', rebuilt.rebuilt, true);
  eq('0 부터 다시 물었다', stale.asked.join(','), '100,0');
  eq('그 사이에 지워진 행이 사라진다', await peopleIds(store), 'b,c');
  eq('커서는 서버를 따라잡았다', rebuilt.version, 520);

  const cursor = await store.cursor(PID);
  eq('그때의 바닥을 적어 둔다', cursor?.mirrorFloor, 500);
  eq('아웃박스는 살아남는다', (await store.outboxCount(PID)).pending, 1);

  /*
   * ── 2. 처음부터 받는 중에는 다시 버리지 않는다 ──
   *
   * 사본이 크면 한 번에 다 오지 않는다(`hasMore`). 그 중간 상태는 커서가 바닥보다
   * 낮은데, 그것만 보고 버리면 받은 것을 되돌리기를 되풀이하며 영영 끝나지 않는다.
   * 적어 둔 바닥과 견주어 "바닥이 더 오른 경우"에만 버리는 것이 그 차이다.
   */
  await store.resetForRebuild(PID, KST, 500);
  const paging = server([
    { since: 0, reply: { version: 300, tombstoneFloor: 500, people: ['d'], hasMore: true } },
    { since: 300, reply: { version: 700, tombstoneFloor: 500, people: ['e'] } },
  ]);
  const paged = await syncProject(store, paging.pull, PID, KST);
  eq('받는 중에는 버리지 않는다', paged.rebuilt, false);
  eq('두 쪽을 이어 받는다', paging.asked.join(','), '0,300');
  eq('앞 쪽에서 받은 것이 남는다', await peopleIds(store), 'd,e');

  /*
   * ── 3. 바닥이 더 오르면 다시 버린다 ──
   *
   * 이번에는 정말로 따라잡을 수 없는 자리다. 적어 둔 바닥(500)보다 서버의 바닥(900)이
   * 높다는 것은 그 사이의 자리표가 사라졌다는 뜻이다.
   */
  const higher = server([
    { since: 700, reply: { version: 950, tombstoneFloor: 900, people: ['f'] } },
    { since: 0, reply: { version: 950, tombstoneFloor: 900, people: ['e', 'f'] } },
  ]);
  const second = await syncProject(store, higher.pull, PID, KST);
  eq('바닥이 오르면 다시 버린다', second.rebuilt, true);
  eq('다시 0 부터 받는다', await peopleIds(store), 'e,f');
  eq('새 바닥을 적어 둔다', (await store.cursor(PID))?.mirrorFloor, 900);

  /*
   * ── 4. 평소에는 아무 일도 하지 않는다 ──
   *
   * 계속 따라붙어 있는 기기는 커서가 바닥보다 훨씬 앞에 있다. 이 갈래가 대부분이고,
   * 여기서 사본을 버리면 멀쩡한 기기가 매번 전부를 다시 받는다.
   */
  const normal = server([
    { since: 950, reply: { version: 980, tombstoneFloor: 900, people: ['g'] } },
  ]);
  const quiet = await syncProject(store, normal.pull, PID, KST);
  eq('멀쩡한 기기는 버리지 않는다', quiet.rebuilt, false);
  eq('델타만 얹는다', await peopleIds(store), 'e,f,g');
  eq('아웃박스는 끝까지 살아남는다', (await store.outboxCount(PID)).pending, 1);

  /*
   * ── 5. 처음 쓰는 기기는 빈 사본을 버리지 않는다 ──
   *
   * 서버가 이미 자리표를 지운 뒤라면 첫 응답에도 바닥이 실려 온다. 커서가 0 이라는
   * 이유로 버리면 첫 동기화가 첫 쪽을 두 번 받는다 -- 버릴 것이 없는데도. 대신 그
   * 바닥을 그대로 적어 두어야 다음 쪽에서 또 판단하지 않는다.
   */
  const freshDriver = nodeSqliteDriver();
  const fresh = new LocalStore(freshDriver);
  const first = server([
    { since: 0, reply: { version: 400, tombstoneFloor: 900, people: ['h'], hasMore: true } },
    { since: 400, reply: { version: 980, tombstoneFloor: 900, people: ['i'] } },
  ]);
  const firstSync = await syncProject(fresh, first.pull, PID, KST);
  eq('빈 사본은 버리지 않는다', firstSync.rebuilt, false);
  eq('첫 쪽을 두 번 받지 않는다', first.asked.join(','), '0,400');
  eq('첫 동기화가 바닥을 적어 둔다', (await fresh.cursor(PID))?.mirrorFloor, 900);
  eq('받은 것이 다 남는다', await peopleIds(fresh), 'h,i');

  driver.close();
  freshDriver.close();
  console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`);
  process.exit(fail === 0 ? 0 : 1);
})();
