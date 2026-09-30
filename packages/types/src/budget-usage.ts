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
import { type CategoryPostingRow, selectedAmount } from './report-aggregation';

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
 */
export function categoryUsage(
  rows: readonly CategoryPostingRow[],
  categories: readonly CategoryNode[],
): Map<string, CategoryUsage> {
  const known = new Set(categories.map((category) => category.id));

  const own = new Map<string, CategoryUsage>();
  for (const row of rows) {
    if (!known.has(row.categoryId)) continue;

    const amount = selectedAmount(row);

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

/** 태그 사용액을 셀 때 다리가 더 실어 오는 것. */
export interface TaggedPostingRow extends CategoryPostingRow {
  /**
   * 이 줄에 붙은 태그. 전표의 태그 중 줄 키가 이 다리와 같은 것만이다.
   *
   * 분할 거래는 줄마다 태그가 다르다. 전표의 태그를 통째로 보면 "여행" 태그를 붙인 식비
   * 줄 하나 때문에 같은 거래의 교통 줄까지 여행 예산에 들어간다.
   */
  tagIds: readonly string[];
}

/**
 * 태그별 사용액. 열쇠는 태그 id 이고 값은 **지출 − 수입**이다.
 *
 * 태그 예산은 지출·수입으로 가르지 않는다. "여행"에 30만원을 쓰고 5만원을 정산받았으면
 * 그 여행에 든 돈은 25만원이다. 한 줄에 태그가 둘이면 두 태그에 모두 든다 -- 태그는
 * 겹쳐 붙이는 표지라 분류처럼 하나로 나뉘지 않는다. 금액을 고르는 규칙은 분류 사용액과
 * 같다(`selectedAmount`).
 */
export function tagUsage(rows: readonly TaggedPostingRow[]): Map<string, CategoryUsage> {
  const usage = new Map<string, CategoryUsage>();
  for (const row of rows) {
    const amount = selectedAmount(row);
    const signed = row.categoryType === 'income' ? amount.negated() : amount;
    for (const tagId of new Set(row.tagIds)) {
      const bucket = usage.get(tagId) ?? { amount: Dec.of(0), count: 0 };
      bucket.amount = bucket.amount.plus(signed);
      bucket.count += 1;
      usage.set(tagId, bucket);
    }
  }
  return usage;
}

/**
 * 전체 예산의 센티널 categoryId 를 푼다.
 *
 * 전체 예산은 분류가 없는 예산이라 categoryId 로 가리킬 수 없다. 화면은 대신 약속된
 * 문자열을 보내고, 받는 쪽이 그것을 "분류 없음 + type" 으로 바꾼다. 서버와 기기 사본이
 * 같은 규칙으로 풀어야 해서 여기 둔다 -- 사본이 풀지 않으면 오프라인에서 만든 전체 예산이
 * 분류 id 자리에 센티널을 단 채 적혀, 동기화 전까지 어디에도 보이지 않는다.
 */
export function resolveBudgetTarget(
  categoryId?: string | null,
  type?: string | null,
): { categoryId?: string; type?: 'income' | 'expense' } {
  if (categoryId === 'BUDGET_TOTAL_INCOME') return { categoryId: undefined, type: 'income' };
  if (categoryId === 'BUDGET_TOTAL_EXPENSE') return { categoryId: undefined, type: 'expense' };
  return {
    categoryId: categoryId ?? undefined,
    type: type === 'income' || type === 'expense' ? type : undefined,
  };
}

/** 월별 예산 목록이 보는 규칙 한 줄. */
export interface ScheduleRule extends BudgetPeriod {
  id: string;
  monthlyAmount: DecInput;
}

/** 그 달만 다른 금액. (규칙, 년, 월)이 키다. */
export interface ScheduleOverride {
  id: string;
  budgetId: string;
  year: number;
  month: number;
  amount: DecInput;
}

/**
 * 한 대상(분류·전체·태그 예산 하나)의 규칙들을 달마다 푼다. 예산 팝업의 월별 목록이 쓴다.
 *
 * 예산은 규칙 하나가 여러 달을 덮고 거기에 달별 조정이 얹힌다. 그 달에 걸리는 규칙이
 * 없으면 rule 이 없다 -- 0원이 아니라 "예산 없음"이다. 서버와 기기 사본이 같은 판정으로
 * 풀어야 해서 여기 둔다 (적용 기간 판정은 isBudgetApplicable).
 */
export function budgetScheduleMonths<R extends ScheduleRule, O extends ScheduleOverride>(
  rules: readonly R[],
  overrides: readonly O[],
  startMonth: string,
  months: number,
): Array<{ yearMonth: string; rule?: R; override?: O }> {
  const keyOf = (budgetId: string, year: number, month: number) => `${budgetId}:${year}-${month}`;
  const overrideOf = new Map(
    overrides.map((override) => [keyOf(override.budgetId, override.year, override.month), override]),
  );
  const [startYear, startMonthNumber] = startMonth.split('-').map(Number);

  return Array.from({ length: months }, (_, offset) => {
    const index = startMonthNumber - 1 + offset;
    const year = startYear + Math.floor(index / 12);
    const month = (index % 12) + 1;
    const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
    const rule = rules.find((candidate) => isBudgetApplicable(candidate, yearMonth));
    if (!rule) return { yearMonth };
    return { yearMonth, rule, override: overrideOf.get(keyOf(rule.id, year, month)) };
  });
}

/**
 * "고른 달부터"가 그 대상의 규칙들에 하는 일. 서버(`BudgetsService`)와 기기 사본이 같이 쓴다.
 *
 *   remove  그 달 이후에 시작하는 규칙 -- 통째로 없앤다
 *   cut     그 달에 걸쳐 있는 규칙 -- 앞 달까지로 끊는다 (effectiveTo)
 *
 * 그 달 앞에서 이미 끝난 규칙은 건드리지 않는다 (effectiveTo 를 뒤로 밀면 없애려던 규칙이
 * 오히려 늘어난다). 그 달부터의 달별 조정은 부르는 쪽이 따로 지운다 -- 끊기는 규칙의 조정이
 * 남아 있다가 나중에 그 규칙을 다시 늘리면 되살아난다.
 */
export function planBudgetFrom(
  rules: ReadonlyArray<{ id: string; effectiveFrom?: string | null; effectiveTo?: string | null }>,
  applyFrom: string,
): { remove: string[]; cut: Array<{ id: string; effectiveTo: string }> } {
  const [year, month] = applyFrom.split('-').map(Number);
  const before = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;

  const remove: string[] = [];
  const cut: Array<{ id: string; effectiveTo: string }> = [];
  for (const rule of rules) {
    if ((rule.effectiveFrom || BUDGET_MONTH_FLOOR) >= applyFrom) {
      remove.push(rule.id);
      continue;
    }
    if ((rule.effectiveTo || BUDGET_MONTH_CEILING) >= applyFrom) {
      cut.push({ id: rule.id, effectiveTo: before });
    }
  }
  return { remove, cut };
}

/** 그 달부터의 조정인가. (규칙, 년, 월)의 년·월을 "YYYY-MM" 과 견준다. */
export function isOverrideFrom(override: { year: number; month: number }, applyFrom: string): boolean {
  const [year, month] = applyFrom.split('-').map(Number);
  return override.year > year || (override.year === year && override.month >= month);
}
