/**
 * 아웃박스와 로컬 커밋 검사.
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/outbox-smoke.ts [덤프.json]
 *
 * 2단계가 지켜야 하는 것을 넷으로 나눠 본다.
 *
 *   1. **로컬 커밋과 큐가 함께 간다.** 화면이 거래를 적으면 사본에 곧바로 보이고,
 *      같은 내용이 명령으로 큐에 쌓인다. 하나만 되면 사용자가 알아챌 방법이 없다.
 *   2. **기기가 만든 전표가 서버가 재생한 전표와 같다.** 이것이 2단계의 핵심 약속이다.
 *      api 의 `sync-push-dump` 가 같은 명령을 서버에서 돌린 결과를 떠 두고, 여기서
 *      한 줄씩 견준다. 손으로 기대값을 적으면 두 쪽이 같은 이유로 함께 틀릴 수 있다.
 *   3. **결과 반영.** 적용된 것은 큐에서 빠지고, 충돌과 거절은 이유를 달고 남는다.
 *      조용히 지우면 사용자가 적은 것이 말없이 사라진다.
 *   4. **의존과 순서.** 번호는 1씩 오르고, 막힌 것은 다시 줄에 세울 수 있다.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'fs';
import {
  type EntryDto,
  type Mutation,
  type MutationResult,
  type PushRequest,
  type PushResponse,
  type SyncDto,
  setRandomBytes,
} from '@money/types';

import { createLocalEntryWriter } from '../src/data/local-entry-writer';
import { httpHomePort } from '../src/data/home-port';
import { createLocalHomePort } from '../src/data/local-home-port';
import { LocalStore } from '../src/data/local-store';
import { syncProject } from '../src/data/sync-engine';
import { nodeSqliteDriver } from './node-sqlite-driver';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

/*
 * 난수원. 노드에도 WebCrypto 가 있지만 검사에서는 고정한 값을 쓴다.
 *
 * id 가 매번 달라지면 실패했을 때 어느 줄이 어긋났는지 읽기 어렵다. 값 자체는 이
 * 검사에서 뜻이 없다 (겹치지만 않으면 된다).
 */
let seed = 1;
setRandomBytes((count) => {
  const bytes = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) bytes[i] = (seed = (seed * 1103515245 + 12345) % 256);
  return bytes;
});

const KST = 'Asia/Seoul';

