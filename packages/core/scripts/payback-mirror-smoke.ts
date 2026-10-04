/**
 * 기기 사본의 페이백 (PAYBACK_DESIGN.md 8단계).
 *
 * 실행: cd packages/core && node -r ../api/node_modules/ts-node/register/transpile-only \
 *       scripts/payback-mirror-smoke.ts
 *
 * 서버의 `payback-smoke` 10절과 같은 숫자를 사본이 내는지 본다.
 *
 *   1. **링크를 받는다.** 동기화로 온 페이백의 원거래·줄이 사본에 남고 목록 한 줄에 실린다.
 *   2. **분석은 원거래의 달.** 요약·분류별·예산 사용액이 페이백을 원거래의 달에 순액으로 센다.
 *   3. **거래 탭의 달 목록은 들어온 날짜.** (결정 G)
 *   4. **받은 페이백과 분석 기준 목록.** `paybackOf`, `dateBasis: 'analysis'`.
 *   5. **끊긴 채 적은 페이백.** 앱 창구가 사본에 링크를 적는다.
 *   6. **원거래의 자리표만 오면 링크만 빈다.** 7-6 전의 서버가 지운 것. 페이백은 자기 달로 옮겨 간다.
 *   7. **앱에서 원거래를 지우면 걸린 환불·페이백도 함께 지운다** (7-6). 명령은 원거래 하나다.
 */
import { type SyncDto } from '@money/types';

import { httpHomePort } from '../src/data/home-port';
import { createLocalEntryWriter } from '../src/data/local-entry-writer';
import { createLocalHomePort } from '../src/data/local-home-port';
import { LocalStore } from '../src/data/local-store';
import { nodeSqliteDriver } from './node-sqlite-driver';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

const KST = 'Asia/Seoul';
const PID = 'project-1';

/** 통장 a1 과 식비 분류 하나짜리 전표. 금액이 음수면 페이백이다 (지출 분류 -, 통장 +). */
const entry = (
  id: string,
  description: string,
  date: string,
  amount: string,
  link: { entryId: string; lineKey: string } | null = null,
  paybackType: string | null = null,
) => ({
  id,
  projectId: PID,
  personId: 'p1',
  date,
  description,
  merchant: null,
  detailedNote: null,
  originalCurrency: null,
  originalAmount: null,
  rateProvisional: false,
  countsPerformance: true,
  discountCountsPerformance: true,
  createdByUserId: null,
  updatedVersion: 1,
  paybackOfEntryId: link?.entryId ?? null,
  paybackOfLineKey: link?.lineKey ?? null,
  paybackType,
  tagLinks: [],
  postings: [
    {
      id: `${id}-cat`, entryId: id, accountId: null, categoryId: 'c-food',
      amount, quantity: null, currency: 'KRW', baseAmount: amount,
      exchangeRate: '1', cardId: null, lineKey: `${id}-line`,
    },
    {
      id: `${id}-acc`, entryId: id, accountId: 'a1', categoryId: null,
      amount: String(-Number(amount)), quantity: null, currency: 'KRW',
      baseAmount: String(-Number(amount)), exchangeRate: '1', cardId: null,
    },
  ],
});

const pull = (
  version: number,
  changes: Partial<SyncDto.Changes>,
  tombstones: SyncDto.PullResponse['tombstones'] = [],
): SyncDto.PullResponse => ({
  projectId: PID,
  since: version - 1,
  version,
  hasMore: false,
  tombstones,
  tombstoneFloor: 0,
  changes: {
    project: null, members: [], people: [], accounts: [], categories: [], tags: [], cards: [],
    entries: [], budgets: [], budgetOverrides: [], exchangeRates: [], assetValuations: [],
    installmentPlans: [], entryDrafts: [], recurringRules: [],
    ...changes,
  } as unknown as SyncDto.Changes,
});

