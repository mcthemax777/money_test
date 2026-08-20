import { AccountsService } from '@/modules/accounts/accounts.service';
import { CardsService } from '@/modules/cards/cards.service';
import { CategoriesService } from '@/modules/categories/categories.service';
import { EntriesService } from '@/modules/entries/entries.service';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import { LedgerService } from '@/modules/ledger/ledger.service';
import { PeopleService } from '@/modules/people/people.service';
import { ReportsService } from '@/modules/reports/reports.service';
import { StatementsService } from '@/modules/statements/statements.service';
import { projectAccessStub, runSmoke } from './smoke-harness';

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

    const ledger = new LedgerService(ctx.prisma as any);
    const institutions = new InstitutionsService(ctx.prisma as any, access);
    const accounts = new AccountsService(ctx.prisma as any, access, ledger, institutions);
    const people = new PeopleService(ctx.prisma as any, access);
    const categories = new CategoriesService(ctx.prisma as any, access);
    const cards = new CardsService(ctx.prisma as any, access, institutions);
    const entries = new EntriesService(ctx.prisma as any, access, ledger);
    const reports = new ReportsService(ctx.prisma as any, access);
    const statements = new StatementsService(ctx.prisma as any, access, ledger);

    const person = await people.createPerson(uid, { name: '김철수' }, pid);
    await categories.createDefaultCategories(pid);
    const cats = await categories.getCategories(uid, undefined, pid);
    const dining = cats.find((c) => c.name === '외식')!;

    const bank = await accounts.createAccount(uid, {
      type: 'deposit', ownerId: person.id, name: '보통예금', institutionId: 'fi_bank_shinhan',
      openingBalance: '1000000', openingBalanceDate: '2026-01-01',
    }, pid);

    return { pid, person, dining, bank, accounts, cards, entries, reports, statements };
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

  const rows = await seoul.statements.getStatements(uid, { projectId: seoul.pid, cardId: card.id });
  ctx.check('청구서 1건', rows.length, 1);
  ctx.check('마감일이 9/15로 넘어간다', rows[0]?.periodEnd.slice(0, 10), '2026-09-15');
  ctx.check('주기 시작은 8/16', rows[0]?.periodStart.slice(0, 10), '2026-08-16');
  ctx.check('결제일은 9/25', rows[0]?.dueDate.slice(0, 10), '2026-09-25');
});
