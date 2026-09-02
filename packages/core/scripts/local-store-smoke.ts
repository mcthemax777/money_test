/**
 * 기기 사본과 동기화 엔진 검사.
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/local-store-smoke.ts
 *
 * (core 에는 실행기가 없어 api 의 ts-node 를 빌려 쓴다. `node:sqlite` 는 노드에
 *  들어 있어 새 의존성이 필요하지 않다.)
 *
 * 무엇을 지키는 검사인가. 사본이 서버 상태의 그림자라는 것이 1단계의 전부다.
 * 그래서 다음을 본다.
 *
 *   1. 델타를 적용하면 사본이 그 상태가 되고, 커서가 그만큼 전진한다.
 *   2. 자리표를 받으면 사본에서도 사라진다 (딸린 다리까지).
 *   3. 전표가 다시 오면 다리를 통째로 갈아 끼운다 (다리 수가 줄어도 남지 않는다).
 *   4. 달력 키가 프로젝트 타임존을 따르고, 타임존이 바뀌면 다시 계산된다.
 *   5. 그 사본을 0단계의 집계 함수에 넣으면 서버와 같은 값이 나온다.
 *   6. 네트워크가 없으면 오류가 아니라 "오프라인"으로 끝난다.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'fs';
import {
  categoryBreakdown,
  categoryUsage,
  dailyTotals,
  isBudgetApplicable,
  monthlyTotals,
  netWorth,
  summarize,
  totalUsage,
  type SyncDto,
} from '@money/types';

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

const KST = 'Asia/Seoul';
const PID = 'project-1';

/** 서버 응답을 흉내 낸다. 실제 모양은 sync.service 가 내보내는 것과 같다. */
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

function pullResponse(
  version: number,
  changes: Partial<SyncDto.Changes>,
  tombstones: SyncDto.Tombstone[] = [],
  hasMore = false,
  since = 0,
): SyncDto.PullResponse {
  return {
    projectId: PID,
    since,
    version,
    hasMore,
    changes: { ...emptyChanges(), ...changes },
    tombstones,
  };
}

const entry = (
  id: string,
  date: string,
  amount: string,
  categoryId: string,
  accountId: string,
  extra = '0',
  version = 1,
) => ({
  id,
  projectId: PID,
  personId: 'p1',
  date,
  description: `거래 ${id}`,
  merchant: null,
  detailedNote: null,
  originalCurrency: null,
  originalAmount: null,
  rateProvisional: false,
  createdByUserId: null,
  updatedVersion: version,
  postings: [
    {
      id: `${id}-cat`,
      entryId: id,
      accountId: null,
      categoryId,
      amount,
      quantity: null,
      currency: 'KRW',
      baseAmount: amount,
      exchangeRate: '1',
      extraAmount: extra,
      normalAmount: String(Number(amount) - Number(extra)),
      cardId: null,
    },
    {
      id: `${id}-acc`,
      entryId: id,
      accountId,
      categoryId: null,
      amount: `-${amount}`,
      quantity: null,
      currency: 'KRW',
      baseAmount: `-${amount}`,
      exchangeRate: '1',
      extraAmount: '0',
      normalAmount: '0',
      cardId: null,
    },
  ],
});

