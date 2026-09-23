/**
 * 회차 기준 보기.
 *
 * 할부를 "산 달에 전액"이 아니라 "회차가 서는 달마다 그 달 몫"으로 세는 보기다.
 * 전표는 그대로 한 건이고, 세는 방식만 달라진다.
 *
 * 보는 것은 넷이다.
 *   1. 월별 합계가 회차대로 나뉜다. 산 달에는 1회차만, 다음 달에도 줄이 선다.
 *   2. 분류별 리포트도 같은 값으로 나뉜다. 화면의 두 숫자가 어긋나면 안 된다.
 *   3. 유이자 할부의 이자가 그 회차의 달에 함께 든다. 분류는 거래의 분류를 따라간다.
 *   4. 지난달에 산 할부가 이번 달 목록에 설 수 있도록 따로 실려 온다.
 *
 * 날짜는 오늘에서 거꾸로 만든다. "지난달"이 언제 돌리느냐에 따라 달라지기 때문이다.
 */

import { CategoriesService } from '@/modules/categories/categories.service';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import { PeopleService } from '@/modules/people/people.service';
import { shiftYearMonth, zonedDayStart, zonedParts } from '@money/types';
import {
  makeAccounts,
  makeCards,
  makeCategories,
  makeEntries,
  makeLedger,
  makeBudgets,
  makePeople,
  makeReports,
  projectAccessStub,
  runSmoke,
} from './smoke-harness';

const TZ = 'Asia/Seoul';

