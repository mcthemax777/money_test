/**
 * 유이자 할부의 이자는 **전표 금액 안에 있다.**
 *
 * 실행:
 *   cd packages/api
 *   npx tsx scripts/installment-interest-smoke.ts
 *
 * 예전에는 이자가 회차마다 사람이 적는 별도의 수수료 전표였다. 그래서 산 날에는 카드
 * 빚이 원금만큼만 잡히고, 매달 갚을 돈은 적히기 전까지 어디에도 없었다. 이제 거래를
 * 적을 때 회차 이자를 함께 적고, 그 합이 전표 금액에 들어간다.
 *
 * 그 하나가 네 자리를 한꺼번에 바꾼다.
 *   1. 거래와 카드 원장: 산 날에 원금 + 이자 전액.
 *   2. 청구: 회차마다 그 회차의 원금 + 이자. 합은 전표 금액과 같다.
 *   3. 실적: 이자를 뺀 결제액. 카드사가 혜택을 정할 때 세는 것은 승인된 금액이다.
 *   4. 회차 원금의 합은 이자를 뺀 금액과 같아야 한다.
 *
 * 날짜는 오늘에서 거꾸로 만든다. 주기가 "지금"을 기준으로 움직이기 때문이다.
 */

import { CardLedgerService } from '@/modules/cards/card-ledger.service';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import {
  closingMonthKey,
  closingMonthOf,
  shiftClosingMonth,
  zonedDayStart,
  zonedParts,
} from '@money/types';
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

