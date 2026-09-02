/**
 * 예산 사용액 규칙.
 *
 * 진행률의 분모(예산액)와 분자(사용액)를 정하는 규칙이다. 홈 화면이 이 값을 쓰므로
 * 오프라인에서도 기기가 스스로 내야 한다.
 *
 * 사용액은 리포트의 합계와 같은 규칙을 쓴다. 두 값이 어긋나면 같은 화면에서
 * "8월 지출 24만"과 "예산 사용 21만"이 나란히 보이게 된다. 그래서 금액을 고르는
 * 방식(`selectedAmount`)을 report-aggregation 에서 그대로 가져온다.
 */

import { Dec, type DecInput } from './decimal';
import type { CategoryType } from './entities';
import { type CategoryPostingRow, type ExtraSelection, selectedAmount } from './report-aggregation';

/** 예산 규칙이 적용되는 달의 하한과 상한. 비어 있으면 무기한이라는 뜻이다. */
export const BUDGET_MONTH_FLOOR = '2000-01';
export const BUDGET_MONTH_CEILING = '9999-12';

/** 적용 기간을 판단하는 데 필요한 만큼의 예산 규칙. */
export interface BudgetPeriod {
  /** "YYYY-MM". null 이면 처음부터. */
  effectiveFrom?: string | null;
  /** "YYYY-MM". null 이면 끝없이. */
  effectiveTo?: string | null;
}

/** 그 달에 이 규칙이 적용되는가. 양끝을 포함한다. */
export function isBudgetApplicable(budget: BudgetPeriod, yearMonth: string): boolean {
  const from = budget.effectiveFrom || BUDGET_MONTH_FLOOR;
  const to = budget.effectiveTo || BUDGET_MONTH_CEILING;
  return yearMonth >= from && yearMonth <= to;
}

/** 사용액을 롤업할 때 필요한 만큼의 카테고리. */
export interface CategoryNode {
  id: string;
  type: CategoryType;
  parentId?: string | null;
}

export interface CategoryUsage {
  /** 그 카테고리 자신과 소분류를 합한 금액 */
  amount: Dec;
  /** 같은 범위의 다리 수. 목록 정렬에 쓴다. */
  count: number;
}

/**
 * 카테고리별 사용액.
 *
 * 대분류 사용액은 자신 + 소분류의 합이다. posting 은 가장 구체적인 카테고리 하나만
 * 가리키므로 대분류 금액은 이렇게 만들어야 한다.
 *
 * 일반/과소비를 고르면 그 몫만 더한다. 셀 몫이 없는 다리는 건수에서도 뺀다.
 * 그러지 않으면 "0원인데 3건"이 된다.
 */
export function categoryUsage(
  rows: readonly CategoryPostingRow[],
  categories: readonly CategoryNode[],
  extra: ExtraSelection = undefined,
): Map<string, CategoryUsage> {
  const known = new Set(categories.map((category) => category.id));

  const own = new Map<string, CategoryUsage>();
  for (const row of rows) {
    if (!known.has(row.categoryId)) continue;

    const amount = selectedAmount(row, extra);
    if (extra !== undefined && !amount.isPositive()) continue;

    const bucket = own.get(row.categoryId) ?? { amount: Dec.of(0), count: 0 };
    bucket.amount = bucket.amount.plus(amount);
    bucket.count += 1;
    own.set(row.categoryId, bucket);
  }

  const childrenByParent = new Map<string, CategoryNode[]>();
  for (const category of categories) {
    if (!category.parentId) continue;
    const list = childrenByParent.get(category.parentId) ?? [];
    list.push(category);
    childrenByParent.set(category.parentId, list);
  }

  const rolled = new Map<string, CategoryUsage>();
  for (const category of categories) {
    const self = own.get(category.id);
    let amount = self?.amount ?? Dec.of(0);
    let count = self?.count ?? 0;

    for (const child of childrenByParent.get(category.id) ?? []) {
      const childUsage = own.get(child.id);
      if (!childUsage) continue;
      amount = amount.plus(childUsage.amount);
      count += childUsage.count;
    }

    rolled.set(category.id, { amount, count });
  }

  return rolled;
}

/**
 * 그 유형의 전체 사용액.
 *
 * 대분류 사용액만 더한다. 소분류는 이미 대분류에 롤업되어 있어 함께 더하면 두 번 센다.
 */
export function totalUsage(
  usage: Map<string, CategoryUsage>,
  categories: readonly CategoryNode[],
  type: CategoryType,
): Dec {
  return Dec.sum(
    categories
      .filter((category) => !category.parentId && category.type === type)
      .map((category) => usage.get(category.id)?.amount ?? Dec.of(0)),
  );
}
