import { CardsService } from '@/modules/cards/cards.service';
import { CategoriesService } from '@/modules/categories/categories.service';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import { PeopleService } from '@/modules/people/people.service';
import { CardLedgerService } from '@/modules/cards/card-ledger.service';
import {
  makeAccounts,
  makeCards,
  makeCategories,
  makeEntries,
  makeLedger,
  makePeople,
  makeReports,
  projectAccessStub,
  runSmoke,
} from './smoke-harness';

/**
 * 집계 경계가 프로젝트 타임존을 따르는지 확인한다.
 *
 * 예전에는 월 경계와 카드 마감일을 UTC로 계산했다. 그래서 한국에서 00:00~09:00에
 * 입력한 거래가 전월(또는 이전 청구주기)로 집계됐다. 아래 검사는 그 경계값을
 * 정확히 겨냥한다.
 *
 *   2026-07-31T15:30:00Z = 서울 2026-08-01 00:30 = 뉴욕 2026-07-31 11:30
 * 같은 인스턴트가 프로젝트 타임존에 따라 다른 달에 속해야 한다.
 */
runSmoke('timezone', async (ctx) => {
  const user = await ctx.createUser();
  const uid = user.id;

  /** 프로젝트 하나를 그 타임존으로 만들고 필요한 서비스를 묶어 돌려준다. */
  const setup = async (timezone: string) => {
    const project = await ctx.createProject({ timezone });
    const pid = project.id;
    const access = projectAccessStub(ctx.prisma, pid);

    const ledger = makeLedger(ctx.prisma, access);
    const institutions = new InstitutionsService(ctx.prisma as any, access);
    const accounts = makeAccounts(ctx.prisma, access, ledger, institutions);
    const people = makePeople(ctx.prisma, access);
    const categories = makeCategories(ctx.prisma, access);
    const cards = makeCards(ctx.prisma, access, institutions);
    const entries = makeEntries(ctx.prisma, access, ledger);
    const reports = makeReports(ctx.prisma, access);
    const cardLedger = new CardLedgerService(ctx.prisma as any, access, ledger);

    const person = await people.createPerson(uid, { name: '김철수' }, pid);
    await categories.createDefaultCategories(pid);
    const cats = await categories.getCategories(uid, undefined, pid);
    const dining = cats.find((c) => c.name === '외식')!;

    const bank = await accounts.createAccount(uid, {
      type: 'deposit', ownerId: person.id, name: '보통예금', institutionId: 'fi_bank_shinhan',
      openingBalance: '1000000',
    }, pid);

    return { pid, person, dining, bank, accounts, cards, entries, reports, cardLedger };
  };

  // ── 서울: 경계 인스턴트는 8월에 속한다 ──
  const seoul = await setup('Asia/Seoul');
  await seoul.entries.createEntry(uid, {
    kind: 'expense', personId: seoul.person.id, date: '2026-07-31T15:30:00.000Z',
    description: '자정 넘긴 야식', amount: '20000',
    categoryId: seoul.dining.id, accountId: seoul.bank.id,
  }, seoul.pid);

  const seoulAug = await seoul.reports.getSummary(uid, { projectId: seoul.pid, yearMonth: '2026-08' });
  const seoulJul = await seoul.reports.getSummary(uid, { projectId: seoul.pid, yearMonth: '2026-07' });
  ctx.check('서울: 8월 00:30 거래는 8월 지출', seoulAug.expense, '20000');
  ctx.check('서울: 7월에는 잡히지 않는다', seoulJul.expense, '0');

  const seoulTrend = await seoul.reports.getTrend(uid, {
    projectId: seoul.pid, target: 'total', type: 'expense', endMonth: '2026-08', months: 2,
  });
  ctx.check('서울: 시계열도 8월에 잡힌다',
    seoulTrend.find((p) => p.yearMonth === '2026-08')?.amount, '20000');
  ctx.check('서울: 시계열 7월은 0',
    seoulTrend.find((p) => p.yearMonth === '2026-07')?.amount, '0');

  const seoulDaily = await seoul.reports.getBalanceHistory(uid, {
    projectId: seoul.pid, granularity: 'day', yearMonth: '2026-08',
  });
  ctx.check('서울: 일별 추이 첫 칸은 8월 1일', seoulDaily[0]?.date, '2026-08-01');
  ctx.check('서울: 8월 1일 잔액에 이미 반영', seoulDaily[0]?.balance, '980000');

  // ── 뉴욕: 같은 인스턴트가 7월에 속한다 ──
  const ny = await setup('America/New_York');
  await ny.entries.createEntry(uid, {
    kind: 'expense', personId: ny.person.id, date: '2026-07-31T15:30:00.000Z',
    description: '점심', amount: '20000',
    categoryId: ny.dining.id, accountId: ny.bank.id,
  }, ny.pid);

  const nyAug = await ny.reports.getSummary(uid, { projectId: ny.pid, yearMonth: '2026-08' });
  const nyJul = await ny.reports.getSummary(uid, { projectId: ny.pid, yearMonth: '2026-07' });
  ctx.check('뉴욕: 같은 인스턴트는 7월 지출', nyJul.expense, '20000');
  ctx.check('뉴욕: 8월에는 잡히지 않는다', nyAug.expense, '0');

  // ── 카드 청구주기도 그 지역 달력으로 잘린다 ──
  // 마감일 15일. 서울 기준 8/16 00:30 결제는 다음 주기(9/15 마감)에 속해야 한다.
  const card = await seoul.cards.createCard(uid, {
    paymentAccountId: seoul.bank.id, name: '신한 신용', cardType: 'credit',
    issuerId: 'fi_card_shinhan', statementClosingDay: 15, paymentDueDay: 25,
  }, seoul.pid);

  await seoul.entries.createEntry(uid, {
    kind: 'expense', personId: seoul.person.id, date: '2026-08-15T15:30:00.000Z',
    description: '마감 다음날 결제', amount: '30000',
    categoryId: seoul.dining.id, cardId: card.id,
  }, seoul.pid);

  const usage = await seoul.cardLedger.getUsage(card.id, uid);
  const used = usage.periods.filter((p: { usage: string }) => Number(p.usage) !== 0);
  ctx.check('금액이 잡힌 주기는 1개', used.length, 1);
  ctx.check('마감일이 9/15로 넘어간다', used[0]?.periodEnd.slice(0, 10), '2026-09-15');
  ctx.check('주기 시작은 8/16', used[0]?.periodStart.slice(0, 10), '2026-08-16');
  ctx.check('결제일은 9/25', used[0]?.dueDate?.slice(0, 10), '2026-09-25');

  /*
   * ── 주기를 눌러 좁힌 목록은 그 지역의 하루를 온전히 담는다 ──
   *
   * 목록 창구의 startDate/endDate 는 **인스턴트**다. 화면이 주기의 달력 날짜를 그대로
   * 넘기면 UTC 자정으로 읽혀, 한국 기준으로 시작일은 오전 아홉 시부터가 되고 종료일은
   * 오전 아홉 시에 잘린다. 7월 주기를 골랐을 때 **7월 31일 오후의 결제가 사라졌다.**
   *
   * 바꾸는 일은 화면이 한다(core 의 `dayRangeQuery`). 여기서는 그 결과를 그대로 보내
   * 양끝이 온전히 드는지 못 박는다 -- 7월 1일 0시부터 8월 1일 0시 직전까지다.
   */
  await seoul.entries.createEntry(uid, {
    kind: 'expense', personId: seoul.person.id, date: '2026-07-31T05:00:00.000Z',
    description: '말일 오후', amount: '11000',
    categoryId: seoul.dining.id, accountId: seoul.bank.id,
  }, seoul.pid);
  await seoul.entries.createEntry(uid, {
    kind: 'expense', personId: seoul.person.id, date: '2026-06-30T16:00:00.000Z',
    description: '초하루 새벽', amount: '12000',
    categoryId: seoul.dining.id, accountId: seoul.bank.id,
  }, seoul.pid);

  const july = await seoul.entries.getEntries(uid, {
    // `dayRangeQuery('2026-07-01', '2026-07-31', 'Asia/Seoul')` 가 내는 값이다.
    startDate: '2026-06-30T15:00:00.000Z',
    endDate: '2026-07-31T14:59:59.999Z',
  }, seoul.pid);
  const names = july.data.map((row) => row.description);
  ctx.check('7월 말일 오후의 결제가 든다', names.includes('말일 오후'), true);
  ctx.check('7월 초하루 새벽의 결제도 든다', names.includes('초하루 새벽'), true);
  ctx.check('8월로 넘어간 자정 거래는 빠진다', names.includes('자정 넘긴 야식'), false);

  /*
   * 달력 날짜를 그대로 넘겨도 같은 줄이 온다.
   *
   * 같은 이름의 칸이 창구마다 뜻이 달라(목록은 인스턴트, 구간 조회는 달력 날짜) 화면이
   * 헷갈릴 자리가 남아 있다. 잘라 내는 쪽보다 넓게 읽는 쪽이 낫다 -- "2026-07-31" 은
   * 그 날 끝까지다.
   */
  const julyByKey = await seoul.entries.getEntries(uid, {
    startDate: '2026-07-01',
    endDate: '2026-07-31',
  }, seoul.pid);
  const keyNames = julyByKey.data.map((row) => row.description);
  ctx.check('달력 날짜로 줘도 말일 오후가 든다', keyNames.includes('말일 오후'), true);
  ctx.check('달력 날짜로 줘도 초하루 새벽이 든다', keyNames.includes('초하루 새벽'), true);
  ctx.check('달력 날짜로 줘도 8월 거래는 빠진다', keyNames.includes('자정 넘긴 야식'), false);
});
