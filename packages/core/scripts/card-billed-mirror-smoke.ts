/**
 * 사본에서 본 청구 내역. 서버 쪽 짝은 `api/scripts/card-billed-ledger-smoke.ts` 다.
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/card-billed-mirror-smoke.ts
 *
 * 24개월 할부로 산 차는 원장에 산 날 한 줄뿐인데 대금은 매달 나간다. 앱에서 그 달 주기를
 * 열었을 때 회차 한 줄이 서야 하고, 그 줄은 웹에서 보는 것과 같아야 한다 -- 나누는 규칙은
 * 서버와 같은 함수(`billedShares`)가 갖지만, 주기를 고르고 자르는 길은 여기 따로 있다.
 *
 * 실적과 갈리는 자리도 함께 본다. 실적은 결제한 주기에 전액이 한 줄로 든다.
 */
import {
  closingMonthKey,
  closingMonthOf,
  shiftClosingMonth,
  zonedDayStart,
  zonedParts,
  type SyncDto,
} from '@money/types';

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
const CLOSING_DAY = 15;

/** 오늘 정오 (서울 기준). 날짜 경계에 걸리지 않게 한낮으로 둔다. */
function todayNoon(): string {
  const today = zonedParts(new Date(), KST);
  return new Date(
    zonedDayStart(today.year, today.month, today.day, KST).getTime() + 12 * 3600_000,
  ).toISOString();
}

