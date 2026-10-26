/**
 * 홈 창구의 예산 쪽. 그 달의 분류·태그 예산과 한 대상의 월별 예산이다.
 */

import {
  type BudgetDto,
  Dec,
  categoryUsage,
  budgetScheduleMonths,
  isBudgetApplicable,
  resolveBudgetTarget,
  tagUsage,
  totalUsage,
  zonedParts,
} from '@money/types';

import type { HomeDataPort } from './home-port';
import type { HomeContext } from './local-home-context';
import { ownerFilterOf, requireProject, timeZoneOf } from './local-home-query';

export function budgetReads(
  ctx: HomeContext,
): Pick<
  HomeDataPort,
  | 'getBudgetForMonth'
  | 'getBudgetSchedule'
  | 'getTagBudgetsForMonth'
> {
  const { store, note, converter, monthPostings } = ctx;

  return {
    async getBudgetForMonth(year, month, projectId, filter) {
      const id = requireProject(projectId);
      note('budgets');

      const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
      const [rows, categories, budgets, show] = await Promise.all([
        /*
         * **회차 기준으로 센다.** 서버와 같은 규칙이다 -- 예산은 "이 달에 이만큼까지
         * 쓴다"는 약속이라, 24개월 할부를 산 달에 전액으로 세면 그 달 하나가 통째로
         * 터지고 남은 달에는 실제로 나가는 돈이 진행률에 잡히지 않는다.
         */
        monthPostings(id, { yearMonth }, { ...ownerFilterOf(filter), basis: 'installment' }),
        store.categories(id),
        store.budgets(id, year, month),
        converter(id),
      ]);

      const usage = categoryUsage(rows, categories);
      // 태그 예산은 따로 센다(getTagBudgetsForMonth). 섞이면 분류 없는 줄이라 전체 예산을 덮는다.
      const applicable = budgets.filter(
        (budget) => !budget.tagId && isBudgetApplicable(budget, yearMonth),
      );
      const byCategory = new Map(applicable.filter((b) => b.categoryId).map((b) => [b.categoryId!, b]));
      const byType = new Map(applicable.filter((b) => !b.categoryId && b.type).map((b) => [b.type!, b]));
      const names = await store.categoryRows(id);
      const nameOf = new Map(names.map((row) => [row.id, row]));
      const hasChildren = new Set(names.map((row) => row.parentId).filter(Boolean) as string[]);

      const rowOf = (
        budget: (typeof applicable)[number] | undefined,
        categoryId: string | undefined,
        categoryType: 'income' | 'expense',
        usedAmount: Dec,
      ): BudgetDto.MonthlyBudget => {
        const category = categoryId ? nameOf.get(categoryId) : undefined;
        const amount = budget?.overrideAmount ?? budget?.monthlyAmount ?? '0';

        return {
          budgetId: budget?.id ?? `placeholder-${categoryId ?? `total-${categoryType}`}`,
          categoryId,
          categoryName: category?.name ?? (categoryType === 'expense' ? '전체 지출' : '전체 수입'),
          categoryType,
          parentCategoryId: category?.parentId ?? undefined,
          monthlyAmount: show.toString(Dec.of(amount)),
          ruleAmount: show.toString(Dec.of(budget?.monthlyAmount ?? '0')),
          usedAmount: show.toString(usedAmount),
          isOverridden: Boolean(budget?.overrideAmount),
          overrideId: budget?.overrideId ?? undefined,
          effectiveFrom: budget?.effectiveFrom ?? undefined,
          effectiveTo: budget?.effectiveTo ?? undefined,
          hasChildren: categoryId ? hasChildren.has(categoryId) : hasChildren.size > 0,
        };
      };

      const result: BudgetDto.MonthlyBudget[] = [];
      for (const type of ['expense', 'income'] as const) {
        result.push(rowOf(byType.get(type), undefined, type, totalUsage(usage, categories, type)));
      }
      for (const category of names) {
        result.push(
          rowOf(
            byCategory.get(category.id),
            category.id,
            category.type as 'income' | 'expense',
            usage.get(category.id)?.amount ?? Dec.of(0),
          ),
        );
      }
      return result;
    },

    /**
     * 한 대상의 월별 예산. 서버의 getBudgetSchedule 과 같은 규칙이다 -- 대상 고르기는
     * resolveBudgetTarget, 달마다 푸는 일은 budgetScheduleMonths 로 두 곳이 같은 함수를 쓴다.
     */
    async getBudgetSchedule(query, projectId) {
      const id = requireProject(projectId);
      note('budgets');

      const timeZone = await timeZoneOf(store, id);
      const now = zonedParts(new Date(), timeZone);
      const startMonth =
        query.startMonth ?? `${now.year}-${String(now.month).padStart(2, '0')}`;
      const months = Math.min(Math.max(Number(query.months) || 12, 1), 60);

      const tagId = query.tagId || null;
      const target = resolveBudgetTarget(query.categoryId, query.type);
      const { rules, overrides } = await store.budgetRules(id);
      const picked = rules.filter(
        (rule) =>
          rule.categoryId === (target.categoryId ?? null) &&
          rule.tagId === tagId &&
          // 태그 예산은 유형을 보지 않는다 (서버와 같은 규칙).
          (tagId || !target.type || rule.type === target.type),
      );
      const ids = new Set(picked.map((rule) => rule.id));

      const show = await converter(id);
      return budgetScheduleMonths(
        picked,
        overrides.filter((override) => ids.has(override.budgetId)),
        startMonth,
        months,
      ).map(({ yearMonth, rule, override }): BudgetDto.ScheduleMonth =>
        rule
          ? {
              yearMonth,
              amount: show.toString(Dec.of(override?.amount ?? rule.monthlyAmount)),
              ruleAmount: show.toString(Dec.of(rule.monthlyAmount)),
              budgetId: rule.id,
              overrideId: override?.id,
              isOverridden: Boolean(override),
              effectiveFrom: rule.effectiveFrom ?? undefined,
              effectiveTo: rule.effectiveTo ?? undefined,
            }
          : { yearMonth, isOverridden: false },
      );
    },

    /** 태그 예산. 서버의 getTagBudgetsForMonth 와 같은 규칙이다 (그 주석을 볼 것). */
    async getTagBudgetsForMonth(year, month, projectId, filter) {
      const id = requireProject(projectId);
      note('budgets');

      const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
      const [rows, tags, budgets, show] = await Promise.all([
        // 분류 예산과 같이 회차 기준으로 센다.
        monthPostings(id, { yearMonth }, { ...ownerFilterOf(filter), basis: 'installment' }),
        store.tagRows(id),
        store.budgets(id, year, month),
        converter(id),
      ]);

      const usage = tagUsage(rows.map((row) => ({ ...row, tagIds: row.tagIds ?? [] })));
      const byTag = new Map(
        budgets
          .filter((budget) => budget.tagId && isBudgetApplicable(budget, yearMonth))
          .map((budget) => [budget.tagId!, budget]),
      );

      return tags.map((tag): BudgetDto.MonthlyTagBudget => {
        const budget = byTag.get(tag.id);
        const amount = budget?.overrideAmount ?? budget?.monthlyAmount ?? '0';
        return {
          budgetId: budget?.id ?? `placeholder-tag-${tag.id}`,
          tagId: tag.id,
          tagName: tag.name,
          tagColor: tag.color ?? undefined,
          monthlyAmount: show.toString(Dec.of(amount)),
          ruleAmount: show.toString(Dec.of(budget?.monthlyAmount ?? '0')),
          usedAmount: show.toString(usage.get(tag.id)?.amount ?? Dec.of(0)),
          isOverridden: Boolean(budget?.overrideAmount),
          overrideId: budget?.overrideId ?? undefined,
          effectiveFrom: budget?.effectiveFrom ?? undefined,
          effectiveTo: budget?.effectiveTo ?? undefined,
        };
      });
    },
  };
}
