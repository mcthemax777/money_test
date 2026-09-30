import type { CategoryDto } from '@money/types';

import { groupCategories } from './category-tree';
import { toNumber } from './money';

/**
 * 예산 진행률.
 *
 * 예전에는 이 계산이 대시보드 JSX에 다섯 번 복붙되어 있었다.
 * 그중 하나에서 금액이 문자열로 들어와 `"3000" > "10000"`이 true가 되는 바람에
 * 사용액이 예산보다 적은데도 101%로 표시됐다. 계산을 한 곳으로 모아 그런 차이를 없앤다.
 *
 * 초과했으면 최소 101%를 돌려준다. 막대가 꽉 찬 100%와 초과를 눈으로 구분하기 위함이다.
 */
export function budgetPercentage(monthlyAmount: number, usedAmount: number): number {
  const budget = Number(monthlyAmount) || 0;
  const used = Number(usedAmount) || 0;

  if (budget <= 0) return 0;

  const ratio = Math.floor((used / budget) * 100);
  return used > budget ? Math.max(101, ratio) : ratio;
}

/*
 * ===== 예산 설정 =====
 *
 * 홈의 예산 상자 → 예산 설정 화면 → 분류 하나를 눌러 여는 예산 팝업. 가계 화면의 분류별
 * 상세도 같은 팝업을 쓴다. 웹과 앱이 이 아래를 함께 쓴다.
 */

/**
 * 합계 예산을 가리키는 화면 쪽 이름. 분류 예산은 분류 id 를 그대로 쓴다.
 *
 * 합계는 분류가 없는 예산이라 id 가 없다. 서버에 만들 때는 따로 센티널 값을 보낸다
 * (`budgetTargetOf` 의 apiCategoryId).
 */
export const BUDGET_TOTAL_TARGET = {
  expense: 'total-expense',
  income: 'total-income',
} as const;

/** 합계(`BUDGET_TOTAL_TARGET`), 분류 id, 또는 태그 예산(`tagBudgetTargetId`). */
export type BudgetTargetId = string;

/**
 * 태그 예산을 가리키는 화면 쪽 이름. 태그 하나에 지출·수입 예산이 따로 서므로 유형을 함께 싣는다.
 *
 * 분류 id 와 부딪히지 않게 앞에 `tag:` 를 붙인다 (분류 id 는 cuid·UUID 라 콜론이 없다).
 */
export function tagBudgetTargetId(tagId: string, type: 'income' | 'expense'): BudgetTargetId {
  return `tag:${type}:${tagId}`;
}

/** 태그 예산 이름이면 그 태그와 유형. 아니면 null. */
export function parseTagBudgetTarget(
  targetId: BudgetTargetId,
): { tagId: string; type: 'income' | 'expense' } | null {
  const match = /^tag:(income|expense):(.+)$/.exec(targetId);
  return match ? { type: match[1] as 'income' | 'expense', tagId: match[2] } : null;
}

/**
 * 예산 팝업이 읽는 예산 줄의 모양.
 *
 * 서버 응답(`BudgetDto.MonthlyBudget`, 금액이 문자열)과 예산 스토어의 줄(숫자로 바꾼 것)이
 * 모두 들어온다. 둘 다 이 모양을 채운다.
 */
export interface EditableBudgetRow {
  budgetId: string;
  categoryId?: string;
  /** 태그 예산의 줄만 가진다 (`BudgetDto.MonthlyTagBudget`). */
  tagId?: string;
  categoryName?: string;
  categoryType?: 'income' | 'expense';
  /** 예산 스토어의 줄만 가진다. 합계 줄의 유형을 여기에 적는 응답이 있어 함께 본다. */
  type?: 'income' | 'expense';
  parentCategoryId?: string;
  monthlyAmount: number | string;
  ruleAmount?: number | string;
  isOverridden?: boolean;
}

/** 서버가 목록을 채우려고 넣은 줄. 저장된 예산이 아니다. */
export function isPlaceholderBudget(row: { budgetId: string }): boolean {
  return row.budgetId.startsWith('placeholder-');
}

/**
 * 팝업이 고칠 대상을 예산 API 의 모양으로 바꾼다.
 *
 * `existing` 은 저장된 규칙이다. 없으면 새로 만든다. 분류를 찾지 못하면(지워진 분류)
 * 유형은 지출로 둔다 -- 그 경우 저장은 서버가 막는다.
 *
 * `budgets` 에는 분류 예산 줄과 태그 예산 줄이 함께 와도 된다. 태그 줄도 분류가 없어,
 * 합계를 찾을 때 태그 줄을 빼야 한다.
 */
