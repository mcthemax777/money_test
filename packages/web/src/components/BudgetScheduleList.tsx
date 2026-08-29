'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BudgetDto } from '@money/types';
import { apiClient } from '@/lib/api-client';
import { formatCurrency, formatNumber, toAmountString, toNumber } from '@/lib/money';
import { useProjectDisplayCurrency } from '@/store/project';
import { formatYearMonth, shiftYearMonth } from '@/lib/datetime';
import { useTranslation } from '@/lib/i18n';
import { useApiError } from '@/lib/api-error';

/** 한 번에 보여 주는 달 수. 1년이면 "지금 어떻게 세팅돼 있나"를 훑기에 충분하다. */
const WINDOW_MONTHS = 12;

interface BudgetScheduleListProps {
  projectId: string | null;
  /**
   * 분류 예산이면 분류 id, 전체 예산이면 'BUDGET_TOTAL_INCOME' /
   * 'BUDGET_TOTAL_EXPENSE'. 예산을 만들 때 쓰는 값과 같다.
   */
  categoryId: string;
  type: 'income' | 'expense';
  /** 목록이 시작하는 달 "YYYY-MM". 보통 화면이 보고 있는 달이다. */
  startMonth: string;
  /**
   * 바깥에서 예산을 저장했을 때 올라오는 값. 목록을 다시 읽는다.
   *
   * 위쪽 폼이 규칙 자체를 바꾸면 이 목록의 여러 달이 한꺼번에 달라지므로
   * 이 컴포넌트만 따로 두면 옛 금액이 남는다.
   */
  reloadToken: number;
  /** 이 목록에서 달별 금액을 고쳤을 때. 바깥 화면도 합계를 다시 읽어야 한다. */
  onChange: () => void | Promise<void>;
}

/**
 * 한 분류의 월별 예산 목록.
 *
 * 예산은 규칙 하나가 여러 달을 덮고 거기에 달별 조정이 얹히는 구조라, 금액 칸
 * 하나만 보아서는 "다른 달은 얼마인지"를 알 수 없었다. 달을 늘어놓고 그 자리에서
 * 고칠 수 있게 한다.
 *
 * 여기서 고치는 것은 언제나 그 달 하나뿐이다(BudgetOverride). 여러 달을 한꺼번에
 * 바꾸는 일은 위쪽 폼의 "적용 범위"가 맡는다. 한 화면에서 두 가지가 같은 입력을
 * 쓰면 어느 쪽이 걸릴지 알 수 없다.
 */
