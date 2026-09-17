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

  /** 진행 중인 주기. 실적 원장은 최신 주기가 앞이다. */
  const currentPeriod = async (months = 3) =>
    (await cardLedger.getPerformanceLedger(card.id, uid, months)).periods[0];

  // ── 빈 카드 ──
  const empty = await cardLedger.getPerformanceLedger(card.id, uid, 3);
  ctx.check('주기 셋을 준다', empty.periods.length, 3);
  ctx.check('기준은 청구 주기', empty.basis, 'statement');
  ctx.check('기준액이 실린다', empty.target, '300000');
  ctx.check('줄이 없다', empty.periods[0].rows.length, 0);
  ctx.check('합계 0', empty.periods[0].total, '0');
  ctx.check('진행 중인 주기가 앞', empty.periods[0].closed, false);

  // ── 이번 주기에 쌓인다 ──
  await spend({ amount: '30000', description: '첫 결제', date: daysAgo(0) });
  await spend({ amount: '20000', description: '둘째 결제', date: daysAgo(0) });

  const two = await currentPeriod();
  ctx.check('줄 둘', two.rows.length, 2);
  ctx.check('구간 합계', two.total, '50000');
  // 목록은 최신이 앞이고 누적은 오래된 줄부터 쌓인다. 마지막 줄이 0에서 시작한 값이다.
  ctx.check('가장 오래된 줄의 누적', two.rows[two.rows.length - 1].performanceAfter, '30000');
  ctx.check('최신 줄의 누적', two.rows[0].performanceAfter, '50000');
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
  const wide = await cardLedger.getPerformanceLedger(card.id, uid, 3);
  const older = wide.periods.find((period) => period.rows.some((row) => row.description === '두 주기 전'));
  ctx.check('지난 주기에도 줄이 있다', older?.rows.length, 1);
  ctx.check('지난 주기는 0에서 다시 쌓는다', older?.rows[0].performanceAfter, '40000');
  ctx.check('이번 주기 누적은 그대로', (await currentPeriod()).total, '50000');

  // ── 할부는 회차마다 한 줄 ──
  //
  // 주기 합계가 회차분만 세므로, 구매한 달에 전액을 한 줄로 두면 줄의 합과 진행률
  // 막대가 갈린다.
  await spend({ amount: '30000', description: '할부', installmentMonths: 3 });
  const withPlan = await currentPeriod();
  const planRow = withPlan.rows.find((row) => row.description === '할부');
  ctx.check('할부 첫 회차만 이번 주기', planRow?.amount, '-10000');
  ctx.check('회차 번호', planRow?.installmentIndex, 1);
  ctx.check('할부 개월수', planRow?.installmentMonths, 3);
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
  const usage = await cardLedger.getUsage(card.id, uid, 3);
  const currentBilled = usage.periods.find(
    (period) => period.periodEnd === kept.periodEnd,
  );
  ctx.check('청구액은 깎인 금액 그대로', currentBilled?.billed, '160000');
  // 실적 = 30,000 + 20,000 + 할부 첫 회차 10,000 + 정가 50,000. 세금은 실적에서 뺐다.
  ctx.check('실적은 정가로', currentBilled?.usage, '110000');
});
