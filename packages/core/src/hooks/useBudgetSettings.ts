import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BudgetDto, TagDto } from '@money/types';

import { homeDataPort } from '../data/home-port';
import {
  BUDGET_TOTAL_TARGET,
  budgetSettingRows,
  parseTagBudgetTarget,
  tagBudgetSettingRows,
  type BudgetTargetId,
} from '../lib/budget';
import { mergeTargetLabel } from '../lib/category-tree';
import { useTranslation } from '../lib/i18n';
import type { Category } from '../lib/types';
import { useBudgetEditor } from './useBudgetEditor';
import { useMirrorVersion } from './useMirrorVersion';

/**
 * 예산 설정 화면 (홈의 예산 상자 → 톱니). 웹과 앱이 같은 훅을 쓴다.
 *
 * 합계·대분류·소분류를 분류 화면의 차례로, 그 아래 태그를 태그 화면의 차례로 늘어놓는다.
 * 줄을 누르면 가계 화면과 같은 예산 팝업이 열린다. 예산액은 프로젝트 단위 값이라 자산주인
 * 필터를 싣지 않는다.
 *
 * 창구(homeDataPort)로 읽는다. 앱은 끊긴 동안에도 사본에서 목록을 그린다.
 */
export function useBudgetSettings({
  projectId,
  yearMonth,
  type,
}: {
  projectId: string | null;
  /** 보고 있는 달 "YYYY-MM" */
  yearMonth: string;
  type: 'income' | 'expense';
}) {
  const { t } = useTranslation();
  /* 다른 기기에서 예산을 고치면 오른다. 이것 없이는 내가 고칠 때만 다시 읽는다. */
  const mirrorVersion = useMirrorVersion();
  const [budgets, setBudgets] = useState<BudgetDto.MonthlyBudget[]>([]);
  const [tagBudgets, setTagBudgets] = useState<BudgetDto.MonthlyTagBudget[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<TagDto.Response[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  /** 팝업에서 저장하면 올린다. */
  const [version, setVersion] = useState(0);

  const [year, month] = yearMonth.split('-').map(Number);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    setIsLoading(true);
    setHasError(false);
    const port = homeDataPort();
    Promise.all([
      port.getBudgetForMonth(year, month, projectId),
      port.getTagBudgetsForMonth(year, month, projectId),
      port.getCategories(projectId),
      port.getTags(projectId),
    ])
      .then(([budgetRows, tagBudgetRows, categoryRows, tagRows]) => {
        if (cancelled) return;
        setBudgets(budgetRows ?? []);
        setTagBudgets(tagBudgetRows ?? []);
        setCategories(categoryRows ?? []);
        setTags(tagRows ?? []);
      })
      .catch((error: unknown) => {
        console.error('예산 설정 조회 실패:', error);
        if (!cancelled) setHasError(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, year, month, version, mirrorVersion]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);

  /* 팝업은 분류 줄과 태그 줄을 한 목록에서 찾는다 (budgetTargetOf 가 둘을 가른다). */
  const editableBudgets = useMemo(() => [...budgets, ...tagBudgets], [budgets, tagBudgets]);

  const editor = useBudgetEditor({
    projectId,
    yearMonth,
    budgets: editableBudgets,
    categories,
    onSaved: reload,
  });

  const rows = useMemo(
    () => budgetSettingRows(budgets, categories, type, t('budget.total')),
    [budgets, categories, type, t],
  );
  const tagRows = useMemo(
    () => tagBudgetSettingRows(tagBudgets, tags, type),
    [tagBudgets, tags, type],
  );

  /**
   * 팝업 제목에 적을 이름. 소분류는 "식비 > 외식"처럼 대분류를 앞에 붙인다 -- 팝업에는
   * 목록의 들여쓰기가 없어 "외식"만으로는 어느 대분류의 것인지 알 수 없다. 태그는 "여행 태그"다
   * -- 같은 이름의 분류가 있을 수 있다.
   */
  const nameOf = (id: BudgetTargetId): string => {
    if (id === BUDGET_TOTAL_TARGET.expense) return t('ledger.totalExpense');
    if (id === BUDGET_TOTAL_TARGET.income) return t('ledger.totalIncome');
    const tagTarget = parseTagBudgetTarget(id);
    if (tagTarget) {
      const tag = tags.find((row) => row.id === tagTarget.tagId);
      return tag ? t('budget.tagTarget', { name: tag.name }) : '';
    }
    const category = categories.find((row) => row.id === id);
    return category ? mergeTargetLabel(categories, category) : '';
  };

  return { rows, tagRows, isLoading, hasError, editor, nameOf };
}
