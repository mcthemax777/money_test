/**
 * 사본에서 본 환율 목록. 서버의 `GET /exchange-rates`(ExchangeRatesService.getRate)와 같은 차례여야 한다.
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/exchange-rate-mirror-smoke.ts
 *
 *   1. 그 쌍을 직접 정한 최신 값 (날짜가 늦은 것)
 *   2. 반대 방향만 있으면 역수
 *   3. 고정값
 * 표시 통화 환산도 같은 환율을 써야 한다 -- 예전에는 저장된 값이 없으면 1 이었다.
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
        ledgerCurrency: 'KRW', displayCurrency: 'USD', timezone: KST, updatedVersion: 1,
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
      exchangeRates: [
        // USD -> KRW 를 두 번 정했다. 늦은 날짜가 이긴다.
        { id: 'r1', projectId: PID, baseCurrency: 'USD', quoteCurrency: 'KRW', rate: '1300', date: '2026-08-01T00:00:00.000Z', source: 'manual', updatedVersion: 1 },
        { id: 'r2', projectId: PID, baseCurrency: 'USD', quoteCurrency: 'KRW', rate: '1350', date: '2026-09-01T00:00:00.000Z', source: 'manual', updatedVersion: 1 },
      ],
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

  const res = await port.getExchangeRates(PID);
  const rate = (from: string) => res.rates.find((row) => row.from === from);

  console.log('\n== 환율 목록 ==');
  eq('저장 통화', res.ledgerCurrency, 'KRW');
  eq('표시 통화', res.displayCurrency, 'USD');
  eq('저장 통화 말고 지원 통화마다 한 줄', res.rates.map((row) => row.from).sort().join(','), 'JPY,USD');
  eq('직접 정한 값: 늦은 날짜', rate('USD')?.rate, '1350');
  eq('직접 정한 값의 출처와 날짜', `${rate('USD')?.source} ${rate('USD')?.date}`, 'manual 2026-09-01');
  eq('정하지 않은 통화는 고정값', rate('JPY')?.source, 'fallback');
  eq('표시 환율은 반대 방향의 역수', res.displayRate.rate, '0.00074074');
  eq('역수라고 적는다', res.displayRate.source, 'manual (역수)');

  console.log('\n== 표시 통화 환산 ==');
  // 점심 7,000 + 교통 3,000 (원) = 10,000원 -> 10,000 x 0.00074074 = 7.4074 -> 센트까지 7.41
  const summary = await port.getSummary({ yearMonth: thisMonth }, PID);
  eq('합계가 역수 환율로 환산된다 (1 이 아니다)', summary.expense, '7.41');

  console.log(fail === 0 ? '\n전부 통과' : `\n${fail}개 실패`);
  process.exit(fail === 0 ? 0 : 1);
})();
