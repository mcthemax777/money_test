import { useCallback, useEffect, useState } from 'react';
import type { BudgetDto } from '@money/types';

import { apiClient } from '../lib/api-client';
import { useApiError } from '../lib/api-error';
import { shiftYearMonth } from '../lib/datetime';
import { useTranslation } from '../lib/i18n';
import { toAmountString, toNumber } from '../lib/money';
import { settingsWritePort } from '../data/settings-write-port';

/** 한 번에 보여 주는 달 수. 1년이면 "지금 어떻게 세팅돼 있나"를 훑기에 충분하다. */
export const BUDGET_SCHEDULE_MONTHS = 12;

/**
 * 한 분류의 월별 예산 목록. 예산 팝업 아래에 붙는다 (웹·앱 같은 로직).
 *
 * 예산은 규칙 하나가 여러 달을 덮고 거기에 달별 조정이 얹히는 구조라, 금액 칸 하나만
 * 보아서는 "다른 달은 얼마인지"를 알 수 없다. 달을 늘어놓고 그 자리에서 고친다.
 *
 * 여기서 고치는 것은 언제나 그 달 하나뿐이다(BudgetOverride). 여러 달을 한꺼번에 바꾸는
 * 일은 위쪽 폼의 "적용 범위"가 맡는다.
 */
export function useBudgetSchedule({
  projectId,
  categoryId,
  tagId,
  type,
  startMonth,
  reloadToken,
  onChange,
}: {
  projectId: string | null;
  /** 분류 예산이면 분류 id, 합계면 'BUDGET_TOTAL_INCOME' / 'BUDGET_TOTAL_EXPENSE'. */
  categoryId?: string;
  /** 태그 예산이면 그 태그. 이때 categoryId 는 없다. */
  tagId?: string;
  /** 합계·분류 예산의 지출·수입. 태그 예산은 가르지 않아 없다. */
  type?: 'income' | 'expense';
  /** 목록이 시작하는 달 "YYYY-MM". 보통 화면이 보고 있는 달이다. */
  startMonth: string;
  /** 바깥 폼이 규칙을 바꾸면 올라온다. 여러 달이 한꺼번에 달라지므로 다시 읽는다. */
  reloadToken: number;
  /** 이 목록에서 한 달을 고쳤을 때. 바깥 화면도 합계를 다시 읽어야 한다. */
  onChange: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const { messageOf } = useApiError();
  const [windowStart, setWindowStart] = useState(startMonth);
  const [months, setMonths] = useState<BudgetDto.ScheduleMonth[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  /** 지금 고치고 있는 달. null이면 아무 줄도 편집 중이 아니다. */
  const [editingMonth, setEditingMonth] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // 보고 있는 달이 바뀌면 목록도 그 달에서 다시 시작한다.
  useEffect(() => {
    setWindowStart(startMonth);
  }, [startMonth]);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setIsLoading(true);
      setError('');
      setMonths(
        await apiClient.getBudgetSchedule(
          { categoryId, tagId, type, startMonth: windowStart, months: BUDGET_SCHEDULE_MONTHS },
          projectId,
        ),
      );
    } catch {
      setMonths([]);
      setError(t('schedule.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [projectId, categoryId, tagId, type, windowStart, t]);

  useEffect(() => {
    load();
  }, [load, reloadToken]);

  const startEdit = (row: BudgetDto.ScheduleMonth) => {
    setEditingMonth(row.yearMonth);
    setEditingValue(String(toNumber(row.amount)));
    setError('');
  };

  const cancelEdit = () => {
    setEditingMonth(null);
    setEditingValue('');
  };

  /** 고친 금액을 그 달에만 씌운다. */
  const saveMonth = async (row: BudgetDto.ScheduleMonth) => {
    if (!row.budgetId) return;

    const amount = toNumber(editingValue);
    if (amount < 0) {
      setError(t('budget.negative'));
      return;
    }

    const [year, month] = row.yearMonth.split('-').map(Number);
    try {
      setIsSaving(true);
      setError('');
      /*
       * 창구를 거친다. 그 달 하나에만 씌우는 조정이라 행 하나를 고치는 조작이고,
       * 명령으로 실어 보낼 수 있다 ('고른 달부터' 편집과 갈리는 자리다).
       */
      await settingsWritePort().setBudgetOverride({
        budgetId: row.budgetId,
        year,
        month,
        amount: toAmountString(amount),
      });
      cancelEdit();
      await load();
      await onChange();
    } catch (err) {
      setError(messageOf(err, 'budget.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  /** 그 달에 씌운 조정을 걷어낸다. 규칙 금액으로 돌아간다. */
  const clearMonth = async (row: BudgetDto.ScheduleMonth) => {
    if (!row.overrideId) return;
    const [year, month] = row.yearMonth.split('-').map(Number);
    try {
      setIsSaving(true);
      setError('');
      // 금액을 비우는 것이 "그 달의 조정을 걷어낸다"다.
      await settingsWritePort().setBudgetOverride({
        id: row.overrideId,
        budgetId: row.budgetId ?? '',
        year,
        month,
        amount: null,
      });
      await load();
      await onChange();
    } catch (err) {
      setError(messageOf(err, 'schedule.resetFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  return {
    months,
    isLoading,
    error,
    windowStart,
    windowEnd: shiftYearMonth(windowStart, BUDGET_SCHEDULE_MONTHS - 1),
    showPrev: () => setWindowStart(shiftYearMonth(windowStart, -BUDGET_SCHEDULE_MONTHS)),
    showNext: () => setWindowStart(shiftYearMonth(windowStart, BUDGET_SCHEDULE_MONTHS)),
    editingMonth,
    editingValue,
    setEditingValue,
    isSaving,
    startEdit,
    cancelEdit,
    saveMonth,
    clearMonth,
  };
}
