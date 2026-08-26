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

  // 같은 달로 다시 넣으면 그 달부터의 금액을 바꾼다 (@@unique 위반이 새지 않는지)
  await budgets.updateBudget(base.id, uid, {
    monthlyAmount: '450000',
    applyMode: 'from',
    applyFromMonth: '2026-09',
  });
  ctx.check('같은 달로 다시: 9월 금액이 바뀐다', await diningAmount(2026, 9), 450000);
  ctx.check('같은 달로 다시: 8월은 그대로', await diningAmount(2026, 8), 300000);
  ctx.check(
    '같은 달로 다시: 규칙이 늘지 않는다',
    await ctx.prisma.budget.count({ where: { projectId: pid, categoryId: dining.id } }),
    2,
  );

  // 아래 검사가 9월 40만원을 전제하므로 되돌려 둔다.
  await budgets.updateBudget(base.id, uid, {
    monthlyAmount: '400000',
    applyMode: 'from',
    applyFromMonth: '2026-09',
  });

  // ── 모든 달 (applyMode 생략 = 'all') ──
  await budgets.updateBudget(base.id, uid, { monthlyAmount: '350000' });
  ctx.check('모든 달: 8월만 바뀐다 (그 규칙이 덮는 범위)', await diningAmount(2026, 8), 350000);
  ctx.check('모든 달: 9월은 다른 규칙이라 그대로', await diningAmount(2026, 9), 400000);

  // ── 앞 달부터 다시 바꾸면 뒤 규칙까지 걷힌다 ──
  /*
   * "8월부터 100만원"은 끝이 없는 말이다. 9월부터 40만원짜리 규칙이 남아 있으면
   * 8월만 100만원이 되고 9월부터 옛 금액이 되살아난다.
   */
  await budgets.updateBudget(base.id, uid, {
    monthlyAmount: '1000000',
    applyMode: 'from',
    applyFromMonth: '2026-08',
  });
  ctx.check('앞 달부터 다시: 8월', await diningAmount(2026, 8), 1000000);
  ctx.check('앞 달부터 다시: 9월도 함께 바뀐다', await diningAmount(2026, 9), 1000000);
  ctx.check('앞 달부터 다시: 한참 뒤 2030-12도', await diningAmount(2030, 12), 1000000);
  ctx.check('앞 달부터 다시: 7월은 옛 금액', await diningAmount(2026, 7), 350000);
  ctx.check(
    '앞 달부터 다시: 규칙은 둘 (7월까지 + 8월부터)',
    await ctx.prisma.budget.count({ where: { projectId: pid, categoryId: dining.id } }),
    2,
  );

  // ── 지나간 달부터도 고칠 수 있다 ──
  await budgets.updateBudget((await diningRow(2026, 8)).budgetId, uid, {
    monthlyAmount: '700000',
    applyMode: 'from',
    applyFromMonth: '2026-06',
  });
  ctx.check('지나간 달부터: 6월', await diningAmount(2026, 6), 700000);
  ctx.check('지나간 달부터: 7월도 덮인다', await diningAmount(2026, 7), 700000);
  ctx.check('지나간 달부터: 9월도 덮인다', await diningAmount(2026, 9), 700000);
  ctx.check('지나간 달부터: 5월은 옛 금액 그대로', await diningAmount(2026, 5), 350000);

  // ── 여러 달을 한꺼번에 바꾸면 그 달만 잡아 둔 값도 지운다 ──
  /*
   * 8월부터 2000원으로 바꿨는데 10월만 옛 조정값으로 남으면, 손댄 적 없는 금액이
   * 그 달에만 튀어 보인다. 구간을 새로 정하는 것이므로 조정도 함께 지운다.
   *
   * 지금 상태: 2026-05까지 한 규칙, 2026-06부터 다른 규칙.
   */
  await budgets.createOverride(uid, {
    budgetId: (await diningRow(2026, 4)).budgetId,
    year: 2026,
    month: 4,
    amount: '111000',
  });
  await budgets.createOverride(uid, {
    budgetId: (await diningRow(2026, 10)).budgetId,
    year: 2026,
    month: 10,
    amount: '123000',
  });
  ctx.check('조정 준비: 4월', await diningAmount(2026, 4), 111000);
  ctx.check('조정 준비: 10월', await diningAmount(2026, 10), 123000);

  // (1) 그 달부터 바꾸기: 그 달 이후의 조정값만 지운다
  await budgets.updateBudget((await diningRow(2026, 10)).budgetId, uid, {
    monthlyAmount: '800000',
    applyMode: 'from',
    applyFromMonth: '2026-06',
  });
  ctx.check('그 달부터: 10월 조정값이 지워진다', await diningAmount(2026, 10), 800000);
  ctx.check('그 달부터: 조정 표시도 꺼진다', (await diningRow(2026, 10)).isOverridden, false);
  ctx.check('그 달부터: 앞 달 조정값은 남는다', await diningAmount(2026, 4), 111000);

  // (2) 모든 달 바꾸기: 그 규칙에 달린 조정값을 전부 지운다
  await budgets.updateBudget((await diningRow(2026, 4)).budgetId, uid, {
    monthlyAmount: '360000',
  });
  ctx.check('모든 달: 4월 조정값이 지워진다', await diningAmount(2026, 4), 360000);
  ctx.check('모든 달: 3월도 같은 금액', await diningAmount(2026, 3), 360000);
  ctx.check('모든 달: 다른 규칙이 덮는 달은 그대로', await diningAmount(2026, 10), 800000);
  ctx.check(
    '모든 달: 조정값이 남지 않는다',
    await ctx.prisma.budgetOverride.count({ where: { budget: { projectId: pid } } }),
    0,
  );

  // 아래 검사들이 "8월까지 / 9월부터"로 나뉜 상태를 전제한다. 그 모양으로 되돌린다.
  await ctx.prisma.budget.deleteMany({ where: { projectId: pid, categoryId: dining.id } });
  const restored = await budgets.createBudget(
    uid,
    { categoryId: dining.id, type: 'expense', monthlyAmount: '350000' },
    pid,
  );
  await budgets.updateBudget(restored.id, uid, {
    monthlyAmount: '400000',
    applyMode: 'from',
    applyFromMonth: '2026-09',
  });
  ctx.check('되돌리기: 8월 350000', await diningAmount(2026, 8), 350000);
  ctx.check('되돌리기: 9월 400000', await diningAmount(2026, 9), 400000);

  // ── 그 달부터 예산 없애기 (deleteBudget + fromMonth) ──
  // 0원짜리 규칙을 남기지 않는다. 0원 예산과 "예산 없음"은 화면에서 다르게 보인다.
  const septBudgetId = (await diningRow(2026, 9)).budgetId;
  await budgets.deleteBudget(septBudgetId, uid, '2026-11');
  ctx.check('그 달부터 없애기: 9월은 그대로', await diningAmount(2026, 9), 400000);
  ctx.check('그 달부터 없애기: 10월도 그대로', await diningAmount(2026, 10), 400000);
  ctx.check('그 달부터 없애기: 11월은 예산 없음', await diningAmount(2026, 11), 0);
  ctx.check('그 달부터 없애기: 규칙은 10월까지', (await diningRow(2026, 10)).effectiveTo, '2026-10');

  // 이미 그 달 앞에서 끝난 규칙은 건드리지 않는다. effectiveTo가 뒤로 밀리면
  // 없애려던 규칙이 오히려 늘어난다.
  await budgets.deleteBudget(septBudgetId, uid, '2026-12');
  ctx.check(
    '이미 끝난 규칙: 적용 끝이 밀리지 않는다',
    (await diningRow(2026, 10)).effectiveTo,
    '2026-10',
  );

  // 시작 달부터 없애라면 남는 달이 없다. 죽은 규칙을 남기지 않고 통째로 지운다.
  await budgets.deleteBudget(septBudgetId, uid, '2026-09');
  ctx.check('시작 달부터 없애기: 9월도 예산 없음', await diningAmount(2026, 9), 0);
  ctx.check('시작 달부터 없애기: 8월은 그대로', await diningAmount(2026, 8), 350000);
  ctx.check(
    '시작 달부터 없애기: 규칙이 지워졌다',
    await ctx.prisma.budget.count({ where: { projectId: pid, categoryId: dining.id } }),
    1,
  );

  // 아래 초기화 검사가 외식 규칙 두 개를 전제하므로 9월 규칙을 되돌려 둔다.
  await budgets.updateBudget(restored.id, uid, {
    monthlyAmount: '400000',
    applyMode: 'from',
    applyFromMonth: '2026-09',
  });
  ctx.check('되돌리기: 9월 규칙이 다시 생겼다', await diningAmount(2026, 9), 400000);

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
