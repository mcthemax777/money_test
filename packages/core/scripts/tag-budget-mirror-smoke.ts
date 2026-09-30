/**
 * 사본에서 본 태그 예산. 서버 쪽 짝은 `api/scripts/tag-budget-smoke.ts` 다.
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/tag-budget-mirror-smoke.ts
 *
 * 오프라인에서도 서버와 같은 값이어야 한다.
 *   - 사용액은 태그가 붙은 줄의 지출 − 수입 (분할의 다른 줄은 빠진다), 할부는 회차 몫이다.
 *   - 태그 예산은 분류가 없는 줄이지만 전체 예산으로 읽히지 않는다.
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
  const tagRows = await port.getTagBudgetsForMonth(year, month, PID);
  const row = (tagId: string) => tagRows.find((candidate) => candidate.tagId === tagId);

  console.log('\n== 태그 예산 ==');
  eq('태그마다 한 줄', tagRows.length, 2);
  eq('여행 예산', row('t-trip')?.monthlyAmount, '150000');
  eq('여행 예산 id', row('t-trip')?.budgetId, 'b-trip');
  // 7,000 (점심의 식비 줄) + 100,000 (가방 3회차) − 5,000 (정산). 교통 3,000 은 태그가 없어 빠진다.
  eq('사용액은 태그 줄의 지출 − 수입, 할부는 회차 몫', row('t-trip')?.usedAmount, '102000');
  eq('한 줄에 태그 둘이면 둘 다 든다', row('t-team')?.usedAmount, '100000');
  eq('예산이 없는 줄은 자리표', row('t-team')?.budgetId.startsWith('placeholder-'), true);
  eq('태그 색이 실린다', row('t-trip')?.tagColor, '#3b82f6');

  console.log('\n== 분류 예산과 섞이지 않는다 ==');
  const budgetRows = await port.getBudgetForMonth(year, month, PID);
  const total = budgetRows.find((candidate) => !candidate.categoryId && candidate.categoryType === 'expense');
  eq('전체 지출 예산은 전체 예산 규칙', total?.budgetId, 'b-total');
  eq('전체 지출 예산 금액', total?.monthlyAmount, '500000');
  eq('분류 예산 목록에 태그 예산이 없다', budgetRows.some((candidate) => candidate.budgetId === 'b-trip'), false);

  console.log(fail === 0 ? '\n전부 통과' : `\n${fail}개 실패`);
  process.exit(fail === 0 ? 0 : 1);
})();
