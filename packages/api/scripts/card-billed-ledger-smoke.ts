/**
 * 청구 내역. 이 주기 청구서에 무엇이 얼마씩 들었는가.
 *
 * 24개월 할부로 차를 사면 원장에는 산 날 한 줄뿐이다. 그 뒤 스물세 달은 대금이 나가는데
 * 목록에는 아무 줄도 없어서, 카드 상세에서 그 주기를 열면 막대는 큰데 아래가 비어 있었다.
 * 이 스크립트가 보는 것이 그 자리다.
 *
 * 함께 보는 것 둘.
 *   1. 줄의 합이 그래프의 막대(`UsagePeriod.billed`)와 같다. 실적에서 뺀 거래도 청구는
 *      되므로 여기 들어야 한다.
 *   2. 대금 결제와 환불 입금은 청구서에 실리지 않는다. 그쪽은 계좌 원장의 몫이다.
 *
 * 날짜는 오늘에서 거꾸로 만든다. 주기가 "지금"을 기준으로 움직여서, 고정 날짜를 쓰면
 * 언제 돌리느냐에 따라 그 거래가 구간 안팎을 오간다.
 */

import { CardLedgerService } from '@/modules/cards/card-ledger.service';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import { closingMonthKey, closingMonthOf, shiftClosingMonth, zonedDayStart, zonedParts } from '@money/types';
import {
  makeAccounts,
  makeCards,
  makeCategories,
  makeEntries,
  makeLedger,
  makePeople,
  projectAccessStub,
  runSmoke,
} from './smoke-harness';

const TZ = 'Asia/Seoul';
const CLOSING_DAY = 15;

