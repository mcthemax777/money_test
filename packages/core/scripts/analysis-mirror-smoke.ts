/**
 * 사본에서 본 분석 창. 서버 쪽 짝은 `api/scripts/tag-budget-smoke.ts` 의 5·6절이다.
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/analysis-mirror-smoke.ts
 *
 * 분석 창(가계·예산·거래)은 12개월 추이와 거래 목록을 창구로 받는다. 앱이 끊겨 있으면 사본이
 * 답하므로, 서버와 같은 규칙이어야 한다.
 *   - 추이: 분류(소분류 포함·미분류만)·전체·태그, 검색 조건, 회차 기준, 기간 자르기
 *   - 거래 목록: 분류 하나·"미분류만"·유형 조건
 */
import { zonedDayStart, zonedParts, type SyncDto } from '@money/types';

import { httpHomePort } from '../src/data/home-port';
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

const today = zonedParts(new Date(), KST);
/** 이번 달 10일에서 back 달 앞, 정오. 달 경계에 걸리지 않게 한낮으로 둔다. */
const monthsAgo = (back: number) =>
  new Date(zonedDayStart(today.year, today.month - back, 10, KST).getTime() + 12 * 3600_000)
    .toISOString();
const thisMonth = `${today.year}-${String(today.month).padStart(2, '0')}`;

/** 카드 결제 한 건. 분류 줄은 (분류, 금액, 태그) 로 준다. */
const entry = (
  id: string,
  description: string,
  date: string,
  lines: Array<{ categoryId: string; amount: string; tagIds: string[] }>,
) => {
  const total = lines.reduce((sum, line) => sum + Number(line.amount), 0);
  return {
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
    tagLinks: lines.flatMap((line, index) =>
      line.tagIds.map((tagId) => ({ lineKey: `${id}-line${index}`, tagId })),
    ),
    postings: [
      ...lines.map((line, index) => ({
        id: `${id}-cat${index}`, entryId: id, accountId: null, categoryId: line.categoryId,
        amount: line.amount, quantity: null, currency: 'KRW', baseAmount: line.amount,
        exchangeRate: '1', cardId: null, lineKey: `${id}-line${index}`,
      })),
      {
        id: `${id}-acc`, entryId: id, accountId: 'a2', categoryId: null,
        amount: String(-total), quantity: null, currency: 'KRW', baseAmount: String(-total),
        exchangeRate: '1', cardId: 'card-1',
      },
    ],
  };
};

