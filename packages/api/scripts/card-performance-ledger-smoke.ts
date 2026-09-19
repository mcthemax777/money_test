/**
 * 실적 원장과 차감의 실적 처리.
 *
 * 두 가지를 본다.
 *   1. 실적 탭의 줄에 붙는 값은 남은 대금이 아니라 **그 주기에 쌓인 실적**이다.
 *      주기가 바뀌면 0에서 다시 쌓고, 줄의 마지막 누적은 진행률 막대와 같은 값이다.
 *   2. 차감·취소 금액을 실적에서 뺄지 고를 수 있다. 꺼도 청구는 깎인 금액 그대로다.
 *
 * 날짜는 오늘에서 거꾸로 만든다. 주기가 "지금"을 기준으로 움직여서, 고정 날짜를 쓰면
 * 언제 돌리느냐에 따라 그 거래가 구간 안팎을 오간다 (card-performance 스모크와 같다).
 */

import { CardsService } from '@/modules/cards/cards.service';
import { CardLedgerService } from '@/modules/cards/card-ledger.service';
import { CategoriesService } from '@/modules/categories/categories.service';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import { PeopleService } from '@/modules/people/people.service';
import { zonedDayStart, zonedParts } from '@money/types';
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

runSmoke('card-performance-ledger', async (ctx) => {
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
        categoryId: food.id,
        ...over,
      } as any,
      pid,
    );

  /**
   * 진행 중인 주기. 실적 원장은 최신 줄이 앞이라 첫 줄이 든 주기가 그것이다.
   *
   * 쪽은 넉넉히 받아 온다. 끊어 받는 것은 따로 본다.
   */
  const currentPeriod = async () => {
    const page = await cardLedger.getPerformanceLedger(card.id, uid, { limit: 50 });
    const start = page.rows[0]?.periodStart ?? null;
    const period = page.periods.find((row) => row.periodStart === start) ?? null;
    return {
      total: period?.total ?? '0',
      periodEnd: period?.periodEnd ?? null,
      rows: page.rows.filter((row) => row.periodStart === start),
      page,
    };
  };

  // ── 빈 카드 ──
  const empty = await cardLedger.getPerformanceLedger(card.id, uid, { limit: 20 });
  ctx.check('기준은 청구 주기', empty.basis, 'statement');
  ctx.check('기준액이 실린다', empty.target, '300000');
  ctx.check('줄이 없다', empty.rows.length, 0);
  ctx.check('머리글도 없다', empty.periods.length, 0);
  ctx.check('더 볼 것도 없다', empty.nextCursor ?? null, null);

  // ── 이번 주기에 쌓인다 ──
  await spend({ amount: '30000', description: '첫 결제', date: daysAgo(0) });
  await spend({ amount: '20000', description: '둘째 결제', date: daysAgo(0) });

  const two = await currentPeriod();
  ctx.check('줄 둘', two.rows.length, 2);
  ctx.check('구간 합계', two.total, '50000');
  // 목록은 최신이 앞이고 누적은 오래된 줄부터 쌓인다. 마지막 줄이 0에서 시작한 값이다.
  ctx.check('가장 오래된 줄의 누적', two.rows[two.rows.length - 1].runningTotal, '30000');
  ctx.check('최신 줄의 누적', two.rows[0].runningTotal, '50000');
  ctx.check(
    '줄 금액은 카드 부호 규칙 (사용이 음수)',
    two.rows[0].amount,
    '-20000',
  );
  ctx.check(
    '구간 합계 = 진행률 막대의 사용액',
    two.total,
    (await cardLedger.getPerformance(card.id, uid)).usage,
  );

  // ── 실적에서 뺀 결제는 줄에도 없다 ──
  await spend({ amount: '70000', description: '세금', countsPerformance: false });
  const afterExcluded = await currentPeriod();
  ctx.check('뺀 결제는 줄에 없다', afterExcluded.rows.length, 2);
  ctx.check('뺀 결제는 합계에도 없다', afterExcluded.total, '50000');

  // ── 대금 결제는 실적 원장에 섞이지 않는다 ──
  //
  // 부채 계정의 원장에는 함께 쌓이지만 분류 다리가 없다. 그것이 사용과 갚은 돈을
  // 가르는 조건이고, 실적 집계가 쓰는 조건과 같다.
  await cardLedger.transfer(card.id, uid, {
    personId: person.id,
    date: daysAgo(0),
    accountId: bank.id,
    amount: '10000',
    direction: 'payment',
  } as any);
  const afterPayment = await currentPeriod();
  ctx.check('대금 결제는 줄에 없다', afterPayment.rows.length, 2);
  ctx.check('대금 결제는 합계에도 없다', afterPayment.total, '50000');

  // ── 지난 주기는 0에서 다시 쌓는다 ──
  await spend({ amount: '40000', description: '두 주기 전', date: daysAgo(60) });
  const wide = await cardLedger.getPerformanceLedger(card.id, uid, { limit: 50 });
  const olderRow = wide.rows.find((row) => row.description === '두 주기 전');
  ctx.check('지난 주기에도 줄이 있다', Boolean(olderRow), true);
  ctx.check('지난 주기는 0에서 다시 쌓는다', olderRow?.runningTotal, '40000');
  ctx.check(
    '머리글이 주기마다 하나씩 실린다',
    new Set(wide.rows.map((row) => row.periodStart)).size,
    wide.periods.length,
  );
  ctx.check('이번 주기 누적은 그대로', (await currentPeriod()).total, '50000');

  // ── 할부도 한 줄이고 전액이다 ──
  //
  // 카드사가 실적으로 세는 것은 승인 한 건이라, 나눠 갚는다고 그 달 실적이 회차분만
  // 오르지 않는다. 나뉘는 것은 청구뿐이다 (그쪽은 청구 내역이 회차마다 보여 준다).
  await spend({ amount: '30000', description: '할부', installmentMonths: 3 });
  const withPlan = await currentPeriod();
  const planRow = withPlan.rows.find((row) => row.description === '할부');
  ctx.check('할부는 결제한 주기에 전액', planRow?.amount, '-30000');
  ctx.check('할부 개월수', planRow?.installmentMonths, 3);
  ctx.check('할부 줄은 하나뿐', withPlan.rows.filter((row) => row.description === '할부').length, 1);
  ctx.check(
    '할부를 더해도 합계 = 진행률 막대',
    withPlan.total,
    (await cardLedger.getPerformance(card.id, uid)).usage,
  );

  // ── 차감·취소와 실적 ──
  const discounted = await spend({
    amount: '50000',
    discountAmount: '20000',
    description: '포인트 결제',
  });
  const afterDiscount = await currentPeriod();
  const discountRow = afterDiscount.rows.find((row) => row.description === '포인트 결제');
  ctx.check('기본은 실적도 함께 깎인다', discountRow?.amount, '-30000');

  await entries.updateEntry(
    discounted.id,
    uid,
    {
      kind: 'expense',
      personId: person.id,
      cardId: card.id,
      date: daysAgo(0),
      description: '포인트 결제',
      amount: '50000',
      categoryId: food.id,
      discountAmount: '20000',
      discountCountsPerformance: false,
    } as any,
  );
  const kept = await currentPeriod();
  const keptRow = kept.rows.find((row) => row.description === '포인트 결제');
  ctx.check('끄면 실적은 정가로 센다', keptRow?.amount, '-50000');
  ctx.check(
    '실적만 달라진다 (진행률 막대도 정가)',
    kept.total,
    (await cardLedger.getPerformance(card.id, uid)).usage,
  );

  // 청구는 어느 쪽이든 깎인 금액 그대로다.
  // ── 끊어 받기 ──
  //
  // 다른 원장과 같은 방식으로 줄을 끊어 준다. 누적은 잘린 자리와 상관없이 주기 시작부터
  // 센 값이라, 한 줄씩 받아도 한꺼번에 받은 것과 같은 값이 나와야 한다.
  const whole = await cardLedger.getPerformanceLedger(card.id, uid, { limit: 50 });
  const byPage: typeof whole.rows = [];
  let cursor: string | null = null;
  let guard = 0;
  do {
    const page = await cardLedger.getPerformanceLedger(card.id, uid, {
      limit: 1,
      cursor: cursor ?? undefined,
    });
    byPage.push(...page.rows);
    cursor = page.nextCursor;
    guard += 1;
  } while (cursor && guard < 50);

  ctx.check('한 줄씩 받아도 줄 수가 같다', byPage.length, whole.rows.length);
  ctx.check(
    '차례도 같다',
    byPage.map((row) => row.key).join(','),
    whole.rows.map((row) => row.key).join(','),
  );
  ctx.check(
    '누적도 같다 (잘린 자리와 무관하다)',
    byPage.map((row) => row.runningTotal).join(','),
    whole.rows.map((row) => row.runningTotal).join(','),
  );
  ctx.check('끝에서는 커서를 끊는다', cursor ?? null, null);

  // ── 체크카드 ──
  //
  // 자를 기준만 달력 월로 바뀌고 나머지는 같다. 청구 주기도 할부도 없는 길이라 따로 본다.
  const debit = await cards.createCard(
    uid,
    {
      paymentAccountId: bank.id,
      name: '신한 체크',
      cardType: 'debit',
      issuerId: 'fi_card_shinhan',
      performanceAmount: '200000',
    },
    pid,
  );
  await entries.createEntry(
    uid,
    {
      kind: 'expense',
      personId: person.id,
      cardId: debit.id,
      date: daysAgo(0),
      description: '체크 오늘',
      amount: '15000',
      categoryId: food.id,
    } as any,
    pid,
  );
  await entries.createEntry(
    uid,
    {
      kind: 'expense',
      personId: person.id,
      cardId: debit.id,
      date: daysAgo(0),
      description: '체크 오늘 둘째',
      amount: '25000',
      categoryId: food.id,
    } as any,
    pid,
  );

  const debitPage = await cardLedger.getPerformanceLedger(debit.id, uid, { limit: 20 });
  ctx.check('체크: 기준은 달력 월', debitPage.basis, 'month');
  ctx.check('체크: 구간 시작은 1일', new Date(debitPage.periods[0].periodStart).getUTCDate(), 1);
  ctx.check('체크: 줄 둘', debitPage.rows.length, 2);
  ctx.check('체크: 누적이 쌓인다', debitPage.rows[0].runningTotal, '40000');
  ctx.check('체크: 구간 합계', debitPage.periods[0].total, '40000');
  ctx.check(
    '체크: 합계 = 진행률 막대',
    debitPage.periods[0].total,
    (await cardLedger.getPerformance(debit.id, uid)).usage,
  );

  const debitFirst = await cardLedger.getPerformanceLedger(debit.id, uid, { limit: 1 });
  ctx.check('체크: 한 줄만 받는다', debitFirst.rows.length, 1);
  const debitNext = await cardLedger.getPerformanceLedger(debit.id, uid, {
    limit: 1,
    cursor: debitFirst.nextCursor ?? undefined,
  });
  ctx.check('체크: 다음 줄이 이어진다', debitNext.rows[0]?.key, debitPage.rows[1].key);

  const usage = await cardLedger.getUsage(card.id, uid, 3);
  const currentBilled = usage.periods.find(
    (period) => period.periodEnd === kept.periodEnd,
  );
  ctx.check('청구액은 깎인 금액 그대로', currentBilled?.billed, '160000');
  // 실적 = 30,000 + 20,000 + 할부 전액 30,000 + 정가 50,000. 세금은 실적에서 뺐다.
  // 청구액과 갈린다. 청구에는 세금 70,000 이 들고 할부는 첫 회차 10,000 만 든다.
  ctx.check('실적은 정가로', currentBilled?.usage, '130000');
});