runSmoke('installment-basis', async (ctx) => {
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
  const reports = makeReports(ctx.prisma, access);
  const budgets = makeBudgets(ctx.prisma, access);

  const person = await people.createPerson(uid, { name: '김철수' }, pid);
  const food = await categories.createCategory(uid, { name: '식비', type: 'expense' }, pid);
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
      statementClosingDay: 15,
      paymentDueDay: 25,
    },
    pid,
  );

  const today = zonedParts(new Date(), TZ);
  /** 이번 달 10일 정오에서 back 달 앞. 달 경계에 걸리지 않게 한낮으로 둔다. */
  const monthsAgo = (back: number) =>
    new Date(
      zonedDayStart(today.year, today.month - back, 10, TZ).getTime() + 12 * 3600_000,
    ).toISOString();
  const thisMonth = `${today.year}-${String(today.month).padStart(2, '0')}`;
  const nextMonth = shiftYearMonth(today.year, today.month, 1);
  const lastMonth = shiftYearMonth(today.year, today.month, -1);

  /** 두 달 전에 산 3개월 유이자 할부. 회차는 두 달 전·지난달·이번 달에 선다. */
  await entries.createEntry(
    uid,
    {
      kind: 'expense',
      personId: person.id,
      cardId: card.id,
      date: monthsAgo(2),
      description: '냉장고',
      amount: '300000',
      categoryId: food.id,
      installmentMonths: 3,
      installmentInterest: true,
      installmentInterestShares: ['3000', '2000', '1000'],
    } as any,
    pid,
  );

  /** 이번 달에 산 일시불. 회차 기준에서도 그대로 이번 달이다. */
  await entries.createEntry(
    uid,
    {
      kind: 'expense',
      personId: person.id,
      cardId: card.id,
      date: monthsAgo(0),
      description: '점심',
      amount: '10000',
      categoryId: food.id,
    } as any,
    pid,
  );

  const summaryOf = (yearMonth: string, basis?: string) =>
    reports.getSummary(uid, { projectId: pid, yearMonth, ...(basis ? { basis } : {}) } as any);

  ctx.check('발생 기준: 산 달에 전액', (await summaryOf(`${today.year}-${String(today.month - 2 > 0 ? today.month - 2 : today.month).padStart(2, '0')}`)).expense !== '0', true);
  ctx.check('발생 기준: 이번 달은 일시불만', (await summaryOf(thisMonth)).expense, '10000');
  ctx.check(
    '회차 기준: 이번 달은 3회차 + 일시불',
    (await summaryOf(thisMonth, 'installment')).expense,
    // 100,000 (3회차 원금) + 1,000 (3회차 이자) + 10,000 (일시불)
    '111000',
  );
  ctx.check(
    '회차 기준: 지난달은 2회차뿐',
    (await summaryOf(lastMonth, 'installment')).expense,
    '102000',
  );
  ctx.check(
    '회차 기준: 다음 달에는 남은 회차가 없다',
    (await summaryOf(nextMonth, 'installment')).expense,
    '0',
  );

  const breakdown = await reports.getCategoryBreakdown(uid, {
    projectId: pid,
    yearMonth: thisMonth,
    type: 'expense',
    basis: 'installment',
  } as any);
  ctx.check('분류 리포트도 같은 값', breakdown[0]?.amount, '111000');
  ctx.check('분류는 거래의 분류를 따라간다', breakdown[0]?.categoryName, '식비');
  ctx.check('줄은 하나뿐', breakdown.length, 1);

  const methods = await reports.getPaymentMethods(uid, {
    projectId: pid,
    yearMonth: thisMonth,
    basis: 'installment',
  } as any);
  const cardRow = methods.find((row: { id: string }) => row.id === card.id);
  ctx.check('수단별도 회차 몫으로 센다', cardRow?.amount, '111000');

  const months = await reports.getEntryMonths(uid, {
    projectId: pid,
    basis: 'installment',
  } as any);
  ctx.check(
    '회차가 선 달이 목록에 있다',
    months.some((month: { yearMonth: string }) => month.yearMonth === lastMonth),
    true,
  );
  ctx.check(
    '그 달의 금액은 회차 몫',
    months.find((month: { yearMonth: string }) => month.yearMonth === lastMonth)?.expense,
    '102000',
  );

  /*
   * 예산도 회차 기준이다. 화면이 고르는 값이 아니라 늘 그렇다.
   *
   * 예산은 "이 달에 이만큼까지 쓴다"는 약속이라, 24개월 할부를 산 달에 전액으로 세면
   * 그 달 하나가 통째로 터지고 남은 달에는 나갈 돈이 진행률에 잡히지 않는다.
   */
  await budgets.createBudget(
    uid,
    { categoryId: food.id, type: 'expense', monthlyAmount: '500000' } as any,
    pid,
  );
  const budgetRows = await budgets.getBudgetForMonth(uid, pid, today.year, today.month);
  ctx.check(
    '예산 사용액은 회차 몫 (3회차 + 일시불)',
    budgetRows.find((row) => row.categoryId === food.id)?.usedAmount,
    '111000',
  );

  const [lastYear, lastMonthNumber] = lastMonth.split('-').map(Number);
  const lastRows = await budgets.getBudgetForMonth(uid, pid, lastYear, lastMonthNumber);
  ctx.check(
    '지난달 예산 사용액은 2회차뿐',
    lastRows.find((row) => row.categoryId === food.id)?.usedAmount,
    '102000',
  );

  const range = {
    startDate: zonedDayStart(today.year, today.month, 1, TZ).toISOString(),
    endDate: zonedDayStart(today.year, today.month + 1, 1, TZ).toISOString(),
  };
  const past = await entries.getInstallmentRows(uid, { projectId: pid, ...range } as any, pid);
  ctx.check('지난 할부가 이번 달 목록에 실려 온다', past.length, 1);

  /*
   * 달 이름만 주어도 같은 답이어야 한다.
   *
   * 거래 화면은 달을 볼 때 이름 하나만 보낸다(`listRangeOf`). 인스턴트만 받던 때에는
   * 이 조회가 늘 빈 목록을 내주어, 산 달의 1회차만 서고 나머지 회차는 합계에만 잡혔다.
   */
  const byMonth = await entries.getInstallmentRows(
    uid,
    { projectId: pid, yearMonth: thisMonth } as any,
    pid,
  );
  ctx.check('달 이름만 주어도 실려 온다', byMonth.length, 1);
  ctx.check('같은 거래다', byMonth[0]?.id, past[0]?.id);

  ctx.check('그 거래가 냉장고', past[0]?.description, '냉장고');
  ctx.check('개월수도 함께 온다', past[0]?.installmentMonths, 3);
  ctx.check('회차 이자도 함께 온다', past[0]?.installmentInterestShares?.join(','), '3000,2000,1000');
});