export default function BudgetScheduleList({
  projectId,
  categoryId,
  type,
  startMonth,
  reloadToken,
  onChange,
}: BudgetScheduleListProps) {
  const { t } = useTranslation();
  const { messageOf } = useApiError();
  const displayCurrency = useProjectDisplayCurrency();
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
          { categoryId, type, startMonth: windowStart, months: WINDOW_MONTHS },
          projectId,
        ),
      );
    } catch {
      setMonths([]);
      setError(t('schedule.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [projectId, categoryId, type, windowStart]);

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
      await apiClient.createBudgetOverride({
        budgetId: row.budgetId,
        year,
        month,
        amount: toAmountString(amount),
      });
      cancelEdit();
      await load();
      await onChange();
    } catch (err: any) {
      setError(messageOf(err, 'budget.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  /** 그 달에 씌운 조정을 걷어낸다. 규칙 금액으로 돌아간다. */
  const clearMonth = async (row: BudgetDto.ScheduleMonth) => {
    if (!row.overrideId) return;
    try {
      setIsSaving(true);
      setError('');
      await apiClient.deleteBudgetOverride(row.overrideId);
      await load();
      await onChange();
    } catch (err: any) {
      setError(messageOf(err, 'schedule.resetFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const windowEnd = shiftYearMonth(windowStart, WINDOW_MONTHS - 1);

  return (
    <div className="border-t border-gray-200 pt-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700">{t('schedule.title')}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setWindowStart(shiftYearMonth(windowStart, -WINDOW_MONTHS))}
            className="px-2 py-1 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
          >
            {t('schedule.prev')}
          </button>
          <span className="px-1 text-xs text-gray-500 tabular-nums">
            {windowStart} ~ {windowEnd}
          </span>
          <button
            type="button"
            onClick={() => setWindowStart(shiftYearMonth(windowStart, WINDOW_MONTHS))}
            className="px-2 py-1 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
          >
            {t('schedule.next')}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-2 p-2 bg-red-50 border border-red-200 text-red-600 rounded text-xs">
          {error}
        </div>
      )}

      {isLoading ? (
        <p className="py-6 text-center text-sm text-gray-500">{t('feed.loadingMore')}</p>
      ) : (
        /* 12줄이면 팝업 안에서 스크롤이 생긴다. 목록만 따로 스크롤한다. */
        <div className="max-h-64 overflow-y-auto divide-y divide-gray-100">
          {months.map((row) => {
            const [year, month] = row.yearMonth.split('-').map(Number);
            const isEditing = editingMonth === row.yearMonth;
            /* 규칙이 안 걸치는 달. 조정은 규칙에 붙는 값이라 고칠 수가 없다. */
            const hasRule = Boolean(row.budgetId);

            return (
              <div key={row.yearMonth} className="flex items-center gap-2 py-1.5 text-sm">
                <span className="w-24 shrink-0 text-gray-600 tabular-nums">
                  {formatYearMonth(year, month)}
                </span>

                {isEditing ? (
                  <>
                    <input
                      type="number"
                      min="0"
                      autoFocus
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      onKeyDown={(e) => {
                        // Enter로 저장, Esc로 취소. 금액 한 칸을 고치는 자리에서
                        // 마우스로 버튼을 찾아 누르게 하면 열두 달이 고통스럽다.
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          saveMonth(row);
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          cancelEdit();
                        }
                      }}
                      className="flex-1 min-w-0 px-2 py-1 border border-gray-300 rounded text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => saveMonth(row)}
                      disabled={isSaving}
                      aria-label={t('schedule.saveLabel', { month: formatYearMonth(year, month) })}
                      className="shrink-0 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      {t('common.save')}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      disabled={isSaving}
                      aria-label={t('schedule.cancelLabel', { month: formatYearMonth(year, month) })}
                      className="shrink-0 px-2 py-1 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                    >
                      {t('common.cancel')}
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-right tabular-nums text-gray-900">
                      {hasRule ? formatCurrency(row.amount, displayCurrency) : t('schedule.noBudget')}
                    </span>

                    {/* 규칙 금액과 다른 달. 원래 얼마였는지 함께 보여 준다. */}
                    {row.isOverridden && (
                      <span className="shrink-0 text-xs text-amber-700">
                        {t('schedule.adjusted', { amount: formatNumber(row.ruleAmount) })}
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => startEdit(row)}
                      disabled={!hasRule || isSaving}
                      aria-label={t('schedule.editLabel', { month: formatYearMonth(year, month) })}
                      title={hasRule ? undefined : t('schedule.noRule')}
                      className="shrink-0 px-2 py-1 text-xs text-blue-600 hover:underline disabled:text-gray-300 disabled:no-underline disabled:cursor-not-allowed"
                    >
                      {t('schedule.edit')}
                    </button>

                    {row.isOverridden && (
                      <button
                        type="button"
                        onClick={() => clearMonth(row)}
                        disabled={isSaving}
                        aria-label={t('schedule.revertLabel', { month: formatYearMonth(year, month) })}
                        className="shrink-0 px-2 py-1 text-xs text-gray-500 hover:underline disabled:opacity-50"
                      >
                        {t('schedule.revert')}
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-2 text-xs text-gray-500">
        {t('schedule.hint')}
      </p>
    </div>
  );
}
