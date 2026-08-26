/**
 * 예산의 적용 범위와 전체 초기화.
 *
 * 화면이 새로 쓰기 시작한 세 갈래를 확인한다.
 *   - 기본 예산(적용 기간 없음)은 모든 달에 걸린다
 *   - applyMode='from'은 규칙을 앞 달까지로 끊고 그 달부터 새 규칙을 만든다
 *   - BudgetOverride는 규칙을 두고 그 달에만 다른 값을 씌운다
 * 마지막으로 DELETE /budgets(resetBudgets)가 조정값까지 함께 지우는지 본다.
 */

import { PeopleService } from '@/modules/people/people.service';
import { CategoriesService } from '@/modules/categories/categories.service';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import {
  makeAccounts,
  makeBudgets,
  makeEntries,
  makeLedger,
  projectAccessStub,
  runSmoke,
} from './smoke-harness';

runSmoke('budget-scope', async (ctx) => {
  const project = await ctx.createProject();
  const pid = project.id;
  const user = await ctx.createUser();
  const uid = user.id;
  const access = projectAccessStub(ctx.prisma, pid);

  const ledger = makeLedger(ctx.prisma, access);
  const institutions = new InstitutionsService(ctx.prisma as any, access);
  const accounts = makeAccounts(ctx.prisma, access, ledger, institutions);
  const people = new PeopleService(ctx.prisma as any, access);
  const categories = new CategoriesService(ctx.prisma as any, access);
  const entries = makeEntries(ctx.prisma, access, ledger);
  const budgets = makeBudgets(ctx.prisma, access);

  const chulsoo = await people.createPerson(uid, { name: '김철수' }, pid);
  await categories.createDefaultCategories(pid);
  const cats = await categories.getCategories(uid, undefined, pid);
  const dining = cats.find((c) => c.name === '외식')!;
  const housing = cats.find((c) => c.name === '공과금')!;

  const bank = await accounts.createAccount(
    uid,
    {
      type: 'deposit',
      ownerId: chulsoo.id,
      name: '보통예금',
      institutionId: 'fi_bank_shinhan',
      openingBalance: '1000000',
    },
    pid,
  );

  /** 그 달 외식 예산 금액 */
  const diningAmount = async (year: number, month: number) => {
    const rows = await budgets.getBudgetForMonth(uid, pid, year, month);
    return Number(rows.find((r) => r.categoryId === dining.id)?.monthlyAmount ?? 0);
  };
  const diningRow = async (year: number, month: number) => {
    const rows = await budgets.getBudgetForMonth(uid, pid, year, month);
    return rows.find((r) => r.categoryId === dining.id)!;
  };

  // ── 기본 예산: 적용 기간이 없으면 모든 달에 걸린다 ──
  const base = await budgets.createBudget(
    uid,
    { categoryId: dining.id, type: 'expense', monthlyAmount: '300000' },
    pid,
  );
  ctx.check('기본 예산: 적용 시작이 없다', base.effectiveFrom ?? null, null);
  ctx.check('기본 예산: 2026-08', await diningAmount(2026, 8), 300000);
  ctx.check('기본 예산: 한참 뒤 2030-12도 같은 값', await diningAmount(2030, 12), 300000);
  ctx.check('기본 예산: 한참 앞 2020-01도 같은 값', await diningAmount(2020, 1), 300000);

  // ── 이 달만 조정 (BudgetOverride) ──
  const override = await budgets.createOverride(uid, {
    budgetId: base.id,
    year: 2026,
    month: 8,
    amount: '500000',
  });
  ctx.check('이 달만: 8월은 조정값', await diningAmount(2026, 8), 500000);
  ctx.check('이 달만: 9월은 그대로', await diningAmount(2026, 9), 300000);
  ctx.check('이 달만: 7월도 그대로', await diningAmount(2026, 7), 300000);

  const augRow = await diningRow(2026, 8);
  ctx.check('이 달만: 조정 표시', augRow.isOverridden, true);
  ctx.check('이 달만: 조정 id를 함께 내려준다', augRow.overrideId, override.id);
  ctx.check('조정 없는 달은 id도 없다', (await diningRow(2026, 9)).overrideId ?? null, null);

  // 조정 해제하면 규칙 금액으로 돌아온다
  await budgets.deleteOverride(override.id, uid);
  ctx.check('조정 해제: 8월이 규칙 금액으로', await diningAmount(2026, 8), 300000);
  ctx.check('조정 해제: 표시도 꺼진다', (await diningRow(2026, 8)).isOverridden, false);

  // ── 이 달부터 (applyMode='from') ──
  await budgets.updateBudget(base.id, uid, {
    monthlyAmount: '400000',
    applyMode: 'from',
    applyFromMonth: '2026-09',
  });
  ctx.check('이 달부터: 8월은 옛 금액', await diningAmount(2026, 8), 300000);
  ctx.check('이 달부터: 9월은 새 금액', await diningAmount(2026, 9), 400000);
  ctx.check('이 달부터: 10월도 새 금액', await diningAmount(2026, 10), 400000);

  const augAfterSplit = await diningRow(2026, 8);
  ctx.check('이 달부터: 옛 규칙은 8월까지', augAfterSplit.effectiveTo, '2026-08');
  ctx.check('이 달부터: 새 규칙은 9월부터', (await diningRow(2026, 9)).effectiveFrom, '2026-09');

  // 같은 달로 또 나누려 하면 막는다 (@@unique 위반이 그대로 새지 않는지)
  await ctx.expectReject('같은 달로 두 번 나눌 수 없다', () =>
    budgets.updateBudget(base.id, uid, {
      monthlyAmount: '450000',
      applyMode: 'from',
      applyFromMonth: '2026-09',
    }),
  );
  ctx.check('막힌 뒤에도 8월 금액 그대로', await diningAmount(2026, 8), 300000);

  // ── 모든 달 (applyMode 생략 = 'all') ──
  await budgets.updateBudget(base.id, uid, { monthlyAmount: '350000' });
  ctx.check('모든 달: 8월만 바뀐다 (그 규칙이 덮는 범위)', await diningAmount(2026, 8), 350000);
  ctx.check('모든 달: 9월은 다른 규칙이라 그대로', await diningAmount(2026, 9), 400000);

  // ── 전체 초기화 ──
  // 지울 것이 조정값까지 함께 사라지는지 보려고 다시 하나 씌워 둔다.
  const septRow = await diningRow(2026, 9);
  await budgets.createOverride(uid, {
    budgetId: septRow.budgetId,
    year: 2026,
    month: 9,
    amount: '999000',
  });
  await budgets.createBudget(
    uid,
    { categoryId: housing.id, type: 'expense', monthlyAmount: '200000' },
    pid,
  );

  // 거래는 예산과 무관하게 남아야 한다
  await entries.createEntry(
    uid,
    {
      kind: 'expense',
      personId: chulsoo.id,
      date: new Date(Date.UTC(2026, 7, 10)).toISOString(),
      description: '점심',
      amount: '20000',
      categoryId: dining.id,
      accountId: bank.id,
    },
    pid,
  );

  const beforeReset = await ctx.prisma.budget.count({ where: { projectId: pid } });
  ctx.check('초기화 전 규칙 수 (외식 2 + 공과금 1)', beforeReset, 3);
  ctx.check(
    '초기화 전 조정값 수',
    await ctx.prisma.budgetOverride.count({ where: { budget: { projectId: pid } } }),
    1,
  );

  const { deleted } = await budgets.resetBudgets(uid, pid);
  ctx.check('초기화: 지운 개수를 돌려준다', deleted, 3);
  ctx.check('초기화: 규칙이 없다', await ctx.prisma.budget.count({ where: { projectId: pid } }), 0);
  ctx.check(
    '초기화: 조정값도 함께 사라진다 (cascade)',
    await ctx.prisma.budgetOverride.count({ where: { budget: { projectId: pid } } }),
    0,
  );
  ctx.check('초기화: 예산 금액은 0으로 조회된다', await diningAmount(2026, 9), 0);
  ctx.check(
    '초기화: 사용금액(거래)은 남는다',
    Number((await diningRow(2026, 8)).usedAmount ?? 0),
    20000,
  );

  const emptyReset = await budgets.resetBudgets(uid, pid);
  ctx.check('초기화: 두 번째는 0개', emptyReset.deleted, 0);
});
