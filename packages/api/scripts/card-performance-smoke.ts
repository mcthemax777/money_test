/**
 * 카드 실적.
 *
 * 세는 구간이 카드 종류마다 다르다는 것이 이 검사의 요지다.
 *   - 신용카드: 마감일 기준 청구 주기. 마감일이 15일이면 8/16~9/15가 한 구간이다.
 *   - 체크카드: 달력 월. 청구 주기가 없어 자를 기준이 달력뿐이다.
 *
 * 구간이 "지금"을 기준으로 움직이므로 날짜는 오늘에서 거꾸로 만든다. 고정 날짜를
 * 쓰면 언제 돌리느냐에 따라 그 거래가 구간 안팎을 오간다.
 */

import { PeopleService } from '@/modules/people/people.service';
import { CategoriesService } from '@/modules/categories/categories.service';
import { CardsService } from '@/modules/cards/cards.service';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import { CardLedgerService } from '@/modules/cards/card-ledger.service';
import { zonedDayStart, zonedParts } from '@money/types';
import {
  makeAccounts,
  makeEntries,
  makeLedger,
  projectAccessStub,
  runSmoke,
} from './smoke-harness';

const TZ = 'Asia/Seoul';
const CLOSING_DAY = 15;

runSmoke('card-performance', async (ctx) => {
  const project = await ctx.createProject({ timezone: TZ });
  const pid = project.id;
  const user = await ctx.createUser();
  const uid = user.id;
  const access = projectAccessStub(ctx.prisma, pid);

  const ledger = makeLedger(ctx.prisma, access);
  const institutions = new InstitutionsService(ctx.prisma as any, access);
  const accounts = makeAccounts(ctx.prisma, access, ledger, institutions);
  const people = new PeopleService(ctx.prisma as any, access);
  const categories = new CategoriesService(ctx.prisma as any, access);
  const cards = new CardsService(ctx.prisma as any, access, institutions);
  const entries = makeEntries(ctx.prisma, access, ledger);
  const cardLedger = new CardLedgerService(ctx.prisma as any, access as any, ledger as any);

  const chulsoo = await people.createPerson(uid, { name: '김철수' }, pid);
  await categories.createDefaultCategories(pid);
  const cats = await categories.getCategories(uid, undefined, pid);
  const dining = cats.find((c) => c.name === '외식')!;

  const bank = await accounts.createAccount(
    uid,
    {
      type: 'deposit',
      ownerId: chulsoo.id,
      name: '보통예금',
      institutionId: 'fi_bank_shinhan',
      openingBalance: '10000000',
    },
    pid,
  );

  /*
   * 실적은 "지금"을 기준으로 진행 중인 구간만 본다. 고정 날짜로 거래를 넣으면
   * 언제 돌리느냐에 따라 그 구간 밖이 되므로, 오늘에서 거꾸로 날짜를 만든다.
   */
  const today = zonedParts(new Date(), TZ);
  /** 오늘에서 back일 전 정오 (서울 기준). 날짜 경계에 걸리지 않게 한낮으로 둔다. */
  const daysAgo = (back: number) =>
    new Date(
      zonedDayStart(today.year, today.month, today.day - back, TZ).getTime() + 12 * 3600_000,
    ).toISOString();

  const credit = await cards.createCard(
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
  const noTarget = await cards.createCard(
    uid,
    { paymentAccountId: bank.id, name: '실적없음 체크', cardType: 'debit', issuerId: 'fi_card_kb' },
    pid,
  );

  ctx.check('실적 기준액이 저장된다', credit.performanceAmount, '300000');
  ctx.check('체크카드도 기준액을 갖는다', debit.performanceAmount, '200000');
  ctx.check('안 넣으면 null', noTarget.performanceAmount ?? null, null);

  const spend = (cardId: string, amount: string, date: string, description: string) =>
    entries.createEntry(
      uid,
      {
        kind: 'expense',
        personId: chulsoo.id,
        date,
        description,
        amount,
        categoryId: dining.id,
        cardId,
      },
      pid,
    );

  // ── 아직 아무것도 안 썼을 때 ──
  const emptyCredit = await cardLedger.getPerformance(credit.id, uid);
  ctx.check('신용: 구간 기준은 청구 주기', emptyCredit.basis, 'statement');
  ctx.check('신용: 사용액 0', emptyCredit.usage, '0');
  ctx.check('신용: 기준액', emptyCredit.target, '300000');
  ctx.check('신용: 미달성', emptyCredit.achieved, false);
  ctx.check('신용: 남은 금액 = 기준액', emptyCredit.remaining, '300000');

  // 마감일이 15일이면 구간은 (전달 16일 ~ 이달 15일) 또는 (이달 16일 ~ 다음달 15일)이다.
  // 어느 쪽이든 끝나는 날은 15일이고 시작하는 날은 16일이다.
  ctx.check(
    '신용: 구간 끝은 마감일',
    new Date(emptyCredit.periodEnd).getUTCDate(),
    CLOSING_DAY,
  );
  ctx.check(
    '신용: 구간 시작은 직전 마감 다음 날',
    new Date(emptyCredit.periodStart).getUTCDate(),
    CLOSING_DAY + 1,
  );

  const emptyDebit = await cardLedger.getPerformance(debit.id, uid);
  ctx.check('체크: 구간 기준은 달력 월', emptyDebit.basis, 'month');
  ctx.check('체크: 구간 시작은 1일', new Date(emptyDebit.periodStart).getUTCDate(), 1);
  ctx.check(
    '체크: 구간은 이번 달',
    new Date(emptyDebit.periodStart).getUTCMonth() + 1,
    today.month,
  );

  const emptyNoTarget = await cardLedger.getPerformance(noTarget.id, uid);
  ctx.check('기준액 없으면 target도 null', emptyNoTarget.target ?? null, null);
  ctx.check('기준액 없으면 달성 아님', emptyNoTarget.achieved, false);
  ctx.check('기준액 없으면 남은 금액도 null', emptyNoTarget.remaining ?? null, null);

  // ── 진행 중인 구간에 쓴다 ──
  await spend(credit.id, '100000', daysAgo(0), '오늘 신용');
  await spend(debit.id, '50000', daysAgo(0), '오늘 체크');

  const partialCredit = await cardLedger.getPerformance(credit.id, uid);
  ctx.check('신용: 오늘 쓴 것이 잡힌다', partialCredit.usage, '100000');
  ctx.check('신용: 아직 미달성', partialCredit.achieved, false);
  ctx.check('신용: 남은 금액', partialCredit.remaining, '200000');

  const partialDebit = await cardLedger.getPerformance(debit.id, uid);
  ctx.check('체크: 오늘 쓴 것이 잡힌다', partialDebit.usage, '50000');
  ctx.check('체크: 남은 금액', partialDebit.remaining, '150000');
  ctx.check('체크: 다른 카드 사용은 섞이지 않는다', partialDebit.usage, '50000');

  // ── 기준을 채운다 ──
  await spend(credit.id, '250000', daysAgo(0), '기준 넘기기');
  const achievedCredit = await cardLedger.getPerformance(credit.id, uid);
  ctx.check('신용: 누적 사용액', achievedCredit.usage, '350000');
  ctx.check('신용: 달성', achievedCredit.achieved, true);
  ctx.check('신용: 채웠으면 남은 금액은 0', achievedCredit.remaining, '0');

  // ── 통장에서 직접 나간 지출은 카드 실적이 아니다 ──
  //
  // 체크카드는 연결 통장에서 바로 빠지므로 같은 통장의 posting이 된다. 카드를
  // 거치지 않은 결제까지 세면 통장을 쓸 때마다 실적이 오른다.
  await entries.createEntry(
    uid,
    {
      kind: 'expense',
      personId: chulsoo.id,
      date: daysAgo(0),
      description: '통장에서 바로 결제',
      amount: '400000',
      categoryId: dining.id,
      accountId: bank.id,
    },
    pid,
  );
  const afterDirect = await cardLedger.getPerformance(debit.id, uid);
  ctx.check('체크: 통장 직접 지출은 실적에 안 들어온다', afterDirect.usage, '50000');

  // ── 구간 밖의 거래는 세지 않는다 ──
  //
  // 60일 전이면 신용카드는 두 주기 앞, 체크카드는 두 달 앞이라 어느 쪽 구간에도
  // 들어오지 않는다. 오늘이 며칠이든 성립한다.
  await spend(credit.id, '500000', daysAgo(60), '두 주기 전 신용');
  await spend(debit.id, '500000', daysAgo(60), '두 달 전 체크');

  ctx.check(
    '신용: 지난 주기 사용은 이번 실적에 안 들어온다',
    (await cardLedger.getPerformance(credit.id, uid)).usage,
    '350000',
  );
  ctx.check(
    '체크: 지난달 사용은 이번 실적에 안 들어온다',
    (await cardLedger.getPerformance(debit.id, uid)).usage,
    '50000',
  );

  // ── 기준액을 지운다 ──
  await cards.updateCard(credit.id, uid, { performanceAmount: '' });
  const cleared = await cardLedger.getPerformance(credit.id, uid);
  ctx.check('기준액을 지우면 target null', cleared.target ?? null, null);
  ctx.check('기준액을 지워도 사용액은 그대로', cleared.usage, '350000');
});