(async () => {
  const store = new LocalStore(nodeSqliteDriver());
  await store.init(PID, KST);

  await store.applyPull(
    pull(1, {
      project: {
        id: PID, name: '우리집', projectKey: null, description: null,
        ledgerCurrency: 'KRW', displayCurrency: 'KRW', timezone: KST, updatedVersion: 1,
      } as never,
      people: [
        { id: 'p1', projectId: PID, name: '김철수', relationship: null, isActive: true, sortOrder: 0, updatedVersion: 1 },
      ] as never,
      accounts: [
        { id: 'a1', projectId: PID, ownerId: 'p1', type: 'deposit', name: '월급통장', institutionId: null, accountNumber: null, currency: 'KRW', balance: '0', isActive: true, sortOrder: 0, updatedVersion: 1 },
      ] as never,
      categories: [
        { id: 'c-food', projectId: PID, name: '식비', parentId: null, type: 'expense', icon: null, isDefault: false, sortOrder: 0, updatedVersion: 1 },
        { id: 'c-life', projectId: PID, name: '생활', parentId: null, type: 'expense', icon: null, isDefault: false, sortOrder: 1, updatedVersion: 1 },
      ] as never,
      budgets: [
        { id: 'b-food', projectId: PID, categoryId: 'c-food', tagId: null, type: 'expense', monthlyAmount: '50000', effectiveFrom: null, effectiveTo: null, updatedVersion: 1 },
      ] as never,
      entries: [
        entry('e-spent', '회식', '2026-09-05T03:00:00.000Z', '100000'),
        entry('e-back', '회식 정산', '2026-10-10T03:00:00.000Z', '-90000', { entryId: 'e-spent', lineKey: 'e-spent-line' }),
        entry('e-lunch', '점심', '2026-10-12T03:00:00.000Z', '20000'),
        entry('e-ghost', '적립', '2026-10-15T03:00:00.000Z', '-1000'),
        entry('e-refund', '반품', '2026-10-16T03:00:00.000Z', '-500', null, 'refund'),
      ] as never,
    }),
    KST,
  );

  const port = createLocalHomePort(store, {
    fallback: Object.fromEntries(
      Object.keys(httpHomePort).map((name) => [
        name,
        async () => {
          throw Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
        },
      ]),
    ) as unknown as typeof httpHomePort,
  });

  console.log('\n== 1. 링크를 받는다 ==');
  const listed = await port.getAllEntries({}, PID);
  const back = listed.find((item) => item.id === 'e-back');
  eq('갈래는 payback', back?.kind, 'payback');
  eq('링크가 실린다', `${back?.paybackOfEntryId} ${back?.paybackOfLineKey}`, 'e-spent e-spent-line');
  eq('원거래 날짜가 실린다', back?.paybackOfDate?.slice(0, 10), '2026-09-05');
  eq('종류를 받는다 (비면 페이백)', `${back?.paybackType} ${listed.find((item) => item.id === 'e-refund')?.paybackType}`, 'payback refund');

  console.log('\n== 2. 분석은 원거래의 달 ==');
  const expenseOf = async (yearMonth: string) => (await port.getSummary({ yearMonth }, PID)).expense;
  eq('9월 지출은 순액 (10만 − 9만)', await expenseOf('2026-09'), '10000');
  eq('10월 지출 (2만 − 링크 없는 1천 − 환불 5백)', await expenseOf('2026-10'), '18500');
  const breakdown = await port.getCategoryBreakdown({ yearMonth: '2026-09' }, 'expense', PID);
  eq('9월 분류별 식비', breakdown.find((row) => row.categoryId === 'c-food')?.amount, '10000');
  const budget = await port.getBudgetForMonth(2026, 9, PID);
  eq('9월 식비 예산 사용액', budget.find((row) => row.categoryId === 'c-food')?.usedAmount, '10000');

  console.log('\n== 3. 거래 탭의 달 목록은 들어온 날짜 ==');
  const months = await port.getEntryMonths(PID, {});
  const monthOf = (key: string) => months.find((row) => row.yearMonth === key);
  eq('9월 지출은 원거래 그대로', monthOf('2026-09')?.expense, '100000');
  eq('10월 지출은 2만 − 9만 − 1천 − 5백', monthOf('2026-10')?.expense, '-71500');

  console.log('\n== 4. 받은 페이백과 분석 기준 목록 ==');
  const linked = await port.getAllEntries({ paybackOf: 'e-spent' }, PID);
  eq('원거래에 걸린 페이백만', linked.map((item) => item.id).join(','), 'e-back');
  const septIds = async (extra: object) =>
    (await port.getAllEntries({ startDate: '2026-09-01', endDate: '2026-09-30', ...extra }, PID))
      .map((item) => item.id)
      .sort()
      .join(',');
  eq('분석 기준이면 9월 목록에 페이백이 든다', await septIds({ dateBasis: 'analysis' }), 'e-back,e-spent');
  eq('전표 날짜 기준이면 없다', await septIds({}), 'e-spent');

  console.log('\n== 5. 끊긴 채 적은 페이백 ==');
  await store.ensureClient(() => 'client-payback');
  const writer = createLocalEntryWriter({ store, projectId: PID, timeZone: KST });
  await writer.createEntry({
    id: 'e-offline',
    kind: 'payback',
    personId: 'p1',
    date: '2026-10-20T03:00:00.000Z',
    description: '오프라인 캐시백',
    accountId: 'a1',
    categoryId: 'c-food',
    amount: '5000',
    lineKey: 'e-offline-line',
    paybackOfEntryId: 'e-spent',
    paybackOfLineKey: 'e-spent-line',
    paybackType: 'refund',
  } as never);
  const offlineRows = await port.getAllEntries({ paybackOf: 'e-spent' }, PID);
  const offline = offlineRows.map((item) => item.id).sort();
  eq('사본에 링크가 적힌다', offline.join(','), 'e-back,e-offline');
  eq('9월 지출이 곧바로 줄어든다', await expenseOf('2026-09'), '5000');
  eq('종류가 사본에 적힌다', offlineRows.find((item) => item.id === 'e-offline')?.paybackType, 'refund');

  console.log('\n== 5-2. 끊긴 채 원거래를 고칠 때 (7-4) ==');
  // e-spent 식비 10만에 걸린 것: 9만(e-back) + 5천(e-offline) = 9.5만
  const editSpent = (body: object) =>
    writer.updateEntry('e-spent', {
      kind: 'expense', personId: 'p1', date: '2026-09-05T03:00:00.000Z', description: '회식',
      accountId: 'a1', lineKey: 'e-spent-line', ...body,
    } as never);
  const codeOf = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return '통과';
    } catch (error) {
      return (error as { code?: string }).code ?? String(error);
    }
  };
  eq('돌려받은 것보다 작게 줄이면 거부', await codeOf(() => editSpent({ categoryId: 'c-food', amount: '90000' })), 'PAYBACK_EXCEEDS_LINE');
  eq('거부되면 큐에 쌓이지 않는다',
    (await store.pendingMutations(PID)).filter((row) => row.kind === 'entry.replace').length, 0);
  eq('분류를 바꾸면 통과', await codeOf(() => editSpent({ categoryId: 'c-life', amount: '100000' })), '통과');
  const moved = await port.getAllEntries({ paybackOf: 'e-spent' }, PID);
  eq('걸린 것의 분류가 따라간다', moved.map((item) => item.categoryId).join(','), 'c-life,c-life');
  eq('넘는 새 환불·페이백은 거부', await codeOf(() => writer.createEntry({
    id: 'e-over', kind: 'payback', personId: 'p1', date: '2026-10-21T03:00:00.000Z', description: '초과',
    accountId: 'a1', categoryId: 'c-life', amount: '10000', lineKey: 'e-over-line',
    paybackOfEntryId: 'e-spent', paybackOfLineKey: 'e-spent-line',
  } as never)), 'PAYBACK_EXCEEDS_LINE');

  console.log('\n== 6. 원거래의 자리표만 오면 링크만 빈다 (7-6 전의 서버) ==');
  await store.applyPull(
    pull(2, {}, [{ entity: 'JournalEntry', entityId: 'e-spent', deletedVersion: 2 }] as never),
    KST,
  );
  const afterTomb = await port.getAllEntries({}, PID);
  eq('걸린 둘 다 남는다', afterTomb.filter((item) => ['e-back', 'e-offline'].includes(item.id)).length, 2);
  const orphan = afterTomb.find((item) => item.id === 'e-back');
  eq('페이백은 남는다', orphan?.kind, 'payback');
  eq('링크가 빈다', orphan?.paybackOfEntryId, null);
  eq('9월은 0', await expenseOf('2026-09'), '0');
  eq('10월로 옮겨 간다 (2만 − 9만 − 1천 − 5백 − 5천)', await expenseOf('2026-10'), '-76500');

  console.log('\n== 7. 앱에서 원거래를 지운다 ==');
  await writer.createEntry({
    id: 'e-shop', kind: 'expense', personId: 'p1', date: '2026-10-01T03:00:00.000Z', description: '마트',
    accountId: 'a1', categoryId: 'c-food', amount: '150000', lineKey: 'e-shop-line',
  } as never);
  for (const [id, amount, type] of [['e-cb', '30000', 'payback'], ['e-rf', '20000', 'refund']]) {
    await writer.createEntry({
      id, kind: 'payback', personId: 'p1', date: '2026-10-02T03:00:00.000Z', description: '마트',
      accountId: 'a1', categoryId: 'c-food', amount, lineKey: `${id}-line`,
      paybackOfEntryId: 'e-shop', paybackOfLineKey: 'e-shop-line', paybackType: type,
    } as never);
  }
  const queuedBefore = (await store.pendingMutations(PID)).length;
  await writer.deleteEntry('e-shop');
  const left = (await port.getAllEntries({}, PID)).filter((item) => ['e-shop', 'e-cb', 'e-rf'].includes(item.id));
  eq('원거래와 걸린 둘이 모두 사라진다', left.length, 0);
  const queued = (await store.pendingMutations(PID)).slice(queuedBefore);
  eq('명령은 원거래 지우기 하나 (서버가 걸린 것을 함께 지운다)',
    queued.map((row) => `${row.kind}:${row.targets.join('+')}`).join(','), 'entry.delete:e-shop');
  eq('다른 원거래에 걸린 것은 그대로', (await port.getAllEntries({}, PID)).some((item) => item.id === 'e-back'), true);

  console.log(fail === 0 ? '\n전부 통과' : `\n${fail}개 실패`);
  process.exit(fail === 0 ? 0 : 1);
})();