(async () => {
  const store = new LocalStore(nodeSqliteDriver());
  await store.init(PID, KST);

  const response: SyncDto.PullResponse = {
    projectId: PID,
    since: 0,
    version: 1,
    hasMore: false,
    tombstones: [],
    tombstoneFloor: 0,
    changes: {
      project: {
        id: PID, name: '우리집', projectKey: null, description: null,
        ledgerCurrency: 'KRW', displayCurrency: 'KRW', timezone: KST, updatedVersion: 1,
      },
      members: [],
      people: [
        { id: 'p1', projectId: PID, name: '김철수', relationship: null, isActive: true, sortOrder: 0, updatedVersion: 1 },
      ],
      accounts: [
        { id: 'a1', projectId: PID, ownerId: 'p1', type: 'deposit', name: '보통예금', institutionId: null, accountNumber: null, currency: 'KRW', balance: '0', isActive: true, sortOrder: 0, updatedVersion: 1 },
        { id: 'a2', projectId: PID, ownerId: 'p1', type: 'credit_card', name: '신한 신용', institutionId: null, accountNumber: null, currency: 'KRW', balance: '0', isActive: true, sortOrder: 1, updatedVersion: 1 },
      ],
      categories: [
        { id: 'c-food', projectId: PID, name: '식비', parentId: null, type: 'expense', icon: null, isDefault: false, sortOrder: 0, updatedVersion: 1 },
        { id: 'c-ride', projectId: PID, name: '교통', parentId: null, type: 'expense', icon: null, isDefault: false, sortOrder: 1, updatedVersion: 1 },
        { id: 'c-refund', projectId: PID, name: '환불', parentId: null, type: 'income', icon: null, isDefault: false, sortOrder: 2, updatedVersion: 1 },
      ],
      tags: [
        { id: 't-trip', projectId: PID, name: '여행', color: '#3b82f6', sortRank: 'V', updatedVersion: 1 },
        { id: 't-team', projectId: PID, name: '회식', color: null, sortRank: 'W', updatedVersion: 1 },
      ],
      cards: [
        { id: 'card-1', projectId: PID, paymentAccountId: 'a1', liabilityAccountId: 'a2', name: '신한 신용', cardType: 'credit', issuerId: null, cardNumber: null, statementClosingDay: 15, paymentDueDay: 25, color: null, performanceAmount: '300000', isActive: true, sortOrder: 0, updatedVersion: 1 },
      ],
      entries: [
        // 식비 7,000(여행) + 교통 3,000(태그 없음)
        entry('e-lunch', '여행 중 점심', monthsAgo(0), [
          { categoryId: 'c-food', amount: '7000', tagIds: ['t-trip'] },
          { categoryId: 'c-ride', amount: '3000', tagIds: [] },
        ]),
        // 여행 경비 정산으로 돌려받은 5,000 (수입). 여행 사용액에서 빠진다.
        entry('e-back', '정산', monthsAgo(0), [
          { categoryId: 'c-refund', amount: '-5000', tagIds: ['t-trip'] },
        ]),
        // 두 달 전 3개월 무이자 할부 30만원(여행). 이번 달에는 3회차 10만원이 선다.
        entry('e-bag', '여행 가방', monthsAgo(2), [
          { categoryId: 'c-food', amount: '300000', tagIds: ['t-trip', 't-team'] },
        ]),
      ],
      budgets: [
        { id: 'b-total', projectId: PID, categoryId: null, tagId: null, type: 'expense',
          monthlyAmount: '500000', effectiveFrom: null, effectiveTo: null, updatedVersion: 1 },
        { id: 'b-trip', projectId: PID, categoryId: null, tagId: 't-trip', type: null,
          monthlyAmount: '150000', effectiveFrom: null, effectiveTo: null, updatedVersion: 1 },
      ],
      budgetOverrides: [],
      exchangeRates: [],
      assetValuations: [],
      installmentPlans: [
        {
          id: 'plan-1', postingId: 'e-bag-acc', totalMonths: 3, interestBearing: false,
          principalShares: null, interestShares: null,
          monthlyPayment: null, annualRate: null, updatedVersion: 1,
        },
      ],
      entryDrafts: [],
    } as unknown as SyncDto.Changes,
  };

  await store.applyPull(response, KST);

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

  const [year, month] = thisMonth.split('-').map(Number);
  const twoAgo = new Date(Date.UTC(year, month - 3, 1)).toISOString().slice(0, 7);
  const trend = async (target: 'category' | 'total' | 'tag', options: Record<string, unknown>) =>
    (await port.getTrend(target, { endMonth: thisMonth, months: 3, ...options } as never, PID))
      .map((point) => point.amount)
      .join(',');

  console.log('\n== 추이 ==');
  // 두 달 전: 가방 300,000 / 지난달: 없음 / 이번 달: 점심 7,000 + 교통 3,000
  eq('전체 지출 (발생 기준)', await trend('total', { type: 'expense' }), '300000,0,10000');
  eq('전체 지출 (회차 기준): 가방이 달마다 100,000', await trend('total', { type: 'expense', basis: 'installment' }), '100000,100000,110000');
  eq('전체 수입', await trend('total', { type: 'income' }), '0,0,5000');
  eq('분류: 교통', await trend('category', { targetId: 'c-ride' }), '0,0,3000');
  eq('분류: 식비', await trend('category', { targetId: 'c-food' }), '300000,0,7000');
  eq('태그: 여행 지출 (회차 기준)', await trend('tag', { targetId: 't-trip', type: 'expense', basis: 'installment' }), '100000,100000,107000');
  eq('검색: 교통으로 좁힌 전체 (분할의 식비 줄은 빠진다)', await trend('total', { type: 'expense', categoryIds: 'c-ride' }), '0,0,3000');
  eq('검색: 태그로 좁힌 전체', await trend('total', { type: 'expense', tagIds: 't-team' }), '300000,0,0');
  eq('기간 자르기: 지난달부터', await trend('total', { type: 'expense', clipFrom: `${shiftDay(twoAgo, 1)}T00:00:00.000Z` }), '0,0,10000');

  console.log('\n== 거래 목록 ==');
  const monthRange = {
    startDate: zonedDayStart(today.year, today.month, 1, KST).toISOString(),
    endDate: zonedDayStart(today.year, today.month + 1, 1, KST).toISOString(),
  };
  const ids = async (query: Record<string, unknown>) =>
    (await port.getAllEntries({ ...monthRange, ...query } as never, PID))
      .map((entry) => entry.id)
      .sort()
      .join(',');
  eq('조건 없음', await ids({}), 'e-back,e-lunch');
  eq('분류 하나: 교통', await ids({ categoryId: 'c-ride' }), 'e-lunch');
  eq('분류 하나: 환불', await ids({ categoryId: 'c-refund' }), 'e-back');
  eq('유형: 수입', await ids({ categoryType: 'income' }), 'e-back');
  eq('유형: 지출', await ids({ categoryType: 'expense' }), 'e-lunch');
  eq('미분류만: 식비에 바로 적은 것', await ids({ categoryId: 'c-food', categoryExact: true }), 'e-lunch');

  console.log(fail === 0 ? '\n전부 통과' : `\n${fail}개 실패`);
  process.exit(fail === 0 ? 0 : 1);
})();

/** "YYYY-MM" 의 d 일 "YYYY-MM-DD" 에서 한 달 뒤. 기간 자르기의 경계를 만든다. */
function shiftDay(yearMonth: string, months: number): string {
  const [y, m] = yearMonth.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 10);
}
