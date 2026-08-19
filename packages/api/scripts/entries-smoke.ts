import { Prisma } from '@prisma/client';
import { LedgerService } from '@/modules/ledger/ledger.service';
import { AccountsService } from '@/modules/accounts/accounts.service';
import { PeopleService } from '@/modules/people/people.service';
import { CategoriesService } from '@/modules/categories/categories.service';
import { CardsService } from '@/modules/cards/cards.service';
import { EntriesService } from '@/modules/entries/entries.service';
import { StatementsService } from '@/modules/statements/statements.service';
import { runSmoke } from './smoke-harness';

runSmoke('entries', async (ctx) => {
  const project = await ctx.createProject();
  const pid = project.id;
  const user = await ctx.createUser();
  const uid = user.id;
  const access = {
    resolveAndVerifyProjectId: async (_u: string, p?: string) => p ?? pid,
    verifyUserHasAccessToProject: async () => undefined,
  } as any;

  const ledger = new LedgerService(ctx.prisma as any);
  const accounts = new AccountsService(ctx.prisma as any, access, ledger);
  const people = new PeopleService(ctx.prisma as any, access);
  const categories = new CategoriesService(ctx.prisma as any, access);
  const cards = new CardsService(ctx.prisma as any, access);
  const entries = new EntriesService(ctx.prisma as any, access, ledger);
  const statements = new StatementsService(ctx.prisma as any, access, ledger);

  const person = await people.createPerson(uid, { name: '김철수' }, pid);
  await categories.createDefaultCategories(pid);
  const cats = await categories.getCategories(uid, undefined, pid);
  const dining = cats.find((c) => c.name === '외식')!;
  const salary = cats.find((c) => c.name === '급여')!;
  const misc = cats.find((c) => c.name === '기타수입')!;
  const lunch = await categories.createCategory(uid, {
    name: '점심', parentId: dining.id, type: 'expense',
  }, pid);
  const fee = await categories.createCategory(uid, { name: '수수료', type: 'expense' }, pid);

  const bank = await accounts.createAccount(uid, {
    type: 'deposit', ownerId: person.id, name: '보통예금', bankName: '신한',
    openingBalance: '2000000',
  }, pid);
  const savings = await accounts.createAccount(uid, {
    type: 'savings', ownerId: person.id, name: '저축', bankName: 'KB',
  }, pid);
  const credit = await cards.createCard(uid, {
    paymentAccountId: bank.id, name: '신한 신용', cardType: 'credit',
    issuer: '신한', statementClosingDay: 15, paymentDueDay: 25,
  }, pid);

  const base = { personId: person.id, date: '2026-08-03T00:00:00.000Z' };

  // ── 지출 (신용카드) ──
  const expense = await entries.createEntry(uid, {
    ...base, kind: 'expense', description: '스타벅스', merchant: '스타벅스 강남점',
    amount: '5000', categoryId: lunch.id, cardId: credit.id,
  }, pid);
  ctx.check('지출 kind', expense.kind, 'expense');
  ctx.check('지출 금액 (양수 표시)', expense.amount, '5000');
  ctx.check('지출 카테고리', expense.categoryName, '점심');
  ctx.check('대분류 자동 유도', expense.parentCategoryName, '외식');
  ctx.check('카드 표시', expense.cardName, '신한 신용');
  ctx.check('거래처', expense.merchant, '스타벅스 강남점');
  ctx.check('전표 leg 수', expense.postings.length, 2);

  // ── 수입 ──
  const income = await entries.createEntry(uid, {
    ...base, kind: 'income', description: '8월 급여',
    amount: '3000000', categoryId: salary.id, accountId: bank.id,
  }, pid);
  ctx.check('수입 kind', income.kind, 'income');
  ctx.check('수입 금액 (양수 표시)', income.amount, '3000000');

  // ── 이체 + 수수료 ──
  const transfer = await entries.createEntry(uid, {
    ...base, kind: 'transfer', description: '저축 이체', amount: '500000',
    accountId: bank.id, toAccountId: savings.id,
    transferFee: '500', transferFeeCategoryId: fee.id,
  }, pid);
  ctx.check('이체 kind (수수료 있어도 transfer)', transfer.kind, 'transfer');
  ctx.check('이체 보내는 계좌', transfer.accountName, '보통예금');
  ctx.check('이체 받는 계좌', transfer.toAccountName, '저축');
  ctx.check('이체 leg 수', transfer.postings.length, 3);

  // ── 분할 지출 ──
  const split = await entries.createEntry(uid, {
    ...base, kind: 'expense', description: '이마트', amount: '40000',
    accountId: bank.id,
    splits: [
      { categoryId: lunch.id, amount: '30000' },
      { categoryId: dining.id, amount: '10000' },
    ],
  }, pid);
  ctx.check('분할 지출 leg 수', split.postings.length, 3);
  ctx.check('분할 지출 표시 금액', split.amount, '40000');

  // ── 청구서 ──
  const stmts = await statements.getStatements(uid, { projectId: pid });
  ctx.check('청구서 자동 생성', stmts.length, 1);
  ctx.check('청구서 사용액', stmts[0].chargedAmount, '5000');
  ctx.check('청구서 미결제액', stmts[0].outstanding, '5000');
  ctx.check('청구서 상태 (마감 지남)', stmts[0].status, 'closed');

  await statements.payStatement(stmts[0].id, uid, {
    accountId: bank.id, personId: person.id, date: '2026-08-25T00:00:00Z',
  });
  const paid = await statements.getStatementById(stmts[0].id, uid);
  ctx.check('결제 후 미결제액', paid.outstanding, '0');
  ctx.check('결제 후 상태', paid.status, 'paid');

  // ── 목록 + 커서 페이지네이션 ──
  const page1 = await entries.getEntries(uid, { limit: 3 }, pid);
  ctx.check('1페이지 건수', page1.data.length, 3);
  ctx.check('다음 커서 존재', page1.nextCursor !== null, true);
  const page2 = await entries.getEntries(uid, { limit: 3, cursor: page1.nextCursor! }, pid);
  const ids = new Set([...page1.data, ...page2.data].map((e) => e.id));
  ctx.check('페이지 간 중복 없음', ids.size, page1.data.length + page2.data.length);

  // 카드 필터는 그 카드가 얽힌 전표를 모두 준다: 사용 1건 + 대금 결제 1건
  const byCard = await entries.getEntries(uid, { cardId: credit.id }, pid);
  ctx.check('카드 필터 건수 (사용 + 결제)', byCard.data.length, 2);
  ctx.check('카드 필터 종류', byCard.data.map((e) => e.kind).sort().join(','), 'card_payment,expense');
  const usageOnly = await entries.getEntries(uid, { cardId: credit.id, kind: 'expense' }, pid);
  ctx.check('카드 사용만 (kind 필터)', usageOnly.data.length, 1);

  // ── 수정 (전표 전체 교체) ──
  const bankBefore = await ctx.prisma.account.findUniqueOrThrow({ where: { id: bank.id } });
  await entries.updateEntry(split.id, uid, {
    ...base, kind: 'expense', description: '이마트 (수정)', amount: '25000',
    accountId: bank.id, categoryId: lunch.id,
  });
  const updated = await entries.getEntryById(split.id, uid);
  ctx.check('수정 후 id 유지', updated.id, split.id);
  ctx.check('수정 후 leg 수 (3 -> 2)', updated.postings.length, 2);
  ctx.check('수정 후 금액', updated.amount, '25000');
  const bankAfter = await ctx.prisma.account.findUniqueOrThrow({ where: { id: bank.id } });
  ctx.check('수정 후 잔액 (40000 되돌리고 25000 적용)',
    bankAfter.balance.sub(bankBefore.balance).toString(), '15000');

  // ── 예산 사용액 (대분류 롤업) ──
  const { BudgetsService } = await import('@/modules/budgets/budgets.service');
  const budgets = new BudgetsService(ctx.prisma as any, access);
  const monthly = await budgets.getBudgetForMonth(uid, pid, 2026, 8);
  const diningRow = monthly.find((r) => r.categoryId === dining.id)!;
  const lunchRow = monthly.find((r) => r.categoryId === lunch.id)!;
  ctx.check('소분류 점심 사용액 (5000 + 25000)', lunchRow.usedAmount, '30000');
  ctx.check('대분류 외식 사용액 (소분류 롤업)', diningRow.usedAmount, '30000');
  const totalExpense = monthly.find((r) => !r.categoryId && r.categoryType === 'expense')!;
  ctx.check('전체 지출 (외식 30000 + 수수료 500)', totalExpense.usedAmount, '30500');
  const totalIncome = monthly.find((r) => !r.categoryId && r.categoryType === 'income')!;
  ctx.check('전체 수입', totalIncome.usedAmount, '3000000');

  // ── 예산: 진행률 계산에 쓰는 값이 문자열이라 비교가 깨졌던 지점 ──
  //
  // 서버가 금액을 문자열로 주는데 화면이 그대로 비교하면
  // "3000" > "10000" 이 true가 되어(첫 글자 비교) 진행률이 101%로 나왔다.
  await budgets.createBudget(uid, {
    type: 'expense', monthlyAmount: '10000',
  } as any, pid);
  const withBudget = await budgets.getBudgetForMonth(uid, pid, 2026, 8);
  const totalExpenseBudget = withBudget.find((r) => !r.categoryId && r.categoryType === 'expense')!;
  ctx.check('전체 지출 예산액', totalExpenseBudget.monthlyAmount, '10000');
  ctx.check('전체 지출 사용액 (외식 30000 + 이체수수료 500)', totalExpenseBudget.usedAmount, '30500');

  // 화면이 쓰는 계산과 같은 식 (packages/web/src/lib/budget.ts)
  const percentage = (budget: string, used: string) => {
    const b = Number(budget) || 0;
    const u = Number(used) || 0;
    if (b <= 0) return 0;
    const ratio = Math.floor((u / b) * 100);
    return u > b ? Math.max(101, ratio) : ratio;
  };
  // 초과하면 최소 101%. 막대가 꽉 찬 100%와 눈으로 구분하기 위함이다.
  ctx.check('초과 시 진행률 (예산 10000, 사용 30000)', percentage('10000', '30000'), 300);
  ctx.check('정확히 100%는 101로 올리지 않는다', percentage('10000', '10000'), 100);
  ctx.check('미달 시 진행률 (예산 10000, 사용 3000)', percentage('10000', '3000'), 30);
  ctx.check('문자열 비교 함정: 사용<예산인데 초과로 보이면 안 된다',
    percentage('10000', '3000') > 100, false);

  // ── 정합성 ──
  const unbalanced = await ctx.prisma.$queryRaw<{ entryId: string }[]>`
    SELECT "entryId" FROM "Posting" GROUP BY "entryId" HAVING SUM(amount) <> 0`;
  ctx.check('불균형 전표', unbalanced.length, 0);
  const drift = await ctx.prisma.$queryRaw<{ id: string }[]>`
    SELECT a.id FROM "Account" a LEFT JOIN "Posting" p ON p."accountId" = a.id
    WHERE a."projectId" = ${pid}
    GROUP BY a.id, a.balance HAVING COALESCE(SUM(p.amount), 0) <> a.balance`;
  ctx.check('잔액 드리프트', drift.length, 0);

  // ── 삭제 ──
  await entries.deleteEntry(transfer.id, uid);
  const afterDelete = await ctx.prisma.account.findUniqueOrThrow({ where: { id: savings.id } });
  ctx.check('이체 삭제 후 받는 계좌', afterDelete.balance, '0');
});
