import { Prisma } from '@prisma/client';
import { LedgerService } from '@/modules/ledger/ledger.service';
import { AccountsService } from '@/modules/accounts/accounts.service';
import { PeopleService } from '@/modules/people/people.service';
import { CategoriesService } from '@/modules/categories/categories.service';
import { CardsService } from '@/modules/cards/cards.service';

const D = (n: string | number) => new Prisma.Decimal(n);
import { runSmoke } from './smoke-harness';

runSmoke('services', async (ctx) => {
  const project = await ctx.createProject();
  const pid = project.id;
  // createdByUserId 는 실제 User를 참조하므로 테스트용 계정을 만든다
  const u1 = await ctx.createUser();

  const access = {
    resolveAndVerifyProjectId: async (_u: string, p?: string) => p ?? pid,
    verifyUserHasAccessToProject: async () => undefined,
  } as any;

  const ledger = new LedgerService(ctx.prisma as any);
  const accounts = new AccountsService(ctx.prisma as any, access, ledger);
  const people = new PeopleService(ctx.prisma as any, access);
  const categories = new CategoriesService(ctx.prisma as any, access);
  const cards = new CardsService(ctx.prisma as any, access);

  // ── 사람 ──
  const person = await people.createPerson(u1.id, { name: '김철수' }, pid);
  const personList = await people.getPeople(u1.id, pid); // 다른 사용자도 같은 목록을 봐야 한다
  ctx.check('다른 멤버도 같은 사람 목록을 본다', personList.length, 1);

  // ── 기본 카테고리 ──
  await categories.createDefaultCategories(pid);
  const cats = await categories.getCategories(u1.id, undefined, pid);
  ctx.check('기본 카테고리 생성 수', cats.length, 14);
  ctx.check('대분류가 먼저 정렬되는지', cats.every((c) => c.parentId === null), true);

  const food = cats.find((c) => c.name === '외식')!;
  const sub = await categories.createCategory(u1.id, {
    name: '점심', parentId: food.id, type: 'expense',
  }, pid);
  ctx.check('소분류 생성', sub.parentId, food.id);
  await ctx.expectReject('같은 이름 소분류 중복 거부', () => categories.createCategory(u1.id, {
    name: '점심', parentId: food.id, type: 'expense',
  }, pid));
  await ctx.expectReject('소분류를 부모로 삼는 것 거부', () => categories.createCategory(u1.id, {
    name: '더깊게', parentId: sub.id, type: 'expense',
  }, pid));
  await ctx.expectReject('부모와 다른 유형 거부', () => categories.createCategory(u1.id, {
    name: '이상함', parentId: food.id, type: 'income',
  }, pid));

  // ── 계좌 개설 (개설 잔액이 전표로 남는지) ──
  const bank = await accounts.createAccount(u1.id, {
    type: 'deposit', ownerId: person.id, name: '보통예금',
    institutionId: 'fi_bank_shinhan', openingBalance: '1000000',
  }, pid);
  ctx.check('개설 잔액 반영', bank.balance, '1000000');

  const openingPostings = await ctx.prisma.posting.count({ where: { accountId: bank.id } });
  ctx.check('개설 잔액이 전표로 남았는지', openingPostings, 1);

  // ── 잔액 직접 수정 -> 조정 전표 ──
  await accounts.updateAccount(bank.id, u1.id, { balance: '1200000' });
  const adjusted = await ctx.prisma.account.findUniqueOrThrow({ where: { id: bank.id } });
  ctx.check('잔액 조정 결과', adjusted.balance, '1200000');
  const afterAdjust = await ctx.prisma.posting.count({ where: { accountId: bank.id } });
  ctx.check('조정도 전표로 남았는지', afterAdjust, 2);

  const drift = await ctx.prisma.$queryRaw<{ id: string }[]>`
    SELECT a.id FROM "Account" a LEFT JOIN "Posting" p ON p."accountId" = a.id
    WHERE a."projectId" = ${pid}
    GROUP BY a.id, a.balance HAVING COALESCE(SUM(p.amount), 0) <> a.balance`;
  ctx.check('잔액 조정 후 드리프트', drift.length, 0);

  // ── 숨김 계정 ──
  await cards.createCard(u1.id, {
    paymentAccountId: bank.id, name: '신한 신용', cardType: 'credit',
    issuerId: 'fi_card_shinhan', statementClosingDay: 15, paymentDueDay: 25,
  }, pid);

  const visible = await accounts.getAccounts(u1.id, pid);
  ctx.check('통장 목록에 보이는 계좌 (보통예금만)', visible.length, 1);
  const allAccounts = await ctx.prisma.account.count({ where: { projectId: pid } });
  ctx.check('실제 존재하는 계정 수 (보통예금+부채+자본)', allAccounts, 3);

  await ctx.expectReject('카드 부채 계정을 직접 만드는 것 거부', () => accounts.createAccount(u1.id, {
    type: 'credit_card', ownerId: person.id, name: '몰래',
  }, pid));

  // ── 삭제 가드 ──
  await ctx.expectReject('계좌 주인 삭제 거부', () => people.deletePerson(person.id, u1.id));
  await ctx.expectReject('거래 있는 통장 삭제 거부', () => accounts.deleteAccount(bank.id, u1.id));
  await ctx.expectReject('사용 중인 카테고리 삭제 거부 (사용 후)', async () => {
    await ledger.createExpense({
      projectId: pid, personId: person.id, date: new Date('2026-08-01T00:00:00Z'),
      description: '점심', accountId: bank.id,
      lines: [{ categoryId: sub.id, amount: D(9000) }],
    });
    await categories.deleteCategory(sub.id, u1.id);
  });
  await ctx.expectReject('사용 중인 소분류를 가진 대분류 삭제 거부',
    () => categories.deleteCategory(food.id, u1.id));
});