(async () => {
  const dumpPath = process.argv[2] ?? '/tmp/sync-push-dump.json';
  if (!existsSync(dumpPath)) {
    console.log(`\n(건너뜀) 실제 응답 파일이 없다: ${dumpPath}`);
    console.log('  api 에서 먼저: npx ts-node --transpile-only -r <훅> scripts/sync-push-dump.ts <경로>');
    process.exit(0);
  }

  const dump = JSON.parse(readFileSync(dumpPath, 'utf8')) as {
    base: SyncDto.PullResponse;
    mutations: Mutation[];
    server: {
      results: MutationResult[];
      entries: Array<Record<string, unknown>>;
      projectId: string;
      personId: string;
      accounts: { bank: string; savings: string };
      categories: { dining: string; salary: string; fee: string; luxury: string };
      cardId: string;
    };
  };

  const driver = nodeSqliteDriver();
  const store = new LocalStore(driver);
  const projectId = dump.base.projectId;

  // ── 밑바탕. 명령을 돌리기 전의 서버 상태를 사본에 적는다 ──
  await store.init(projectId, KST);
  await store.applyPull(dump.base, KST);
  const clientId = await store.ensureClient(() => 'client-under-test');
  eq('기기 이름이 생긴다', clientId, 'client-under-test');
  eq('같은 이름을 다시 쓴다', await store.ensureClient(() => 'another'), 'client-under-test');

  const writer = createLocalEntryWriter({ store, projectId, timeZone: KST });

  /** 서버가 받은 명령의 짐을 화면이 보내는 모양으로 되돌린다. */
  const asRequest = (payload: Record<string, unknown>): EntryDto.CreateRequest =>
    payload as unknown as EntryDto.CreateRequest;

  // ── 1. 로컬 커밋 ──
  //
  // 덤프의 명령을 순서대로 돌린다. 서버가 받은 것과 같은 짐이라 결과도 같아야 한다.
  for (const mutation of dump.mutations) {
    const payload = mutation.payload as Record<string, unknown>;
    if (mutation.kind === 'entry.create') {
      await writer.createEntry(asRequest(payload));
    } else if (mutation.kind === 'entry.replace') {
      await writer.updateEntry(String(payload.id), asRequest(payload));
    } else {
      await writer.deleteEntry(String(payload.id));
    }
  }

  const counts = await store.outboxCount(projectId);
  eq('명령이 큐에 쌓였다', counts.pending, dump.mutations.length);
  eq('보류 칸은 비어 있다', counts.held, 0);

  const queued = await store.pendingMutations(projectId);
  eq('번호가 1부터 1씩 오른다',
    queued.map((row) => row.clientSeq).join(','),
    queued.map((_, index) => index + 1).join(','));
  eq('시계가 순서대로 늘어난다',
    queued.every((row, index) => index === 0 || row.hlc > queued[index - 1].hlc), true);
  eq('기기 이름이 실린다', queued[0]?.clientId, clientId);

  // ── 2. 사본이 만든 전표가 서버가 재생한 전표와 같은가 ──
  const port = createLocalHomePort(store, {
    fallback: Object.fromEntries(
      Object.keys(httpHomePort).map((name) => [
        name,
        async () => {
          throw new Error(`사본이 낼 수 있어야 한다: ${name}`);
        },
      ]),
    ) as unknown as typeof httpHomePort,
  });

  const localEntries = await port.getAllEntries(
    { startDate: '2026-07-31T15:00:00.000Z', endDate: '2026-08-31T14:59:59.999Z' },
    projectId,
  );
  const serverEntries = dump.server.entries;
  eq('목록: 건수', localEntries.length, serverEntries.length);
  eq('지운 거래는 사본에도 없다',
    localEntries.some((row) => row.description === '지울 거래'), false);

  const byId = new Map(serverEntries.map((row) => [String(row.id), row]));
  const compared = [
    'kind', 'description', 'amount', 'extraAmount', 'categoryName', 'parentCategoryName',
    'accountName', 'toAccountName', 'personName', 'cardName', 'feeAmount', 'feeCategoryName',
    'installmentMonths', 'originalCurrency', 'originalAmount', 'rateProvisional',
  ] as const;

  let mismatch = 0;
  for (const row of localEntries) {
    const serverRow = byId.get(String(row.id));
    if (!serverRow) {
      mismatch += 1;
      console.log(`FAIL  목록: 서버에 없는 줄 ${row.description}`);
      continue;
    }
    for (const field of compared) {
      const local = (row as Record<string, unknown>)[field];
      if (String(local) !== String(serverRow[field])) {
        mismatch += 1;
        console.log(
          `FAIL  ${row.description}.${field} (서버 ${serverRow[field]}, 사본 ${local})`,
        );
      }
    }
  }
  eq(`조립: 필드 ${compared.length}개를 줄마다 대조`, mismatch, 0);

  // 규칙이 옮겨 왔는지 콕 집어 본다. 위의 대조가 통째로 지나가도 이 셋은 눈에 띄어야 한다.
  const impulse = localEntries.find((row) => row.description === '충동구매');
  eq('과소비 기본값을 사본도 읽는다 (전액이 과소비)', impulse?.extraAmount, '50000');
  const groceries = localEntries.find((row) => row.description === '장보기');
  eq('분할 합계', groceries?.amount, '50000');

  /*
   * 분할의 과소비는 목록 한 줄로는 보이지 않는다.
   *
   * `toListItem` 의 extraAmount 는 대표 카테고리 다리의 값이라, 분할에서 다른 줄에 붙은
   * 과소비는 거기 실리지 않는다(서버도 같은 값을 낸다 -- 위의 줄별 대조가 그것을 확인했다).
   * 그래서 다리 쪽에서 본다. 사치 분류의 과소비는 충동구매 5만 + 장보기 1만5천이다.
   */
  const augustPostings = await store.categoryPostings(projectId, {
    fromDateKey: '2026-08-01',
    toDateKey: '2026-08-31',
  });
  const luxuryExtra = augustPostings
    .filter((row) => row.categoryId === dump.server.categories.luxury)
    .reduce((sum, row) => sum + Number(row.extraAmount), 0);
  eq('분할에 붙은 과소비가 다리에 남는다', luxuryExtra, 65000);
  const laptop = localEntries.find((row) => row.description === '노트북');
  eq('할부 개월수가 사본에도 붙는다', laptop?.installmentMonths, 3);
  const transfer = localEntries.find((row) => row.description === '적금 이체');
  eq('이체 수수료', transfer?.feeAmount, '1000');

  // ── 3. 서버가 돌려준 결과를 반영한다 ──
  const applied = queued.slice(0, 2).map((row) => ({
    mutationId: row.mutationId,
    status: 'applied' as const,
  }));
  const conflicted: MutationResult = {
    mutationId: queued[2].mutationId,
    status: 'conflict',
    error: '다른 기기에서 이 거래를 더 늦게 고쳤습니다.',
  };
  const rejected: MutationResult = {
    mutationId: queued[3].mutationId,
    status: 'rejected',
    error: '카테고리를 찾을 수 없습니다.',
  };
  await store.settleMutations([...applied, conflicted, rejected]);

  const afterSettle = await store.outboxCount(projectId);
  eq('적용된 것은 큐에서 빠진다', afterSettle.pending, dump.mutations.length - 4);
  eq('충돌과 거절은 남는다', afterSettle.held, 2);

  const held = await store.heldMutations(projectId);
  eq('보류 칸에 이유가 함께 남는다', held.find((row) => row.status === 'conflict')?.error,
    '다른 기기에서 이 거래를 더 늦게 고쳤습니다.');
  eq('거절도 이유가 남는다', held.find((row) => row.status === 'rejected')?.error,
    '카테고리를 찾을 수 없습니다.');
  eq('보류된 것은 다시 보내지 않는다',
    (await store.pendingMutations(projectId)).some((row) => row.mutationId === conflicted.mutationId),
    false);

  // 다시 줄에 세우면 번호는 그대로다. 새로 매기면 서버가 보기에 다른 명령이 된다.
  await store.retryMutation(conflicted.mutationId);
  const retried = await store.pendingMutations(projectId);
  eq('다시 줄에 선다', retried.some((row) => row.mutationId === conflicted.mutationId), true);
  eq('번호는 그대로', retried.find((row) => row.mutationId === conflicted.mutationId)?.clientSeq,
    queued[2].clientSeq);

  // 다시 줄에 세운 충돌은 이미 보류 칸을 떠났다. 남은 거절 하나를 버리면 칸이 빈다.
  await store.discardMutation(rejected.mutationId);
  eq('버리면 보류 칸에서 사라진다', (await store.heldMutations(projectId)).length, 0);

  // ── 4. 동기화 엔진이 큐를 비운다 ──
  //
  // 밀어 올리기가 받기보다 먼저다. 받기를 먼저 하면 방금 만든 전표가 아직 서버에 없어
  // 그 자리의 값이 로컬 커밋을 덮을 여지가 생긴다.
  const order: string[] = [];
  const pushed: PushRequest[] = [];

  const push = async (request: PushRequest): Promise<PushResponse> => {
    order.push('push');
    pushed.push(request);
    return {
      results: request.mutations.map((row) => ({ mutationId: row.mutationId, status: 'applied' })),
      version: dump.base.version,
    };
  };
  const pull = async (): Promise<SyncDto.PullResponse> => {
    order.push('pull');
    return { ...dump.base, changes: emptyChanges(), tombstones: [], hasMore: false };
  };

  const result = await syncProject(store, pull, projectId, KST, push);
  eq('밀어 올리기가 받기보다 먼저다', order[0], 'push');
  eq('큐가 비었다', (await store.outboxCount(projectId)).pending, 0);
  eq('올린 건수를 알려 준다', result.pushed > 0, true);
  eq('한 요청에 기기 이름이 실린다', pushed[0]?.clientId, clientId);
  eq('보낸 순서가 번호 순이다',
    pushed[0].mutations.every((row, index) =>
      index === 0 || row.clientSeq > pushed[0].mutations[index - 1].clientSeq), true);

  // ── 5. 오프라인이면 큐를 그대로 둔다 ──
  await writer.createEntry({
    id: '019273cc-0000-7000-8000-000000000001',
    kind: 'expense',
    personId: dump.server.personId,
    date: new Date(Date.UTC(2026, 7, 21, 3)).toISOString(),
    description: '비행기 모드',
    amount: '4000',
    categoryId: dump.server.categories.dining,
    accountId: dump.server.accounts.bank,
  } as unknown as EntryDto.CreateRequest);

  const offlineResult = await syncProject(
    store,
    pull,
    projectId,
    KST,
    async () => {
      throw Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
    },
  );
  eq('오프라인이라고 답한다', offlineResult.offline, true);
  eq('큐는 그대로 남는다', (await store.outboxCount(projectId)).pending, 1);
  eq('사본은 그대로 읽을 수 있다',
    (await port.getAllEntries(
      { startDate: '2026-08-01T00:00:00.000Z', endDate: '2026-08-31T14:59:59.999Z' },
      projectId,
    )).some((row) => row.description === '비행기 모드'), true);

  // ── 6. 사본을 버려도 큐는 남는다 ──
  //
  // 다른 표는 서버에서 다시 받을 수 있는 그림자지만, 큐에 든 것은 아직 아무 데도 없는
  // 값이다. 스키마가 바뀌었다고 함께 버리면 사용자가 적은 거래가 사라진다.
  await store.reset(projectId);
  eq('사본은 비워진다', (await store.counts(projectId)).entry, 0);
  eq('큐는 살아남는다', (await store.outboxCount(projectId)).pending, 1);

  driver.close();
  console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`);
  process.exit(fail === 0 ? 0 : 1);
})();

function emptyChanges(): SyncDto.Changes {
  return {
    project: null,
    members: [],
    people: [],
    accounts: [],
    categories: [],
    cards: [],
    entries: [],
    budgets: [],
    budgetOverrides: [],
    exchangeRates: [],
    assetValuations: [],
    installmentPlans: [],
  };
}

// node:sqlite 는 실험 기능이라 경고를 낸다. 검증 출력이 묻히지 않게 지운다.
void DatabaseSync;
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name !== 'ExperimentalWarning') console.warn(warning);
});
