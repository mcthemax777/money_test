import { useState } from 'react';

import { useApiError } from '../lib/api-error';
import { useTranslation } from '../lib/i18n';
import {
  budgetTargetOf,
  type BudgetTargetId,
  type EditableBudgetRow,
} from '../lib/budget';
import type { Category } from '../lib/types';
import { toAmountString, toNumber } from '../lib/money';
import { useBudget } from '../store/budget';
import { settingsWritePort } from '../data/settings-write-port';

/** 여러 달을 한꺼번에 바꾸는 두 가지 방법. 'all' 은 규칙의 금액을, 'from' 은 고른 달부터를 바꾼다. */
export type BudgetScope = 'all' | 'from';

/**
 * 예산 팝업 하나의 상태와 저장.
 *
 * 가계 화면의 분류별 상세와 홈의 예산 설정 화면이 같은 팝업을 띄운다. 웹과 앱도 같다.
 * 저장 규칙(0원은 지우기, '고른 달부터'는 서버가 뒤의 규칙까지 걷어내기)이 한 벌이어야
 * 자리마다 다른 결과가 나지 않으므로 여기 한 곳에 둔다. 화면은 모양만 그린다.
 */
export function useBudgetEditor({
  projectId,
  yearMonth,
  budgets,
  categories,
  onSaved,
}: {
  projectId: string | null;
  /** 보고 있는 달 "YYYY-MM". 새 예산과 '고른 달부터'의 기준이다. */
  yearMonth: string;
  /** 그 달의 예산 줄들. 분류 예산과 태그 예산을 함께 넘긴다. 고칠 규칙을 여기서 찾는다. */
  budgets: readonly EditableBudgetRow[];
  categories: readonly Category[];
  /** 규칙이 바뀐 뒤. 화면의 예산 목록을 다시 읽는다. */
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const { messageOf } = useApiError();
  const createBudget = useBudget((state) => state.createBudget);
  const updateBudget = useBudget((state) => state.updateBudget);
  const deleteBudget = useBudget((state) => state.deleteBudget);

  /** 고치고 있는 대상. null 이면 팝업이 닫혀 있다. */
  const [targetId, setTargetId] = useState<BudgetTargetId | null>(null);
  const [amount, setAmount] = useState(0);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  /*
   * 범위는 열 때마다 되돌리지 않는다. '고른 달부터'로 저장하고 확인하러 다시 연 사용자가
   * '모든 달'이 골라진 창을 보고 0을 넣으면 예산이 통째로 사라진다.
   */
  const [scope, setScope] = useState<BudgetScope>('all');
  /**
   * '고른 달부터'의 시작 달. 보고 있는 달로 가두지 않는다 -- 8월을 보면서 "10월부터
   * 줄인다"를 넣는 일이 흔하다.
   */
  const [fromMonth, setFromMonth] = useState('');
  /** 규칙을 바꾸면 올린다. 팝업 안 월별 목록이 이 값을 보고 다시 읽는다. */
  const [scheduleToken, setScheduleToken] = useState(0);

  const target = targetId ? budgetTargetOf(targetId, budgets, categories) : null;

  /**
   * 저장 단추가 지우기 단추가 되는 경우. 0원은 "예산을 두지 않는다"는 뜻이다.
   *
   * 0원짜리 규칙을 남기지 않는 까닭: 0원 예산은 한 푼만 써도 초과로 붉게 떠 "예산 없음"과
   * 다르게 보인다. 특정 한 달만 0원으로 두는 것은 월별 목록에서 한다.
   */
  const isDeleting = amount === 0 && Boolean(target?.existing);

  const open = (id: BudgetTargetId) => {
    const found = budgetTargetOf(id, budgets, categories);
    /*
     * 이 팝업은 "여러 달을 한꺼번에" 바꾸는 자리라, 이 달만 조정돼 있어도 규칙 금액을
     * 채운다. 조정값을 채우면 그대로 저장했을 뿐인데 다른 달까지 그 금액이 된다.
     */
    setAmount(toNumber(found.existing?.ruleAmount ?? found.existing?.monthlyAmount));
    setFromMonth(yearMonth);
    setError('');
    setTargetId(id);
  };

  const close = () => setTargetId(null);

  /** 규칙이 바뀐 뒤. 바깥 목록과 팝업 안 월별 목록을 함께 다시 읽는다. */
  const reload = async () => {
    await onSaved();
    setScheduleToken((token) => token + 1);
  };

  const submit = async () => {
    if (!projectId || !target) return;
    setError('');

    if (amount < 0) {
      setError(t('budget.negative'));
      return;
    }

    const { existing } = target;
    // 아직 규칙이 없으면 0은 지울 것이 없다는 뜻이다.
    if (!existing && amount === 0) {
      setError(t('budget.noneToDelete'));
      return;
    }
    if (existing && scope === 'from' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(fromMonth)) {
      setError(t('budget.pickMonth'));
      return;
    }

    const monthlyAmount = toAmountString(amount);
    try {
      setIsSubmitting(true);

      if (!existing) {
        await createBudget({
          projectId,
          categoryId: target.apiCategoryId,
          tagId: target.tagId,
          type: target.type,
          monthlyAmount,
          // 예산이 기간별로 나뉘어 있을 때 서버가 어느 규칙을 고칠지 이 값으로 정한다.
          yearMonth,
        });
      } else if (scope === 'from') {
        /*
         * '고른 달부터' -- 0원이면 그 달부터 예산을 없애고, 아니면 그 금액으로 만든다.
         * 대상과 달로 보낸다(창구의 setBudgetFrom): 규칙 id 로 보내면 끊긴 동안 쪼개지거나
         * 사라진 규칙을 가리킨다. 이미 그 달부터 시작하는 규칙이어도 그대로 보낸다 -- 뒤에
         * 나뉜 규칙까지 걷어내야 한다. 'all' 경로로 새면 그 뒤는 옛 금액이 남는다.
         */
        await settingsWritePort().setBudgetFrom({
          budgetId: existing.budgetId,
          categoryId: target.apiCategoryId ?? null,
          tagId: target.tagId ?? null,
          type: target.type ?? null,
          fromMonth,
          amount: amount === 0 ? null : monthlyAmount,
        });
      } else if (amount === 0) {
        // '모든 달'의 0원은 규칙을 지운다.
        await deleteBudget(existing.budgetId);
      } else {
        await updateBudget(existing.budgetId, { monthlyAmount });
      }

      await reload();
      setTargetId(null);
    } catch (err) {
      setError(messageOf(err, 'budget.saveFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    isOpen: targetId !== null,
    targetId,
    /** 고치고 있는 대상. 합계면 apiCategoryId 가 서버의 센티널 값이다. */
    target,
    open,
    close,
    amount,
    setAmount,
    scope,
    setScope,
    fromMonth,
    setFromMonth,
    error,
    isSubmitting,
    isDeleting,
    submit,
    /** 월별 목록에서 한 달을 고친 뒤 부른다. */
    reload,
    scheduleToken,
  };
}

export type BudgetEditor = ReturnType<typeof useBudgetEditor>;
