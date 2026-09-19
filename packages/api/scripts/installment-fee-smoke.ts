/**
 * 유이자 할부의 회차 수수료.
 *
 * 원금 회차는 총액을 개월수로 나누면 나오지만, 수수료는 카드사와 남은 원금에 따라
 * 회차마다 조금씩 달라 계산으로는 명세서와 맞출 수 없다. 그래서 회차의 주기가 마감되면
 * "수수료 미입력"으로 떠오르고, 사용자가 명세서를 보고 적으면 그때 전표가 하나 생긴다
 * (외화 청구액 확정과 같은 손짓이다).
 *
 * 여기서 보는 것은 그 전표가 **원장과 어긋나지 않는가**다.
 *   1. 적은 회차는 다시 떠오르지 않고, 마감 전 회차는 아직 떠오르지 않는다.
 *   2. 수수료만큼 갚을 대금이 늘고, 그 주기의 청구 내역에 줄로 선다.
 *   3. 실적에는 들지 않는다. 카드사가 세는 것은 결제액이지 수수료가 아니다.
 *
 * 날짜는 오늘에서 거꾸로 만든다. 주기가 "지금"을 기준으로 움직여서, 고정 날짜를 쓰면
 * 언제 돌리느냐에 따라 그 회차가 마감 안팎을 오간다.
 */

