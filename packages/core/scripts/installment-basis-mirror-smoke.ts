/**
 * 사본에서 본 회차 기준. 서버 쪽 짝은 `api/scripts/installment-basis-smoke.ts` 다.
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/installment-basis-mirror-smoke.ts
 *
 * 오프라인에서도 같은 값이 나와야 한다. 규칙(`expandInstallmentRows`)은 서버와 한 함수를
 * 쓰지만, 앞 달까지 넓혀 읽고 구간 밖을 버리는 길은 여기 따로 있다 -- 그 길이 어긋나면
 * 같은 달을 웹과 앱에서 다르게 보게 된다.
 */
import { shiftYearMonth, zonedDayStart, zonedParts, type SyncDto } from '@money/types';

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
const lastMonth = shiftYearMonth(today.year, today.month, -1);

const entry = (id: string, description: string, amount: string, date: string) => ({
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
  tagLinks: [] as Array<{ lineKey: string | null; tagId: string }>,
  postings: [
    {
      id: `${id}-cat`, entryId: id, accountId: null, categoryId: 'c-food',
      amount, quantity: null, currency: 'KRW', baseAmount: amount, exchangeRate: '1',
      cardId: null, lineKey: `${id}-line1`,
    },
    {
      id: `${id}-acc`, entryId: id, accountId: 'a2', categoryId: null,
      amount: `-${amount}`, quantity: null, currency: 'KRW', baseAmount: `-${amount}`,
      exchangeRate: '1', cardId: 'card-1',
    },
  ],
});

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
        { id: 'a2', projectId: PID, ownerId: 'p1', type: 'credit_card', name: '신한 신용', institutionId: null, accountNumber: null, currency: 'KRW', balance: '-316000', isActive: true, sortOrder: 1, updatedVersion: 1 },
      ],
      categories: [
        { id: 'c-food', projectId: PID, name: '식비', parentId: null, type: 'expense', icon: null, isDefault: false, sortOrder: 0, updatedVersion: 1 },
      ],
      tags: [],
      cards: [
        { id: 'card-1', projectId: PID, paymentAccountId: 'a1', liabilityAccountId: 'a2', name: '신한 신용', cardType: 'credit', issuerId: null, cardNumber: null, statementClosingDay: 15, paymentDueDay: 25, color: null, performanceAmount: '300000', isActive: true, sortOrder: 0, updatedVersion: 1 },
      ],
      entries: [
        /*
         * 두 달 전에 산 3개월 유이자 할부. 회차는 두 달 전·지난달·이번 달에 선다.
         *
         * 전표 금액은 **원금 300,000 + 이자 6,000** 이다. 카드에 갚을 돈이 그것이고,
         * 회차 원금은 여기서 이자를 뺀 값을 나눈다.
         */
        entry('e-fridge', '냉장고', '306000', monthsAgo(2)),
        // 이번 달 일시불. 회차 기준에서도 그대로 이번 달이다.
        entry('e-lunch', '점심', '10000', monthsAgo(0)),
      ],
      budgets: [
        { id: 'b1', projectId: PID, categoryId: 'c-food', type: null, monthlyAmount: '500000',
          effectiveFrom: null, effectiveTo: null, updatedVersion: 1 },
      ],
      budgetOverrides: [],
      exchangeRates: [],
      assetValuations: [],
      installmentPlans: [
        {
          id: 'plan-1', postingId: 'e-fridge-acc', totalMonths: 3, interestBearing: true,
          principalShares: null, interestShares: ['3000', '2000', '1000'],
          monthlyPayment: null, annualRate: '12', updatedVersion: 1,
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

  console.log('\n== 월 합계 ==');
  const accrual = await port.getSummary({ yearMonth: thisMonth }, PID);
  eq('발생 기준: 이번 달은 일시불만', accrual.expense, '10000');

  const spread = await port.getSummary({ yearMonth: thisMonth }, PID, {
    basis: 'installment',
  } as never);
  // 100,000 (3회차 원금) + 1,000 (3회차 이자) + 10,000 (일시불)
  eq('회차 기준: 3회차 + 일시불', spread.expense, '111000');

  const before = await port.getSummary({ yearMonth: lastMonth }, PID, {
    basis: 'installment',
  } as never);
  eq('회차 기준: 지난달은 2회차뿐', before.expense, '102000');

  console.log('\n== 분류별 ==');
  const breakdown = await port.getCategoryBreakdown({ yearMonth: thisMonth }, 'expense', PID, {
    basis: 'installment',
  } as never);
  eq('분류 합계도 같은 값', breakdown[0]?.amount, '111000');
  eq('분류는 거래의 분류를 따라간다', breakdown[0]?.categoryName, '식비');

  console.log('\n== 수단별 ==');
  const methods = await port.getPaymentMethods({ yearMonth: thisMonth }, PID, {
    basis: 'installment',
  } as never);
  eq(
    '카드 합계도 회차 몫',
    methods.find((row) => row.id === 'card-1')?.amount,
    '111000',
  );

  console.log('\n== 달 목록 ==');
  const months = await port.getEntryMonths(PID, { basis: 'installment' } as never);
  eq(
    '회차가 선 달이 목록에 있다',
    months.some((month) => month.yearMonth === lastMonth),
    true,
  );
  eq(
    '그 달의 금액은 회차 몫',
    months.find((month) => month.yearMonth === lastMonth)?.expense,
    '102000',
  );

  console.log('\n== 예산 ==');
  /*
   * 예산도 회차 기준이다. 서버와 같은 규칙이어야 같은 달의 진행률이 웹과 기기에서
   * 갈리지 않는다.
   */
  const [thisYear, thisMonthNumber] = thisMonth.split('-').map(Number);
  const budgetRows = await port.getBudgetForMonth(thisYear, thisMonthNumber, PID);
  eq(
    '예산 사용액은 회차 몫 (3회차 + 일시불)',
    budgetRows.find((row) => row.categoryId === 'c-food')?.usedAmount,
    '111000',
  );

  const [beforeYear, beforeMonthNumber] = lastMonth.split('-').map(Number);
  const beforeRows = await port.getBudgetForMonth(beforeYear, beforeMonthNumber, PID);
  eq(
    '지난달은 2회차뿐',
    beforeRows.find((row) => row.categoryId === 'c-food')?.usedAmount,
    '102000',
  );

  console.log('\n== 목록에 실을 지난 할부 ==');
  const range = {
    startDate: zonedDayStart(today.year, today.month, 1, KST).toISOString(),
    endDate: zonedDayStart(today.year, today.month + 1, 1, KST).toISOString(),
  };
  const past = await port.getInstallmentRows(range, PID);
  eq('지난 할부가 이번 달 목록에 실려 온다', past.length, 1);

  /*
   * 달 이름만 주어도 같은 답이어야 한다. 거래 화면이 달을 볼 때 보내는 모양이다
   * (`listRangeOf`). 서버와 사본이 같은 줄을 내야 한다.
   */
  const byMonth = await port.getInstallmentRows({ yearMonth: thisMonth } as never, PID);
  eq('달 이름만 주어도 실려 온다', byMonth.length, 1);
  eq('같은 거래다', byMonth[0]?.id, past[0]?.id);

  eq('그 거래가 냉장고', past[0]?.description, '냉장고');
  eq('회차 이자도 함께 온다', past[0]?.installmentInterestShares?.join(','), '3000,2000,1000');

  console.log(fail === 0 ? '\n전부 통과' : `\n${fail}개 실패`);
  process.exit(fail === 0 ? 0 : 1);
})();