runSmoke('installment-interest', async (ctx) => {
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
  const home = await categories.createCategory(uid, { name: '가전', type: 'expense' }, pid);
  const bank = await accounts.createAccount(
    uid,
    { type: 'deposit', ownerId: person.id, name: '보통예금', openingBalance: '10000000' },
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
  const noonToday = new Date(
    zonedDayStart(today.year, today.month, today.day, TZ).getTime() + 12 * 3600_000,
  ).toISOString();

  const current = closingMonthOf(new Date(), CLOSING_DAY, TZ);
  const keyAt = (offset: number) => closingMonthKey(shiftClosingMonth(current, offset));

  /** 그 주기의 청구 줄 하나. 사용이 음수로 실린다. */
  const billedAt = async (offset: number, description: string) => {
    const page = await cardLedger.getBilledLedger(card.id, uid, {
      limit: 50,
      closingKey: keyAt(offset),
    });
    return page.rows.find((row) => row.description === description) ?? null;
  };

  // ── 300,000원 3개월, 이자 3,000 / 2,000 / 1,000 ──
  const fridge = await entries.createEntry(
    uid,
    {
      kind: 'expense',
      personId: person.id,
      cardId: card.id,
      date: noonToday,
      description: '냉장고',
      amount: '300000',
      categoryId: home.id,
      installmentMonths: 3,
      installmentInterest: true,
      installmentInterestShares: ['3000', '2000', '1000'],
    } as any,
    pid,
  );

  const saved = await entries.getEntryById(fridge.id, uid);
  ctx.check('전표 금액은 원금 + 이자', saved.amount, '306000');
  ctx.check('적어 둔 회차 이자가 남는다', saved.installmentInterestShares?.join(','), '3000,2000,1000');

  const liability = await ctx.prisma.account.findUniqueOrThrow({
    where: { id: card.liabilityAccountId! },
    select: { balance: true },
  });
  ctx.check('카드 빚도 원금 + 이자', liability.balance.toString(), '-306000');

  // ── 청구는 회차마다 원금 + 이자 ──
  ctx.check('1회차 청구', (await billedAt(0, '냉장고'))?.amount, '-103000');
  ctx.check('2회차 청구', (await billedAt(1, '냉장고'))?.amount, '-102000');
  ctx.check('3회차 청구', (await billedAt(2, '냉장고'))?.amount, '-101000');
  ctx.check('그 뒤로는 없다', await billedAt(3, '냉장고'), null);

  const usage = await cardLedger.getUsage(card.id, uid, 1);
  const periodAt = (offset: number) =>
    usage.periods.find((period) => period.closingKey === keyAt(offset)) ?? null;
  ctx.check('그래프의 청구 막대도 회차 몫', periodAt(0)?.billed, '103000');
  ctx.check(
    '세 주기를 더하면 전표 금액',
    [0, 1, 2].reduce((acc, offset) => acc + Number(periodAt(offset)?.billed ?? 0), 0),
    306000,
  );

  // ── 실적은 이자를 뺀 결제액 ──
  ctx.check('실적 막대는 구매가', periodAt(0)?.usage, '300000');
  const performance = await cardLedger.getPerformance(card.id, uid);
  ctx.check('실적도 구매가', performance.usage, '300000');

  const performanceLedger = await cardLedger.getPerformanceLedger(card.id, uid, {
    limit: 50,
    closingKey: keyAt(0),
  });
  ctx.check(
    '실적 원장의 줄도 구매가',
    performanceLedger.rows.find((row) => row.description === '냉장고')?.amount,
    '-300000',
  );

  // ── 회차 원금은 이자를 뺀 금액을 나눈다 ──
  const custom = await entries.createEntry(
    uid,
    {
      kind: 'expense',
      personId: person.id,
      cardId: card.id,
      date: noonToday,
      description: '커피 할부',
      amount: '1000',
      categoryId: home.id,
      installmentMonths: 3,
      installmentInterest: true,
      installmentInterestShares: ['10', '10', '10'],
      installmentShares: ['334', '334', '332'],
    } as any,
    pid,
  );
  ctx.check('전표 금액', (await entries.getEntryById(custom.id, uid)).amount, '1030');
  ctx.check('1회차 청구는 원금 334 + 이자 10', (await billedAt(0, '커피 할부'))?.amount, '-344');

  await ctx.expectReject('회차 원금의 합이 구매가와 다르면 거부', () =>
    entries.createEntry(
      uid,
      {
        kind: 'expense', personId: person.id, cardId: card.id, date: noonToday,
        description: '합이 어긋난 할부', amount: '1000', categoryId: home.id,
        installmentMonths: 3, installmentInterest: true,
        installmentInterestShares: ['10', '10', '10'],
        // 이자까지 더해 적으면 원금이 그만큼 부풀어 두 번 세어진다.
        installmentShares: ['344', '343', '343'],
      } as any,
      pid,
    ),
  );

  // ── 외화가 얽히면 이자를 적을 수 없다 ──
  //
  // 이자는 명세서에 찍힌 금액 그대로 적는 값이라, 환산할 그때의 환율이 계획에 없다.
  // 원화 카드로 한 달러 결제도 막는다 -- 이자가 섞인 환산액에서 환율을 되짚으면
  // 화면이 적은 적 없는 환율을 보여 준다.
  await ctx.expectReject('원화 카드의 외화 결제도 거부', () =>
    entries.createEntry(
      uid,
      {
        kind: 'expense', personId: person.id, cardId: card.id, date: noonToday,
        description: '달러 결제 유이자', amount: '300', currency: 'USD', categoryId: home.id,
        installmentMonths: 3, installmentInterest: true,
        installmentInterestShares: ['3000', '2000', '1000'],
      } as any,
      pid,
    ),
  );

  const dollarBank = await accounts.createAccount(
    uid,
    {
      type: 'deposit', ownerId: person.id, name: '달러 통장',
      currency: 'USD', openingBalance: '10000',
    },
    pid,
  );
  const dollarCard = await cards.createCard(
    uid,
    {
      paymentAccountId: dollarBank.id, name: '달러 카드', cardType: 'credit',
      issuerId: 'fi_card_shinhan', statementClosingDay: CLOSING_DAY, paymentDueDay: 25,
    },
    pid,
  );
  await ctx.expectReject('외화 청구 카드의 유이자 할부는 거부', () =>
    entries.createEntry(
      uid,
      {
        kind: 'expense', personId: person.id, cardId: dollarCard.id, date: noonToday,
        description: '외화 유이자', amount: '300', currency: 'USD', categoryId: home.id,
        installmentMonths: 3, installmentInterest: true,
        installmentInterestShares: ['3', '2', '1'],
      } as any,
      pid,
    ),
  );
});