const entry = (id: string, description: string, amount: string) => ({
  id,
  projectId: PID,
  personId: 'p1',
  date: todayNoon(),
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
      id: `${id}-cat`,
      entryId: id,
      accountId: null,
      categoryId: 'c-car',
      amount,
      quantity: null,
      currency: 'KRW',
      baseAmount: amount,
      exchangeRate: '1',
      cardId: null,
      lineKey: `${id}-line1`,
    },
    {
      id: `${id}-acc`,
      entryId: id,
      accountId: 'a2',
      categoryId: null,
      amount: `-${amount}`,
      quantity: null,
      currency: 'KRW',
      baseAmount: `-${amount}`,
      exchangeRate: '1',
      cardId: 'card-1',
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
        id: PID,
        name: '우리집',
        projectKey: null,
        description: null,
        ledgerCurrency: 'KRW',
        displayCurrency: 'KRW',
        timezone: KST,
        updatedVersion: 1,
      },
      members: [],
      people: [
        {
          id: 'p1', projectId: PID, name: '김철수', relationship: null,
          isActive: true, sortOrder: 0, updatedVersion: 1,
        },
      ],
      accounts: [
        {
          id: 'a1', projectId: PID, ownerId: 'p1', type: 'deposit', name: '보통예금',
          institutionId: null, accountNumber: null, currency: 'KRW', balance: '0',
          isActive: true, sortOrder: 0, updatedVersion: 1,
        },
        {
          id: 'a2', projectId: PID, ownerId: 'p1', type: 'credit_card', name: '신한 신용',
          institutionId: null, accountNumber: null, currency: 'KRW', balance: '-2430000',
          isActive: true, sortOrder: 1, updatedVersion: 1,
        },
      ],
      categories: [
        {
          id: 'c-car', projectId: PID, name: '자동차', parentId: null, type: 'expense',
          icon: null, isDefault: false, sortOrder: 0, updatedVersion: 1,
        },
      ],
      tags: [],
      cards: [
        {
          id: 'card-1', projectId: PID, paymentAccountId: 'a1', liabilityAccountId: 'a2',
          name: '신한 신용', cardType: 'credit', issuerId: null, cardNumber: null,
          statementClosingDay: CLOSING_DAY, paymentDueDay: 25, color: null,
          performanceAmount: '300000', isActive: true, sortOrder: 0, updatedVersion: 1,
        },
      ],
      entries: [
        entry('e-car', '자동차', '2400000'),
        entry('e-oil', '주유', '30000'),
        entry('e-coffee', '커피 할부', '1000'),
        /*
         * 유이자 3개월. 금액은 **원금 300,000 + 이자 6,000** 이다 -- 이자가 전표 안에
         * 있고, 청구는 회차마다 그 회차의 원금과 이자를 더한 값이다.
         */
        entry('e-fridge', '냉장고', '306000'),
      ],
      budgets: [],
      budgetOverrides: [],
      exchangeRates: [],
      assetValuations: [],
      // 할부 계획은 카드 다리에 붙는다. 전표가 아니다.
      installmentPlans: [
        { id: 'plan-1', postingId: 'e-car-acc', totalMonths: 24, interestBearing: false, principalShares: null, updatedVersion: 1 },
        /*
         * 회차 금액을 사람이 적어 둔 할부. 1,000원 3개월을 334/334/332 로 적었다 --
         * 끝수를 어디에 붙이는지가 카드사마다 달라, 나눈 값(334/333/333)과 다르다.
         */
        {
          id: 'plan-2', postingId: 'e-coffee-acc', totalMonths: 3, interestBearing: false,
          principalShares: ['334', '334', '332'], updatedVersion: 1,
        },
        {
          id: 'plan-3', postingId: 'e-fridge-acc', totalMonths: 3, interestBearing: true,
          principalShares: null, interestShares: ['3000', '2000', '1000'], updatedVersion: 1,
        },
      ],
      entryDrafts: [],
    } as unknown as SyncDto.Changes,
  };

  await store.applyPull(response, KST);

  /*
   * 폴백의 모든 창구가 던진다. 서버에 한 번이라도 물어보면 검사가 넘어진다 --
   * 이 검사의 요지는 사본이 혼자서 같은 줄을 낸다는 것이다.
   */
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

  const current = closingMonthOf(new Date(), CLOSING_DAY, KST);
  const keyAt = (offset: number) => closingMonthKey(shiftClosingMonth(current, offset));

  // ── 이번 주기 ──
  const first = await port.getCardBilledLedger('card-1', { closingKey: keyAt(0), limit: 50 });
  const carRow = first.rows.find((row) => row.description === '자동차');
  eq('산 주기에는 첫 회차만', carRow?.amount, '-100000');
  eq('회차 번호', carRow?.installmentIndex, 1);
  eq('개월수', carRow?.installmentMonths, 24);
  // 일시불도 1회차다. 배지는 개월수가 둘 이상일 때만 붙는다 (installmentBadge).
  eq('일시불은 1회차', first.rows.find((row) => row.description === '주유')?.installmentIndex, 1);
  // 100,000 (자동차 1회차) + 30,000 (주유) + 334 (커피 1회차) + 103,000 (냉장고 1회차)
  eq('합계는 그 주기 청구 전부', first.periods[0]?.total, '233334');

  // ── 아직 오지 않은 주기 ──
  //
  // 그래프에서 다음 달 막대를 눌러 여는 자리다. 서버도 같은 줄을 준다.
  const second = await port.getCardBilledLedger('card-1', { closingKey: keyAt(1), limit: 50 });
  const secondCar = second.rows.find((row) => row.description === '자동차');
  eq('다음 주기에도 줄이 선다', secondCar?.amount, '-100000');
  eq('다음 주기는 2회차', secondCar?.installmentIndex, 2);
  // 100,000 + 334 + 102,000 (냉장고 2회차는 이자가 2,000)
  eq('다음 주기 합계', second.periods[0]?.total, '202334');
  eq('줄 열쇠는 회차마다 다르다', carRow?.key === secondCar?.key, false);

  const after = await port.getCardBilledLedger('card-1', { closingKey: keyAt(24), limit: 50 });
  eq('스물네 회를 넘으면 없다', after.rows.length, 0);

  // ── 적어 둔 회차 금액을 그대로 쓴다 ──
  const coffeeAt = (offset: number) =>
    port
      .getCardBilledLedger('card-1', { closingKey: keyAt(offset), limit: 50 })
      .then((page) => page.rows.find((row) => row.description === '커피 할부')?.amount);
  eq('1회차는 적어 둔 값', await coffeeAt(0), '-334');
  eq('2회차도 적어 둔 값 (나눈 값과 다르다)', await coffeeAt(1), '-334');
  eq('3회차가 끝수를 덜 받는다', await coffeeAt(2), '-332');

  // ── 유이자 할부: 청구는 원금 + 이자, 실적은 이자를 뺀 결제액 ──
  const fridgeAt = (offset: number) =>
    port
      .getCardBilledLedger('card-1', { closingKey: keyAt(offset), limit: 50 })
      .then((page) => page.rows.find((row) => row.description === '냉장고')?.amount);
  eq('1회차는 원금 100,000 + 이자 3,000', await fridgeAt(0), '-103000');
  eq('3회차는 이자가 가볍다', await fridgeAt(2), '-101000');

  // ── 실적은 나뉘지 않는다 ──
  const perf = await port.getCardPerformanceLedger('card-1', { closingKey: keyAt(0), limit: 50 });
  const perfCar = perf.rows.find((row) => row.description === '자동차');
  eq('실적은 결제한 주기에 전액', perfCar?.amount, '-2400000');
  eq('실적 줄에는 회차가 없다', perfCar?.installmentIndex, undefined);
  eq(
    '유이자 할부의 실적은 이자를 뺀 구매가',
    perf.rows.find((row) => row.description === '냉장고')?.amount,
    '-300000',
  );
  // 2,400,000 + 30,000 + 1,000 + 300,000 (이자 6,000 은 실적에 들지 않는다)
  eq('실적 합계', perf.periods[0]?.total, '2731000');

  // ── 끊어 받아도 누적은 주기 시작부터다 ──
  const paged = await port.getCardBilledLedger('card-1', { closingKey: keyAt(0), limit: 1 });
  eq('한 줄만 받는다', paged.rows.length, 1);
  eq('머리글의 합계는 그 주기 전부', paged.periods[0]?.total, '233334');
  const next = await port.getCardBilledLedger('card-1', {
    closingKey: keyAt(0),
    limit: 1,
    cursor: paged.nextCursor ?? undefined,
  });
  eq('다음 줄이 이어진다', next.rows[0]?.key, first.rows[1]?.key);
  eq('누적은 잘린 자리와 무관하다', next.rows[0]?.runningTotal, first.rows[1]?.runningTotal);

  console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