runSmoke('card-billed-ledger', async (ctx) => {
  const pid = (await ctx.createProject({ timezone: TZ })).id;
  const uid = (await ctx.createUser()).id;
  const access = projectAccessStub(ctx.prisma, pid);

  const ledger = makeLedger(ctx.prisma, access);
  const institutions = new InstitutionsService(ctx.prisma as any, access);
  const accounts = makeAccounts(ctx.prisma, access, ledger, institutions);
  const people = makePeople(ctx.prisma, access);
  const categories = makeCategories(ctx.prisma, access);
  const cards = makeCards(ctx.prisma, access, institutions);
  const entries = makeEntries(ctx.prisma, access, ledger);
  const cardLedger = new CardLedgerService(ctx.prisma as any, access as any, ledger as any);

  const person = await people.createPerson(uid, { name: '김철수' }, pid);
  const car = await categories.createCategory(uid, { name: '자동차', type: 'expense' }, pid);
  const bank = await accounts.createAccount(
    uid,
    { type: 'deposit', ownerId: person.id, name: '보통예금', openingBalance: '50000000' },
    pid,
  );
  const card = await cards.createCard(
    uid,
    {
      paymentAccountId: bank.id,
      name: '신한 신용',
      cardType: 'credit',
      issuerId: 'fi_card_shinhan',
      statementClosingDay: CLOSING_DAY,
      paymentDueDay: 25,
      performanceAmount: '300000',
    },
    pid,
  );

  const today = zonedParts(new Date(), TZ);
  /** 오늘에서 back일 전 정오 (서울 기준). 날짜 경계에 걸리지 않게 한낮으로 둔다. */
  const daysAgo = (back: number) =>
    new Date(
      zonedDayStart(today.year, today.month, today.day - back, TZ).getTime() + 12 * 3600_000,
    ).toISOString();

  const spend = (over: Record<string, unknown>) =>
    entries.createEntry(
      uid,
      {
        kind: 'expense',
        personId: person.id,
        cardId: card.id,
        date: daysAgo(0),
        description: '사용',
        amount: '10000',
        categoryId: car.id,
        ...over,
      } as any,
      pid,
    );

  /** 이번 주기와 그 뒤 주기의 마감 연월 키. 청구는 뒤 주기로 넘어간다. */
  const current = closingMonthOf(new Date(), CLOSING_DAY, TZ);
  const keyAt = (offset: number) => closingMonthKey(shiftClosingMonth(current, offset));

  const periodAt = async (offset: number) => {
    const page = await cardLedger.getBilledLedger(card.id, uid, {
      limit: 50,
      closingKey: keyAt(offset),
    });
    return { rows: page.rows, total: page.periods[0]?.total ?? '0', page };
  };

  /** 그래프가 그리는 값. 줄의 합과 같아야 한다. */
  const billedAt = async (offset: number) => {
    const usage = await cardLedger.getUsage(card.id, uid, 1);
    return usage.periods.find((period) => period.closingKey === keyAt(offset))?.billed ?? null;
  };

  // ── 빈 카드 ──
  const empty = await periodAt(0);
  ctx.check('줄이 없다', empty.rows.length, 0);
  ctx.check('기준선은 긋지 않는다', empty.page.target ?? null, null);

  // ── 24개월 할부 ──
  //
  // 2,400,000원을 24개월로. 회차마다 100,000원이 스물네 주기에 걸쳐 청구된다.
  await spend({ amount: '2400000', description: '자동차', installmentMonths: 24 });

  const first = await periodAt(0);
  const firstRow = first.rows.find((row) => row.description === '자동차');
  ctx.check('산 주기에는 첫 회차만', firstRow?.amount, '-100000');
  ctx.check('회차 번호', firstRow?.installmentIndex, 1);
  ctx.check('개월수', firstRow?.installmentMonths, 24);

  const second = await periodAt(1);
  const secondRow = second.rows.find((row) => row.description === '자동차');
  ctx.check('다음 주기에도 줄이 선다', secondRow?.amount, '-100000');
  ctx.check('다음 주기는 2회차', secondRow?.installmentIndex, 2);
  ctx.check('줄 열쇠는 회차마다 다르다', firstRow?.key === secondRow?.key, false);

  const last = await periodAt(23);
  ctx.check('마지막 회차', last.rows.find((row) => row.description === '자동차')?.installmentIndex, 24);
  const after = await periodAt(24);
  ctx.check('그 뒤로는 없다', after.rows.length, 0);

  // ── 줄의 합 = 그래프의 막대 ──
  await spend({ amount: '30000', description: '주유' });
  await spend({ amount: '70000', description: '세금', countsPerformance: false });

  const withMore = await periodAt(0);
  ctx.check('실적에서 뺀 거래도 청구에는 든다', Boolean(withMore.rows.find((row) => row.description === '세금')), true);
  ctx.check('합계 = 청구 막대', withMore.total, await billedAt(0));
  // 100,000 + 30,000 + 70,000
  ctx.check('합계 금액', withMore.total, '200000');
  ctx.check('누적은 마지막 줄에 다 쌓인다', withMore.rows[0]?.runningTotal, '200000');

  // ── 대금 결제는 청구서에 실리지 않는다 ──
  await cardLedger.transfer(card.id, uid, {
    personId: person.id,
    date: daysAgo(0),
    accountId: bank.id,
    amount: '50000',
    direction: 'payment',
  } as any);

  const afterPayment = await periodAt(0);
  ctx.check('대금 결제는 줄에 없다', afterPayment.rows.length, withMore.rows.length);
  ctx.check('대금 결제는 합계에도 없다', afterPayment.total, '200000');

  // ── 끊어 받아도 같은 줄이다 ──
  const paged = await cardLedger.getBilledLedger(card.id, uid, { limit: 1, closingKey: keyAt(0) });
  ctx.check('한 줄만 받는다', paged.rows.length, 1);
  ctx.check('머리글의 합계는 그 주기 전부', paged.periods[0]?.total, '200000');
  const next = await cardLedger.getBilledLedger(card.id, uid, {
    limit: 1,
    closingKey: keyAt(0),
    cursor: paged.nextCursor ?? undefined,
  });
  ctx.check('다음 줄이 이어진다', next.rows[0]?.key, afterPayment.rows[1]?.key);
  ctx.check('누적은 잘린 자리와 무관하다', next.rows[0]?.runningTotal, afterPayment.rows[1]?.runningTotal);

  // ── 회차 금액을 직접 적는다 ──
  //
  // 끝수를 어느 회차에 붙이는지가 카드사마다 다르다. 1,000원 3개월이 334/333/333 일
  // 수도 334/334/332 일 수도 있어, 계산만으로는 명세서와 맞출 수 없다.
  const custom = await spend({
    amount: '1000',
    description: '커피 할부',
    installmentMonths: 3,
    installmentShares: ['334', '334', '332'],
  });
  ctx.check(
    '적어 둔 값이 목록에 실린다',
    (await entries.getEntryById(custom.id, uid)).installmentShares?.join(','),
    '334,334,332',
  );
  ctx.check('1회차', (await periodAt(0)).rows.find((row) => row.description === '커피 할부')?.amount, '-334');
  ctx.check('2회차', (await periodAt(1)).rows.find((row) => row.description === '커피 할부')?.amount, '-334');
  ctx.check('3회차', (await periodAt(2)).rows.find((row) => row.description === '커피 할부')?.amount, '-332');

  await ctx.expectReject('합이 다르면 거부', () =>
    entries.createEntry(
      uid,
      {
        kind: 'expense', personId: person.id, cardId: card.id, date: daysAgo(0),
        description: '합이 어긋난 할부', amount: '1000', categoryId: car.id,
        installmentMonths: 3, installmentShares: ['334', '334', '333'],
      } as any,
      pid,
    ),
  );
  await ctx.expectReject('개수가 다르면 거부', () =>
    entries.createEntry(
      uid,
      {
        kind: 'expense', personId: person.id, cardId: card.id, date: daysAgo(0),
        description: '개수가 어긋난 할부', amount: '1000', categoryId: car.id,
        installmentMonths: 3, installmentShares: ['500', '500'],
      } as any,
      pid,
    ),
  );

  // 금액을 고치면 적어 둔 값을 버리고 다시 나눈다. 옛 값이 남으면 합이 어긋난다.
  await entries.updateEntry(custom.id, uid, {
    kind: 'expense', personId: person.id, cardId: card.id, date: daysAgo(0),
    description: '커피 할부', amount: '3000', categoryId: car.id, installmentMonths: 3,
  } as any);
  ctx.check(
    '금액을 고치면 기본 분할로 돌아간다',
    (await entries.getEntryById(custom.id, uid)).installmentShares ?? null,
    null,
  );
  ctx.check(
    '고친 뒤 1회차',
    (await periodAt(0)).rows.find((row) => row.description === '커피 할부')?.amount,
    '-1000',
  );

  // ── 체크카드에는 청구가 없다 ──
  const debit = await cards.createCard(
    uid,
    {
      paymentAccountId: bank.id,
      name: '체크',
      cardType: 'debit',
      issuerId: 'fi_card_shinhan',
    },
    pid,
  );
  await ctx.expectReject('체크카드는 거부', () => cardLedger.getBilledLedger(debit.id, uid, {}));
});