(async () => {
  /*
   * ── 0. 프로젝트를 고르기 전에도 쓸 수 있다 ──
   *
   * 앱은 시작할 때 사본을 열고 기기 이름을 먼저 준비한다. 프로젝트는 그다음에
   * 고른다. 그래서 표를 만드는 일이 `init(projectId, ...)` 안에만 있으면 여기서
   * "client_state 가 없다"로 넘어지고, 오프라인이 통째로 꺼진다.
   *
   * 아래 검사들이 전부 `init` 을 먼저 부르기 때문에 이 순서는 스모크를 빠져나갔고
   * 에뮬레이터에서 드러났다. 그 순서를 여기 못 박아 둔다.
   */
  const coldDriver = nodeSqliteDriver();
  const coldStore = new LocalStore(coldDriver);
  await coldStore.ensureSchema();
  const coldClientId = await coldStore.ensureClient(() => 'client-cold');
  eq('프로젝트 없이도 기기 이름을 만든다', coldClientId, 'client-cold');
  eq('두 번 불러도 같은 이름이다', await coldStore.ensureClient(() => 'client-other'), 'client-cold');
  coldDriver.close();

  const driver = nodeSqliteDriver();
  const store = new LocalStore(driver);

  // ── 1. 처음 받기 ──
  const first = pullResponse(12, {
    project: {
      id: PID, name: '우리집', projectKey: null, description: null,
      ledgerCurrency: 'KRW', displayCurrency: 'KRW', timezone: KST, updatedVersion: 1,
    },
    people: [{ id: 'p1', projectId: PID, name: '김철수', relationship: null, isActive: true, sortOrder: 0, updatedVersion: 2 }],
    accounts: [
      { id: 'a1', projectId: PID, ownerId: 'p1', type: 'deposit', name: '보통예금', institutionId: null,
        accountNumber: null, currency: 'KRW', balance: '1000000', isActive: true, sortOrder: 0, updatedVersion: 3 },
      { id: 'a2', projectId: PID, ownerId: 'p1', type: 'credit_card', name: '신한 신용', institutionId: null,
        accountNumber: null, currency: 'KRW', balance: '-50000', isActive: true, sortOrder: 1, updatedVersion: 4 },
      // 시가로 평가하는 계좌. 장부 잔액 50만이 평가액 80만으로 대체되어야 한다.
      { id: 'a3', projectId: PID, ownerId: 'p1', type: 'investment', name: '주식계좌', institutionId: null,
        accountNumber: null, currency: 'KRW', balance: '500000', isActive: true, sortOrder: 2, updatedVersion: 11 },
    ],
    assetValuations: [
      { id: 'v1', accountId: 'a3', date: '2026-08-31T00:00:00.000Z', quantity: '10',
        price: '80000', marketValue: '800000', source: 'manual', updatedVersion: 11 },
    ],
    categories: [
      { id: 'c-dining', projectId: PID, name: '외식', parentId: null, type: 'expense', icon: null,
        defaultIsExtra: false, isDefault: false, isActive: true, sortOrder: 0, updatedVersion: 5 },
      { id: 'c-lunch', projectId: PID, name: '점심', parentId: 'c-dining', type: 'expense', icon: null,
        defaultIsExtra: false, isDefault: false, isActive: true, sortOrder: 1, updatedVersion: 6 },
      { id: 'c-salary', projectId: PID, name: '급여', parentId: null, type: 'income', icon: null,
        defaultIsExtra: false, isDefault: false, isActive: true, sortOrder: 2, updatedVersion: 7 },
    ],
    budgets: [
      { id: 'b1', projectId: PID, categoryId: 'c-dining', type: null, monthlyAmount: '300000',
        effectiveFrom: null, effectiveTo: null, updatedVersion: 8 },
    ],
    budgetOverrides: [
      { id: 'o1', budgetId: 'b1', year: 2026, month: 8, amount: '350000', updatedVersion: 9 },
    ],
    exchangeRates: [
      { id: 'r1', projectId: PID, baseCurrency: 'USD', quoteCurrency: 'KRW', rate: '1385.2',
        date: '2026-08-01T00:00:00.000Z', source: 'manual', updatedVersion: 10 },
      { id: 'r2', projectId: PID, baseCurrency: 'USD', quoteCurrency: 'KRW', rate: '1400',
        date: '2026-08-20T00:00:00.000Z', source: 'manual', updatedVersion: 11 },
    ],
    entries: [
      // 한국 시간 8/6 00:30 (UTC 로는 8/5 15:30). 달력 키가 타임존을 따라야 한다.
      entry('e1', '2026-08-05T15:30:00.000Z', '30000', 'c-lunch', 'a1', '0', 12),
      entry('e2', '2026-08-10T03:00:00.000Z', '50000', 'c-dining', 'a1', '20000', 12),
    ],
  });

  const pulls: SyncDto.PullResponse[] = [first];
  let pullCount = 0;
  const pull = async () => {
    const next = pulls[pullCount];
    pullCount += 1;
    if (!next) throw Object.assign(new Error('네트워크 없음'), { code: 'ERR_NETWORK' });
    return next;
  };

  const result = await syncProject(store, pull, PID, KST);
  eq('커서가 서버 번호까지 전진한다', result.version, 12);
  eq('한 번에 끝났다', result.rounds, 1);
  eq('변경이 있었다', result.changed, true);
  eq('오프라인이 아니다', result.offline, false);

  const counts = await store.counts(PID);
  eq('사람', counts.person, 1);
  eq('계좌', counts.account, 3);
  eq('카테고리', counts.category, 3);
  eq('전표', counts.entry, 2);
  eq('다리', counts.posting, 4);

  // ── 2. 달력 키가 타임존을 따른다 ──
  const rows = await driver.all<{ id: string; dateKey: string; yearMonth: string }>(
    'SELECT id, dateKey, yearMonth FROM entry ORDER BY id',
  );
  eq('KST 새벽 거래의 날짜 키', rows[0]?.dateKey, '2026-08-06');
  eq('그 거래의 달', rows[0]?.yearMonth, '2026-08');

  // ── 3. 그 사본으로 집계한다 (0단계 함수를 그대로 쓴다) ──
  const august = await store.categoryPostings(PID, {
    fromDateKey: '2026-08-01',
    toDateKey: '2026-08-31',
  });
  eq('8월 카테고리 다리 수', august.length, 2);

  const totals = summarize(august);
  eq('8월 지출', totals.expense.toString(), '80000');
  eq('8월 과소비', totals.extraExpense.toString(), '20000');

  const days = dailyTotals(august, { timeZone: KST, type: 'expense' });
  eq('거래가 있는 날 수', days.length, 2);
  eq('첫 날은 8/6 (UTC 로 자르면 8/5 가 된다)', days[0]?.date, '2026-08-06');

  const breakdown = categoryBreakdown(august, { type: 'expense' });
  eq('롤업하면 외식 한 칸', breakdown.length, 1);
  eq('그 칸 금액', breakdown[0]?.amount.toString(), '80000');
  eq('그 칸 이름', breakdown[0]?.categoryName, '외식');

  const trend = await store.categoryPostingsByMonth(PID, {
    fromYearMonth: '2026-06',
    toYearMonth: '2026-08',
  });
  const points = monthlyTotals(trend, { timeZone: KST, endYearMonth: '2026-08', months: 3 });
  eq('시계열 길이', points.length, 3);
  eq('8월', points[2]?.amount.toString(), '80000');
  eq('거래 없는 달은 0', points[0]?.amount.toString(), '0');

  const categories = await store.categories(PID);
  const usage = categoryUsage(august, categories);
  eq('대분류 사용액 = 자신 + 소분류', usage.get('c-dining')?.amount.toString(), '80000');
  eq('전체 지출 사용액', totalUsage(usage, categories, 'expense').toString(), '80000');

  const budgets = await store.budgets(PID, 2026, 8);
  eq('예산 규칙 수', budgets.length, 1);
  eq('그 달 조정값이 실려 온다', budgets[0]?.overrideAmount, '350000');
  eq('적용 기간 판단', isBudgetApplicable(budgets[0]!, '2026-08'), true);

  const worth = netWorth(await store.netWorthRows(PID), {
    ledgerCurrency: 'KRW', displayCurrency: 'KRW', toDisplay: { KRW: '1' }, ledgerToDisplay: '1',
  });
  eq('현금성', worth.cash.toString(), '1000000');
  eq('부채', worth.liability.toString(), '-50000');
  // 투자 계좌는 장부 잔액(50만)이 아니라 평가액(80만)으로 센다.
  eq('투자 (시가)', worth.investment.toString(), '800000');
  eq('총자산', worth.total.toString(), '1750000');
  /*
   * 미실현손익 = 시가 - 장부가.
   *
   * 장부가는 그 계좌 다리의 저장 통화 합계다. 표본에는 주식계좌를 건드린 거래가 없어
   * 0 이고, 그래서 평가액 80만이 그대로 손익이 된다.
   */
  eq('미실현손익 (시가 - 장부가 0)', worth.unrealizedGain.toString(), '800000');

  eq('최신 환율을 고른다 (날짜 내림차순 첫 줄)', await store.latestRate(PID, 'USD', 'KRW'), '1400');

  // ── 4. 델타: 전표 수정, 다리 수가 줄어든다 ──
  const edited = entry('e2', '2026-08-10T03:00:00.000Z', '40000', 'c-dining', 'a1', '0', 20);
  pulls.push(pullResponse(20, { entries: [edited] }, [], false, 12));
  const second = await syncProject(store, pull, PID, KST);
  eq('커서 전진', second.version, 20);

  const afterEdit = await store.categoryPostings(PID, {
    fromDateKey: '2026-08-01', toDateKey: '2026-08-31',
  });
  eq('수정된 전표의 금액이 반영된다', summarize(afterEdit).expense.toString(), '70000');
  eq('옛 다리가 남지 않는다', (await store.counts(PID)).posting, 4);

  // ── 5. 자리표 ──
  pulls.push(pullResponse(24, {}, [
    { entity: 'JournalEntry', entityId: 'e1', deletedVersion: 22 },
    { entity: 'Budget', entityId: 'b1', deletedVersion: 23 },
    { entity: 'Person', entityId: 'p1', deletedVersion: 24 },
  ], false, 20));
  await syncProject(store, pull, PID, KST);

  const afterDelete = await store.counts(PID);
  eq('지운 전표가 사라진다', afterDelete.entry, 1);
  eq('그 전표의 다리도 사라진다', afterDelete.posting, 2);
  eq('예산도 사라진다', afterDelete.budget, 0);
  eq('예산의 조정값도 함께 사라진다',
    (await driver.all('SELECT id FROM budget_override')).length, 0);
  eq('사람도 사라진다', afterDelete.person, 0);
  eq('주인이 사라져도 계좌는 남는다 (참조만 비어 있다)', afterDelete.account, 3);
  const orphan = await store.accounts(PID);
  eq('그 계좌의 주인 이름은 비어 있다', String(orphan[0]?.ownerName), 'null');

  // ── 6. 여러 쪽으로 나뉘어 오는 경우 ──
  pulls.push(pullResponse(30, {
    people: [{ id: 'p2', projectId: PID, name: '이영희', relationship: null, isActive: true, sortOrder: 0, updatedVersion: 30 }],
  }, [], true, 24));
  pulls.push(pullResponse(34, {
    people: [{ id: 'p3', projectId: PID, name: '아이', relationship: null, isActive: true, sortOrder: 1, updatedVersion: 34 }],
  }, [], false, 30));
  const paged = await syncProject(store, pull, PID, KST);
  eq('끊긴 쪽을 이어 받는다', paged.rounds, 2);
  eq('마지막 번호', paged.version, 34);
  eq('두 쪽 모두 사본에 들어왔다', (await store.counts(PID)).person, 2);

  // ── 7. 네트워크가 없으면 오프라인으로 끝난다 ──
  const offlinePull = async () => {
    throw Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
  };
  const offline = await syncProject(store, offlinePull, PID, KST);
  eq('오프라인이라고 답한다', offline.offline, true);
  eq('커서는 그대로', offline.version, 34);
  eq('사본은 그대로 읽을 수 있다', (await store.counts(PID)).entry, 1);

  // 401 같은 거절은 오프라인이 아니다. 부르는 쪽이 다뤄야 한다.
  const rejectPull = async () => {
    throw Object.assign(new Error('Unauthorized'), { response: { status: 401 } });
  };
  let threw = false;
  try {
    await syncProject(store, rejectPull, PID, KST);
  } catch {
    threw = true;
  }
  eq('인증 거절은 그대로 던진다', threw, true);

  // ── 8. 타임존이 바뀌면 달력 키를 다시 계산한다 ──
  await store.recomputeCalendarKeys(PID, 'America/New_York');
  const moved = await driver.all<{ dateKey: string; yearMonth: string }>(
    'SELECT dateKey, yearMonth FROM entry',
  );
  eq('뉴욕 기준으로 날짜가 옮겨진다', moved[0]?.dateKey, '2026-08-09');
  const cursorAfter = await store.cursor(PID);
  eq('쓰인 타임존이 기록된다', cursorAfter?.timeZone, 'America/New_York');

  // init 이 타임존 차이를 스스로 알아채는지
  await store.init(PID, KST);
  const back = await driver.all<{ dateKey: string }>('SELECT dateKey FROM entry');
  eq('다시 서울로 돌리면 원래 날짜로', back[0]?.dateKey, '2026-08-10');

  // ── 9. 스키마 번호가 다르면 사본을 버린다 ──
  await driver.run('UPDATE sync_state SET schemaVersion = 0 WHERE projectId = ?', [PID]);
  const afterUpgrade = await store.init(PID, KST);
  eq('커서가 0으로 돌아간다', afterUpgrade.version, 0);
  eq('사본이 비워진다', (await store.counts(PID)).entry, 0);

  driver.close();

  // ── 10. 실제 서버 응답을 적어 본다 ──
  //
  // 손으로 만든 표본은 컬럼 이름이나 직렬화가 어긋나도 통과한다. 그 어긋남은
  // 기기에서만 드러나므로, api 쪽 `sync-pull-dump` 가 떠 둔 실제 응답으로 한 번 더 본다.
  // 파일이 없으면 건너뛴다 (데이터베이스 없이도 이 검사가 돌아야 한다).
  const dumpPath = process.argv[2] ?? '/tmp/sync-pull-dump.json';
  if (existsSync(dumpPath)) {
    const dump = JSON.parse(readFileSync(dumpPath, 'utf8')) as {
      pull: SyncDto.PullResponse;
      server: {
        summary: Record<string, string>;
        netWorth: Record<string, unknown>;
        budgets: Array<Record<string, unknown>>;
        entries: Array<Record<string, unknown>>;
        firstPage: { data: Array<Record<string, unknown>>; nextCursor: string | null };
        paymentMethods: Array<Record<string, unknown>>;
        cardPerformance: Record<string, unknown>;
        entryMonths: Array<{ yearMonth: string; income: string; expense: string }>;
        categoryBreakdown: Array<Record<string, unknown>>;
        searchedMonths: Array<{ yearMonth: string; income: string; expense: string }>;
        searchedEntries: Array<Record<string, unknown>>;
        kindEntries: Record<string, string[]>;
        monthEntries: Record<string, string[]>;
        searchCategoryId: string;
        cardId: string;
        stockAccountId: string;
      };
    };
    const real = dump.pull;
    const realDriver = nodeSqliteDriver();
    const realStore = new LocalStore(realDriver);

    await realStore.init(real.projectId, KST);
    await realStore.applyPull(real, KST);

    const realCounts = await realStore.counts(real.projectId);
    eq('실제 응답: 전표가 들어온다', realCounts.entry, real.changes.entries.length);
    eq('실제 응답: 다리도 들어온다',
      realCounts.posting,
      real.changes.entries.reduce((sum, e) => sum + (e.postings?.length ?? 0), 0));
    eq('실제 응답: 커서', (await realStore.cursor(real.projectId))?.version, real.version);

    // 8월 합계가 서버가 만든 데이터와 맞는가 (치킨 30000 + 장보기 50000)
    const realAugust = await realStore.categoryPostings(real.projectId, {
      fromDateKey: '2026-08-01',
      toDateKey: '2026-08-31',
    });
    const realTotals = summarize(realAugust);
    eq('실제 응답: 8월 지출', realTotals.expense.toString(), dump.server.summary.expense);
    eq('실제 응답: 8월 과소비', realTotals.extraExpense.toString(), dump.server.summary.extraExpense);

    // KST 새벽 거래가 8/6 로 들어갔는가
    const chicken = await realDriver.all<{ dateKey: string }>(
      "SELECT dateKey FROM entry WHERE description = '치킨'",
    );
    eq('실제 응답: KST 새벽 거래의 날짜 키', chicken[0]?.dateKey, '2026-08-06');

    /*
     * 기초잔액 전표(1899년)가 8월 합계에 섞이지 않는가.
     *
     * 개수를 적어 두지 않는다. 검사 데이터가 늘 때마다 깨지는 줄이 되고, 그때 고치는
     * 사람은 무엇을 지키던 줄인지 알기 어렵다. 지키려는 것은 하나다 -- **8월 구간으로
     * 고른 다리는 모두 8월 전표의 것이다.** 기초잔액 전표가 새면 여기 걸린다.
     */
    const strayMonth = realAugust
      .map((row) => String(row.date).slice(0, 7))
      .find((month) => month !== '2026-08');
    eq('실제 응답: 기초잔액 전표는 8월에 들지 않는다', strayMonth ?? '없음', '없음');

    // 자본 계정이 순자산에서 빠지는가
    const realWorth = netWorth(await realStore.netWorthRows(real.projectId), {
      ledgerCurrency: 'KRW', displayCurrency: 'KRW', toDisplay: { KRW: '1' }, ledgerToDisplay: '1',
    });
    eq('실제 응답: 총자산', realWorth.total.toString(), String(dump.server.netWorth.total));
    // 투자 계좌를 장부 잔액(50만)이 아니라 시가(80만)로 세는가. 평가액이 사본에 들어와야 한다.
    eq('실제 응답: 투자 시가', realWorth.investment.toString(),
      String(dump.server.netWorth.investment));
    eq('실제 응답: 미실현손익 (시가 - 장부가)', realWorth.unrealizedGain.toString(),
      String(dump.server.netWorth.unrealizedGain));

    // ── 사본 창구가 서버와 같은 값을 내는가 ──
    //
    // 홈 화면은 창구(`HomeDataPort`)만 본다. 그 창구가 사본에서 만든 값이 서버 응답과
    // 같은 모양·같은 숫자여야 화면을 손대지 않고 오프라인으로 갈 수 있다.
    /*
     * 오프라인을 흉내 낸다.
     *
     * 폴백의 모든 창구가 던지므로, 서버에 한 번이라도 물어보면 검사가 실패한다.
     * 홈 화면이 쓰는 값이 정말로 사본만으로 나오는지 보는 것이 이 검사의 요지다.
     */
    const offline = () => {
      throw Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
    };
    const port = createLocalHomePort(realStore, {
      fallback: Object.fromEntries(
        Object.keys(httpHomePort).map((name) => [name, async () => offline()]),
      ) as unknown as typeof httpHomePort,
    });

    const people = await port.getPeople(real.projectId);
    eq('창구: 구성원', people.length, real.changes.people.length);
    eq('창구: 구성원 이름', people[0]?.name, '김철수');

    const accounts = await port.getAccountsV2(real.projectId);
    eq('창구: 계좌 (자본 계정까지)', accounts.length, real.changes.accounts.length);
    const bank = accounts.find((row) => row.name === '보통예금');
    eq('창구: 계좌 주인이 실려 온다', bank?.owner?.name, '김철수');

    const categories = await port.getCategories(real.projectId);
    eq('창구: 카테고리', categories.length, real.changes.categories.length);
    eq('창구: 소분류의 부모', categories.find((c) => c.name === '점심')?.parentId,
      categories.find((c) => c.name === '외식')?.id);

    const summary = await port.getSummary({ yearMonth: '2026-08' }, real.projectId);
    eq('창구: 8월 지출', summary.expense, dump.server.summary.expense);
    eq('창구: 8월 과소비', summary.extraExpense, dump.server.summary.extraExpense);
    eq('창구: 그 달을 그대로 돌려준다', summary.yearMonth, '2026-08');

    const worth = await port.getNetWorth(real.projectId);
    eq('창구: 총자산', worth.total, String(dump.server.netWorth.total));
    eq('창구: 사람별 소계', worth.byPerson[0]?.total, String(dump.server.netWorth.total));

    const budgetRows = await port.getBudgetForMonth(2026, 8, real.projectId);
    const dining = budgetRows.find((row) => row.categoryName === '외식');
    eq('창구: 예산 금액', dining?.monthlyAmount, '300000');
    eq('창구: 예산 사용액 (자신 + 소분류)', dining?.usedAmount,
      dump.server.budgets.find((row) => row.categoryName === '외식')?.usedAmount);
    eq('창구: 전체 지출 줄이 있다',
      budgetRows.some((row) => !row.categoryId && row.categoryType === 'expense'), true);
    eq('창구: 전체 지출 사용액',
      budgetRows.find((row) => !row.categoryId && row.categoryType === 'expense')?.usedAmount,
      dump.server.budgets.find((row) => !row.categoryId && row.categoryType === 'expense')
        ?.usedAmount);

    // 사람 필터. 아무도 고르지 않으면 결과가 없어야 한다("전체"와 뜻이 다르다).
    const noOne = await port.getSummary({ yearMonth: '2026-08' }, real.projectId, { personIds: '' });
    eq('창구: 아무도 고르지 않으면 0', noOne.expense, '0');
    const onlyOwner = await port.getSummary({ yearMonth: '2026-08' }, real.projectId, {
      personIds: people[0]!.id,
    });
    eq('창구: 그 사람만 골라도 같은 값 (돈이 그 사람 통장에서 나갔다)', onlyOwner.expense,
      dump.server.summary.expense);

    // ── 서버가 낸 값과 하나씩 대조한다 ──
    //
    // 기대값을 손으로 적으면 코드와 기대가 같은 이유로 함께 틀릴 수 있다. 서버가 낸
    // 값을 그대로 두고 견주는 것이 그 위험을 없앤다.
    const server = dump.server;
    for (const field of ['income', 'expense', 'extraExpense', 'normalExpense', 'net'] as const) {
      eq(`서버와 대조: summary.${field}`, summary[field], server.summary[field]);
    }
    for (const field of ['total', 'cash', 'investment', 'liability'] as const) {
      eq(`서버와 대조: netWorth.${field}`, worth[field], server.netWorth[field]);
    }

    /*
     * 결제수단별 집계.
     *
     * 통장과 카드가 이름·주인·금액·건수까지 서버와 같아야 한다. 실적 기준액은 통장
     * 통화에서 표시 통화로 옮긴 값이라, 그 환산을 사본이 빠뜨리면 여기서 드러난다.
     */
    const localMethods = await port.getPaymentMethods({ yearMonth: '2026-08' }, real.projectId);
    eq('결제수단: 줄 수', localMethods.length, server.paymentMethods.length);
    const methodById = new Map(
      server.paymentMethods.map((row) => [`${row.kind}:${row.id}`, row]),
    );
    let methodMismatch = 0;
    const methodFields = [
      'kind', 'name', 'ownerId', 'ownerName', 'amount', 'count', 'income',
      'performanceTarget', 'color', 'statementClosingDay',
    ] as const;
    for (const row of localMethods) {
      const serverRow = methodById.get(`${row.kind}:${row.id}`);
      if (!serverRow) {
        methodMismatch += 1;
        console.log(`FAIL  결제수단: 서버에 없는 줄 ${row.name}`);
        continue;
      }
      for (const field of methodFields) {
        if (String((row as Record<string, unknown>)[field]) !== String(serverRow[field])) {
          methodMismatch += 1;
          console.log(
            `FAIL  결제수단: ${row.name}.${field} (서버 ${serverRow[field]}, 사본 ${(row as Record<string, unknown>)[field]})`,
          );
        }
      }
    }
    eq(`결제수단: 필드 ${methodFields.length}개를 줄마다 대조`, methodMismatch, 0);
    eq('결제수단: 안 쓴 수단도 0원으로 남는다',
      localMethods.some((row) => row.amount === '0'), true);

    /*
     * 카드 실적.
     *
     * 할부가 이 검사의 요지다. 8/20 에 30만원을 3개월로 긁었으므로 이번 주기에는
     * 10만원만 잡혀야 한다. 사본이 할부 개월수를 받지 못하면 30만이 통째로 잡혀
     * 이 줄이 어긋난다.
     */
    const localPerf = await port.getCardPerformance(server.cardId);
    for (const field of [
      'basis', 'periodStart', 'periodEnd', 'usage',
      'previousPeriodStart', 'previousPeriodEnd', 'previousUsage',
      'target', 'achieved', 'remaining', 'currency',
    ] as const) {
      eq(`카드 실적: ${field}`, String(localPerf[field]), String(server.cardPerformance[field]));
    }

        const serverDining = server.budgets.find((row) => row.categoryName === '외식');
    eq('서버와 대조: 예산 금액', dining?.monthlyAmount, serverDining?.monthlyAmount);
    eq('서버와 대조: 예산 사용액', dining?.usedAmount, serverDining?.usedAmount);
    const serverTotalExpense = server.budgets.find(
      (row) => !row.categoryId && row.categoryType === 'expense',
    );
    eq('서버와 대조: 전체 지출 사용액',
      budgetRows.find((row) => !row.categoryId && row.categoryType === 'expense')?.usedAmount,
      serverTotalExpense?.usedAmount);

    // ── 가계 목록: 사본이 만든 줄이 서버가 만든 줄과 같은가 ──
    //
    // 목록 한 줄로 펴는 규칙(entry-view)이 이제 공용이므로 같은 값이 나와야 한다.
    const localEntries = await port.getAllEntries(
      { startDate: '2026-07-31T15:00:00.000Z', endDate: '2026-08-31T14:59:59.999Z' },
      real.projectId,
    );
    const serverEntries = server.entries;
    eq('목록: 건수', localEntries.length, serverEntries.length);

    const byId = new Map(serverEntries.map((row) => [String(row.id), row]));
    let mismatch = 0;
    const compared = [
      'kind', 'description', 'amount', 'extraAmount', 'categoryName', 'parentCategoryName',
      'accountName', 'personName', 'toAccountName', 'cardName', 'feeAmount',
      'originalCurrency', 'originalAmount', 'exchangeRate', 'rateProvisional',
      // 할부 개월수. 사본이 계획을 받지 못하면 여기서 null 이 되어 드러난다.
      'installmentMonths',
    ] as const;
    for (const row of localEntries) {
      const serverRow = byId.get(String(row.id));
      if (!serverRow) {
        mismatch += 1;
        console.log(`FAIL  목록: 서버에 없는 줄 ${row.id}`);
        continue;
      }
      for (const field of compared) {
        if (String((row as Record<string, unknown>)[field]) !== String(serverRow[field])) {
          mismatch += 1;
          console.log(
            `FAIL  목록: ${row.description}.${field} (서버 ${serverRow[field]}, 사본 ${(row as Record<string, unknown>)[field]})`,
          );
        }
      }
    }
    eq(`목록: 필드 ${compared.length}개를 줄마다 대조`, mismatch, 0);
    eq('목록: 할부 개월수가 실려 온다',
      localEntries.find((row) => row.description === '노트북')?.installmentMonths, 3);
    eq('목록: 일시불은 null',
      localEntries.find((row) => row.description === '카드 커피')?.installmentMonths ?? null, null);
        eq('목록: 날짜 내림차순', localEntries.map((row) => row.date).join(',') ===
      [...localEntries].map((row) => row.date).sort().reverse().join(','), true);

    // 필터도 같은 규칙인가
    const onlyExtra = await port.getAllEntries(
      { startDate: '2026-07-31T15:00:00.000Z', endDate: '2026-08-31T14:59:59.999Z', extraTypes: 'extra' },
      real.projectId,
    );
    eq('목록: 과소비만 (장보기 한 건)', onlyExtra.map((row) => row.description).join(','), '장보기');

    // ── 커서 페이지: 서버와 같은 자리에서 끊는가 ──
    const localFirst = await port.getEntries(
      { startDate: '2026-07-31T15:00:00.000Z', endDate: '2026-08-31T14:59:59.999Z', limit: 1 },
      real.projectId,
    );
    eq('첫 쪽: 건수', localFirst.data.length, server.firstPage.data.length);
    eq('첫 쪽: 같은 거래', localFirst.data[0]?.description, server.firstPage.data[0]?.description);
    eq('첫 쪽: 커서 모양이 서버와 같다', localFirst.nextCursor, server.firstPage.nextCursor);

    // 그 커서로 이어 받으면 다음 줄이 온다
    const localSecond = await port.getEntries(
      {
        startDate: '2026-07-31T15:00:00.000Z',
        endDate: '2026-08-31T14:59:59.999Z',
        limit: 1,
        cursor: localFirst.nextCursor ?? undefined,
      },
      real.projectId,
    );
    eq('둘째 쪽: 다른 거래', localSecond.data[0]?.description !== localFirst.data[0]?.description, true);

    /*
     * 커서를 끝까지 따라가면 목록 전체와 같은 줄이 같은 순서로 나온다.
     *
     * "둘째 쪽에서 끝난다"고 적어 두면 검사 데이터가 늘 때마다 이 줄이 깨진다. 확인하고
     * 싶은 것은 쪽수가 아니라 쪽을 이어 붙인 결과가 한 번에 읽은 것과 같다는 사실이다.
     */
    const paged: string[] = [];
    let cursor: string | null | undefined = undefined;
    for (let guard = 0; guard < 100; guard += 1) {
      const page = await port.getEntries(
        {
          startDate: '2026-07-31T15:00:00.000Z',
          endDate: '2026-08-31T14:59:59.999Z',
          limit: 1,
          cursor: cursor ?? undefined,
        },
        real.projectId,
      );
      paged.push(...page.data.map((row) => row.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    eq('커서를 끝까지 따라가면 목록과 같다',
      paged.join(','), localEntries.map((row) => row.id).join(','));

    /*
     * ── 거래 화면 ──
     *
     * 년월 목록, 분류별 구성비, 그리고 검색. 셋 다 사본 창구가 서버와 같은 숫자를 내야
     * 그 화면이 오프라인에서 돈다.
     */
    const localMonths = await port.getEntryMonths(real.projectId);
    eq('거래 화면: 달 수', localMonths.length, dump.server.entryMonths.length);
    eq('거래 화면: 최신 달',
      localMonths[0]?.yearMonth, dump.server.entryMonths[0]?.yearMonth);
    eq('거래 화면: 그 달 지출',
      localMonths[0]?.expense, dump.server.entryMonths[0]?.expense);
    eq('거래 화면: 그 달 수입',
      localMonths[0]?.income, dump.server.entryMonths[0]?.income);

    const localBreakdown = await port.getCategoryBreakdown(
      { yearMonth: '2026-08' },
      'expense',
      real.projectId,
    );
    eq('거래 화면: 구성비 줄 수', localBreakdown.length, dump.server.categoryBreakdown.length);
    eq('거래 화면: 구성비 첫 줄 금액',
      localBreakdown[0]?.amount, dump.server.categoryBreakdown[0]?.amount);
    eq('거래 화면: 구성비 첫 줄 이름',
      localBreakdown[0]?.categoryName, dump.server.categoryBreakdown[0]?.categoryName);

    /*
     * 검색이 년월 목록에도 걸리는가. 걸리지 않으면 검색을 켠 채 달을 훑을 때 줄에 적힌
     * 금액과 그 안을 펴서 나온 거래의 합이 어긋난다.
     */
    const searchedMonths = await port.getEntryMonths(real.projectId, {
      categoryIds: dump.server.searchCategoryId,
    });
    eq('거래 화면: 검색한 달 수', searchedMonths.length, dump.server.searchedMonths.length);
    eq('거래 화면: 검색한 달 지출',
      searchedMonths[0]?.expense, dump.server.searchedMonths[0]?.expense);

    /*
     * 무리끼리 AND. 분류 하나와 카드 하나를 함께 고른 검색이다.
     *
     * 무리를 잘못 이으면 여기서 갈린다 -- OR 로 이으면 결과가 늘고, 계좌와 카드를
     * AND 로 묶으면 0건이 된다.
     */
    const searched = await port.getAllEntries(
      {
        categoryIds: dump.server.searchCategoryId,
        paymentCardIds: dump.server.cardId,
        limit: 200,
      },
      real.projectId,
    );
    eq('거래 화면: 검색 결과 건수', searched.length, dump.server.searchedEntries.length);
    eq('거래 화면: 검색 결과가 같은 거래다',
      searched.map((row) => row.id).join(','),
      dump.server.searchedEntries.map((row) => row.id).join(','));

    // 고르지 않은 무리는 조건이 서지 않는다. 빈 값과 다르다.
    const noSearch = await port.getAllEntries({ limit: 200 }, real.projectId);
    eq('거래 화면: 검색을 걸지 않으면 전부', noSearch.length >= searched.length, true);

    /*
     * 달 경계. 사본과 서버가 달을 같은 자리에서 자르는가.
     *
     * 목록을 한 달로 좁힐 때는 **달 이름을 그대로** 넘긴다. 부르는 쪽이 구간을 만들면
     * 두 가지가 어긋난다 -- `new Date('2026-11-31')` 은 12월 1일로 넘어가고, UTC 자정은
     * 한국의 오전 9시다. 서버는 프로젝트 타임존으로, 기기는 박아 둔 `yearMonth` 컬럼으로
     * 각자 경계를 만드는데 그 둘이 같은 답이어야 한다.
     */
    for (const [yearMonth, ids] of Object.entries(dump.server.monthEntries)) {
      const local = await port.getAllEntries({ yearMonth, limit: 200 }, real.projectId);
      eq(
        `거래 화면: ${yearMonth} 목록이 서버와 같다`,
        local.map((row) => row.id).sort().join(','),
        [...ids].sort().join(','),
      );
    }

    /*
     * 유형 필터. 사본의 SQL 과 서버의 Prisma 조건이 같은 답을 내는가.
     *
     * 유형은 저장된 값이 아니라 다리에서 유도된다(`classifyEntry`). 두 조건을 손으로
     * 옮겼으므로 갈릴 수 있고, 갈리면 같은 검색이 온라인과 오프라인에서 다른 목록을 낸다.
     */
    for (const [kind, ids] of Object.entries(dump.server.kindEntries)) {
      const local = await port.getAllEntries({ kinds: kind, limit: 200 }, real.projectId);
      eq(
        `거래 화면: 유형 ${kind} 이 서버와 같다`,
        local.map((row) => row.id).sort().join(','),
        [...ids].sort().join(','),
      );
    }

    realDriver.close();
  } else {
    console.log(`\n(건너뜀) 실제 응답 파일이 없다: ${dumpPath}`);
  }

  console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`);
  process.exit(fail === 0 ? 0 : 1);
})();

// node:sqlite 는 실험 기능이라 경고를 낸다. 검증 출력이 묻히지 않게 지운다.
void DatabaseSync;
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name !== 'ExperimentalWarning') console.warn(warning);
});