export function budgetTargetOf(
  targetId: BudgetTargetId,
  budgets: readonly EditableBudgetRow[],
  categories: readonly { id: string; type: 'income' | 'expense' }[],
): {
  type: 'income' | 'expense';
  /** 분류 예산·합계의 서버 쪽 이름. 태그 예산이면 없다. */
  apiCategoryId?: string;
  /** 태그 예산이면 그 태그 */
  tagId?: string;
  existing?: EditableBudgetRow;
} {
  const tagTarget = parseTagBudgetTarget(targetId);
  if (tagTarget) {
    const found = budgets.find(
      (row) =>
        row.tagId === tagTarget.tagId &&
        (row.type === tagTarget.type || row.categoryType === tagTarget.type),
    );
    return {
      type: tagTarget.type,
      tagId: tagTarget.tagId,
      existing: found && !isPlaceholderBudget(found) ? found : undefined,
    };
  }

  const totalType =
    targetId === BUDGET_TOTAL_TARGET.income
      ? 'income'
      : targetId === BUDGET_TOTAL_TARGET.expense
        ? 'expense'
        : null;
  const type = totalType ?? categories.find((c) => c.id === targetId)?.type ?? 'expense';

  const found = budgets.find((row) =>
    totalType
      ? !row.categoryId && !row.tagId && (row.type === type || row.categoryType === type)
      : row.categoryId === targetId,
  );

  return {
    type,
    apiCategoryId: totalType
      ? totalType === 'income'
        ? 'BUDGET_TOTAL_INCOME'
        : 'BUDGET_TOTAL_EXPENSE'
      : targetId,
    existing: found && !isPlaceholderBudget(found) ? found : undefined,
  };
}

/** 예산 설정 화면의 한 줄. */
export interface BudgetSettingRow {
  id: BudgetTargetId;
  name: string;
  /** 합계 / 대분류 / 소분류 / 태그. 화면이 들여쓰기와 굵기를 이 값으로 정한다. */
  level: 'total' | 'main' | 'sub' | 'tag';
  /** 태그의 색. 태그 줄에만 있고, 정하지 않은 태그는 없다. */
  color?: string;
  /** 이 달에 적용되는 금액. 조정이 있으면 조정값이다. 예산이 없으면 0. */
  amount: number;
  /** 저장된 예산이 있는지. 0원과 "정하지 않음"을 가른다. */
  isSet: boolean;
  /** 이 달만 조정한 금액인지 */
  isOverridden: boolean;
}

/**
 * 예산 설정 화면의 줄들. 합계가 맨 위, 그 아래 대분류와 딸린 소분류.
 *
 * **차례는 분류 화면에서 정한 순서다.** 예산 응답은 그 달에 많이 쓴 순이라 달을 옮길 때마다
 * 줄이 뒤섞인다. 설정하는 자리는 찾는 자리여서 차례가 늘 같아야 한다.
 *
 * 예산이 없는 분류도 모두 적는다. 여기가 예산을 새로 잡는 자리다.
 */
export function budgetSettingRows(
  budgets: readonly EditableBudgetRow[],
  categories: readonly CategoryDto.Response[],
  type: 'income' | 'expense',
  totalName: string,
): BudgetSettingRow[] {
  const rowOf = (
    id: BudgetTargetId,
    name: string,
    level: BudgetSettingRow['level'],
  ): BudgetSettingRow => {
    const { existing } = budgetTargetOf(id, budgets, categories);
    return {
      id,
      name,
      level,
      amount: toNumber(existing?.monthlyAmount),
      isSet: Boolean(existing),
      isOverridden: Boolean(existing?.isOverridden),
    };
  };

  const rows = [rowOf(BUDGET_TOTAL_TARGET[type], totalName, 'total')];
  for (const group of groupCategories(categories.filter((c) => c.type === type))) {
    if (group.parent) rows.push(rowOf(group.parent.id, group.parent.name, 'main'));
    for (const child of group.children) rows.push(rowOf(child.id, child.name, 'sub'));
  }
  return rows;
}

/**
 * 예산 설정 화면의 태그 줄들. 태그 화면에서 정한 차례이고, 예산이 없는 태그도 모두 적는다.
 *
 * 태그에는 유형이 없어 같은 태그가 지출 탭과 수입 탭에 모두 선다. 두 탭의 예산은 따로다.
 */
export function tagBudgetSettingRows(
  tagBudgets: readonly EditableBudgetRow[],
  tags: readonly { id: string; name: string; color?: string | null }[],
  type: 'income' | 'expense',
): BudgetSettingRow[] {
  return tags.map((tag) => {
    const id = tagBudgetTargetId(tag.id, type);
    const { existing } = budgetTargetOf(id, tagBudgets, []);
    return {
      id,
      name: tag.name,
      level: 'tag',
      ...(tag.color ? { color: tag.color } : {}),
      amount: toNumber(existing?.monthlyAmount),
      isSet: Boolean(existing),
      isOverridden: Boolean(existing?.isOverridden),
    };
  });
}

/** 예산 설정 화면의 주소. 웹과 앱이 같은 문자열을 쓴다. */
export const BUDGET_SETTINGS_PATH = '/home/budgets';

/**
 * 홈에서 예산 설정으로 넘어가는 주소. 보고 있던 달과 지출·수입을 싣는다.
 *
 * 홈에서 9월 수입을 보다 넘어갔는데 이번 달 지출이 열리면, 무엇을 고치러 왔는지 다시 찾아야 한다.
 */
export function budgetSettingsHref(yearMonth: string, type: 'income' | 'expense'): string {
  return `${BUDGET_SETTINGS_PATH}?month=${yearMonth}&type=${type}`;
}

/**
 * 주소에 실린 달과 유형. 없거나 모양이 틀리면 기본값(이번 달, 지출)이다.
 *
 * `get` 은 웹의 URLSearchParams.get 과 같은 모양이다.
 */
export function parseBudgetSettingsQuery(
  get: (key: string) => string | null,
  fallbackYearMonth: string,
): { yearMonth: string; type: 'income' | 'expense' } {
  const month = get('month');
  return {
    yearMonth: month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : fallbackYearMonth,
    type: get('type') === 'income' ? 'income' : 'expense',
  };
}