import { CardLedgerService } from '@/modules/cards/card-ledger.service';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import {
  closingMonthKey,
  closingMonthOf,
  periodForClosingMonth,
  shiftClosingMonth,
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

runSmoke('installment-fee', async (ctx) => {
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
  const goods = await categories.createCategory(uid, { name: '가전', type: 'expense' }, pid);
  const feeCategory = await categories.createCategory(uid, { name: '할부수수료', type: 'expense' }, pid);
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

  /*
   * 두 주기 앞에서 산 것으로 둔다. 날짜를 "며칠 전"으로 잡으면 돌리는 날에 따라 회차가
   * 마감 안팎을 오간다 -- 달 초에 돌리면 두 회차가 하나가 된다.
   *
   * 진행 중인 주기(current)는 정의상 아직 마감되지 않았다. 그래서 3개월 할부를 current-2
   * 주기에 두면 마감된 회차가 언제 돌려도 정확히 둘이다.
   */
  const current = closingMonthOf(new Date(), CLOSING_DAY, TZ);
  const purchaseMonth = shiftClosingMonth(current, -2);
  const purchasePeriod = periodForClosingMonth(
    purchaseMonth.year,
    purchaseMonth.month,
    CLOSING_DAY,
    25,
  );
  /** 그 주기 안쪽의 하루. 경계에 걸리지 않게 시작 다음 날 정오로 둔다. */
  const purchaseDate = new Date(
    purchasePeriod.periodStart.getTime() + 24 * 3600_000 + 12 * 3600_000,
  ).toISOString();

  const spend = (over: Record<string, unknown>) =>
    entries.createEntry(
      uid,
      {
        kind: 'expense',
        personId: person.id,
        cardId: card.id,
        date: purchaseDate,
        description: '냉장고',
        amount: '300000',
        categoryId: goods.id,
        ...over,
      } as any,
      pid,
    );

  const outstanding = async () =>
    (
      await ctx.prisma.account.findUniqueOrThrow({
        where: { id: card.liabilityAccountId! },
        select: { balance: true },
      })
    ).balance.neg().toString();

  // ── 무이자 할부는 떠오르지 않는다 ──
  await spend({ description: '무이자 노트북', installmentMonths: 3, installmentInterest: false });
  ctx.check('무이자는 묻지 않는다', (await cardLedger.listPendingFees(card.id, uid)).items.length, 0);

  // ── 유이자 할부 ──
  //
  // 70일 전 결제라 첫 회차와 둘째 회차의 주기는 이미 마감됐다. 셋째는 아직이다.
  const plan = await spend({ installmentMonths: 3, installmentInterest: true });
  const pending = await cardLedger.listPendingFees(card.id, uid);
  const mine = pending.items.filter((item) => item.description === '냉장고');
  ctx.check('마감된 회차만 떠오른다', mine.length, 2);
  ctx.check('오래된 회차가 앞', mine[0]?.sequence, 1);
  ctx.check('회차 원금', mine[0]?.principal, '100000');
  ctx.check('처음에는 분류를 모른다', pending.suggestedCategoryId ?? null, null);
  ctx.check('원 거래를 가리킨다', mine[0]?.entryId, plan.id);
  // 설명이 빈 거래를 가릴 이름. 목록이 이것으로 줄을 세운다.
  ctx.check('분류 이름이 함께 온다', mine[0]?.categoryName, '가전');


  // ── 명세서를 보고 적는다 ──
  const before = Number(await outstanding());
  const settled = await cardLedger.settleFees(card.id, uid, {
    personId: person.id,
    categoryId: feeCategory.id,
    items: [{ planId: mine[0].planId, sequence: 1, amount: '2500' }],
  } as any);
  ctx.check('한 건을 적었다', settled.settled, 1);
  ctx.check('수수료만큼 갚을 대금이 는다', Number(await outstanding()) - before, 2500);

  const after = await cardLedger.listPendingFees(card.id, uid);
  ctx.check('적은 회차는 사라진다', after.items.filter((item) => item.description === '냉장고').length, 1);
  ctx.check('다음부터 그 분류를 권한다', after.suggestedCategoryId, feeCategory.id);

  await ctx.expectReject('같은 회차를 두 번 적을 수 없다', () =>
    cardLedger.settleFees(card.id, uid, {
      personId: person.id,
      categoryId: feeCategory.id,
      items: [{ planId: mine[0].planId, sequence: 1, amount: '2500' }],
    } as any),
  );
  await ctx.expectReject('없는 회차는 거부', () =>
    cardLedger.settleFees(card.id, uid, {
      personId: person.id,
      categoryId: feeCategory.id,
      items: [{ planId: mine[0].planId, sequence: 9, amount: '2500' }],
    } as any),
  );
  await ctx.expectReject('0원은 거부', () =>
    cardLedger.settleFees(card.id, uid, {
      personId: person.id,
      categoryId: feeCategory.id,
      items: [{ planId: mine[0].planId, sequence: 2, amount: '0' }],
    } as any),
  );

  // ── 수수료 전표가 든 자리 ──
  const firstKey = closingMonthKey(purchaseMonth);
  const billed = await cardLedger.getBilledLedger(card.id, uid, { limit: 50, closingKey: firstKey });
  const feeRow = billed.rows.find((row) => row.description.includes('수수료'));
  ctx.check('그 회차 청구서에 줄로 선다', feeRow?.amount, '-2500');
  ctx.check('수수료 줄은 일시불', feeRow?.installmentMonths, 1);

  const usage = await cardLedger.getUsage(card.id, uid, 6);
  const period = usage.periods.find((row) => row.closingKey === firstKey);
  // 청구 = 무이자 1회차 100,000 + 유이자 1회차 100,000 + 수수료 2,500
  ctx.check('청구액에 수수료가 든다', period?.billed, '202500');
  // 실적 = 두 결제의 전액 600,000. 수수료는 들지 않는다.
  ctx.check('실적에는 수수료가 없다', period?.usage, '600000');

  // ── 원 거래를 고쳐도 적은 회차는 그대로다 ──
  await entries.updateEntry(
    plan.id,
    uid,
    {
      kind: 'expense',
      personId: person.id,
      cardId: card.id,
      date: purchaseDate,
      description: '냉장고 (수정)',
      amount: '300000',
      categoryId: goods.id,
      installmentMonths: 3,
      installmentInterest: true,
    } as any,
  );
  const afterEdit = await cardLedger.listPendingFees(card.id, uid);
  ctx.check(
    '고쳐도 적은 회차는 다시 묻지 않는다',
    afterEdit.items.filter((item) => item.description === '냉장고 (수정)').length,
    1,
  );

  /*
   * 설명 없이 적은 할부. 그 카드에 실제로 이런 거래가 있었다.
   *
   * 이름 자리가 비면 밀린 회차가 여러 거래에서 왔을 때 어느 것이 어느 결제인지 화면에서
   * 가릴 수 없다. 묶고 이름 짓는 규칙은 core 의 `pending-fees` 가 갖는다(웹·앱 공용).
   */
  const noName = await spend({ description: '', installmentMonths: 3, installmentInterest: true });
  const withNoName = await cardLedger.listPendingFees(card.id, uid);
  const blank = withNoName.items.find((item) => item.entryId === noName.id);
  ctx.check('설명이 비어도 분류는 온다', blank?.categoryName, '가전');
  ctx.check('설명은 빈 글자 그대로', blank?.description, '');

  // ── 다음 회차는 주기가 마감되어야 떠오른다 ──
  const third = shiftClosingMonth(purchaseMonth, 2);
  ctx.check(
    '셋째 회차는 아직 없다',
    afterEdit.items.some((item) => item.closingMonth === closingMonthKey(third)),
    false,
  );
});
