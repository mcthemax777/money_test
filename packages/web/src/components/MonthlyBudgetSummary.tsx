'use client';

import type { BudgetDto } from '@money/types';

import { budgetPercentage } from '@/lib/budget';
import { useTranslation } from '@/lib/i18n';
import { formatCurrency, toNumber } from '@/lib/money';
import { useProjectDisplayCurrency } from '@/store/project';

/**
 * 이 달의 총 사용금액과 예산을 잡아 둔 분류들의 진행률.
 *
 * 가계 화면의 분류별 목록과 같은 모양으로 적는다. 두 화면이 같은 숫자를 다른
 * 모양으로 보여 주면 같은 값인지 매번 확인하게 된다.
 *
 * 예산이 없는 분류는 적지 않는다. 홈은 훑어보는 화면이라 분류를 전부 늘어놓으면
 * 정작 넘긴 예산이 묻힌다. 분류 전체는 가계 화면의 분류별 탭에서 본다.
 *
 * 수입도 같은 모양으로 본다. 수입 예산은 "이만큼 벌자"는 목표라 넘긴 것이 좋은
 * 일이므로, 넘겼을 때 빨갛게 물들이지 않는다.
 */
export default function MonthlyBudgetSummary({
  budgets,
  type,
}: {
  budgets: BudgetDto.MonthlyBudget[];
  /** 지출 예산을 볼지 수입 목표를 볼지 */
  type: 'income' | 'expense';
}) {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();

  /** 전체 줄. 분류 예산과 달리 categoryId가 없다. */
  const total = budgets.find(
    (budget) => !budget.categoryId && budget.categoryType === type,
  );
  const totalUsed = toNumber(total?.usedAmount);
  const totalBudget = toNumber(total?.monthlyAmount);

  // 예산을 잡아 둔 분류만. 많이 쓴(번) 순으로 본다.
  const rows = budgets
    .filter(
      (budget) =>
        budget.categoryId && budget.categoryType === type && toNumber(budget.monthlyAmount) > 0,
    )
    .sort((a, b) => toNumber(b.usedAmount) - toNumber(a.usedAmount));

  /*
   * 분류 이름. 소분류는 "대분류 > 소분류"로 적는다.
   *
   * 소분류 이름은 대분류 밑에서만 뜻이 통한다. "커피"만 적혀 있으면 식비의 커피인지
   * 간식의 커피인지 알 수 없다. 가계 화면은 대분류 줄 아래 들여써서 그것을 보여
   * 주지만, 여기는 예산을 잡은 분류만 골라 늘어놓아 대분류 줄이 없을 수 있다.
   *
   * 응답에는 예산이 없는 분류도 한 줄씩 들어 있어 대분류 이름을 여기서 찾는다.
   */
  const nameById = new Map(
    budgets.flatMap((budget) =>
      budget.categoryId && budget.categoryName ? [[budget.categoryId, budget.categoryName]] : [],
    ),
  );
  const nameOf = (budget: BudgetDto.MonthlyBudget): string => {
    const own = budget.categoryName ?? '';
    if (!budget.parentCategoryId) return own;
    // 대분류를 못 찾으면 소분류 이름만 적는다. 이름이 비는 것보다는 낫다.
    const parent = nameById.get(budget.parentCategoryId);
    return parent ? `${parent} > ${own}` : own;
  };

  return (
    /*
      안쪽 여백은 위 통계 그래프 카드와 같은 p-4다. 줄마다 px-3을 더 주면 글자가
      그래프 제목보다 안쪽에서 시작해, 나란히 놓인 두 칸의 왼쪽 선이 어긋난다.
    */
    <div className="bg-white rounded-lg shadow p-4">
      {/* 옆의 통계 그래프들과 같은 자리에 같은 모양으로 제목을 단다. */}
      <h3 className="mb-3 font-semibold text-gray-900">
        {type === 'income' ? t('budget.title.income') : t('budget.title.expense')}
      </h3>

      {/*
        합계는 전체 예산을 잡아 두었을 때만 적는다.

        예산이 없으면 진행률 줄이 그려지지 않아 사용액 한 줄만 남는데, 그 숫자는
        바로 위 탭이 이미 적고 있다. 같은 값을 두 번 적으면 다른 값인지 매번
        확인하게 된다.
      */}
      {totalBudget > 0 && (
        <div className="mb-3 py-2">
          <div className="flex justify-between items-baseline">
            <span className="text-sm text-gray-600">{t('budget.total')}</span>
            <UsedOfBudget used={totalUsed} budget={totalBudget} currency={displayCurrency} />
          </div>
          <BudgetLine
            budget={totalBudget}
            used={totalUsed}
            currency={displayCurrency}
            type={type}
          />
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-gray-600">
          {type === 'income' ? t('budget.none.income') : t('budget.none.expense')}
        </p>
      ) : (
        <div className="space-y-1">
          {rows.map((budget) => {
            const used = toNumber(budget.usedAmount);
            return (
              <div key={budget.budgetId} className="py-2">
                <div className="flex justify-between items-baseline gap-2">
                  <span className="text-sm text-gray-800 truncate">{nameOf(budget)}</span>
                  <UsedOfBudget
                    used={used}
                    budget={toNumber(budget.monthlyAmount)}
                    currency={displayCurrency}
                  />
                </div>
                <BudgetLine
                  budget={toNumber(budget.monthlyAmount)}
                  used={used}
                  currency={displayCurrency}
                  type={type}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * "쓴 금액 / 잡아 둔 금액".
 *
 * 쓴 금액만 적으면 그 액수가 큰지 작은지 알 수 없다. 아래 진행률 줄이 예산액을
 * 적고 있었지만, 눈이 금액을 먼저 잡으므로 두 수를 한자리에 붙여 둔다. 예산액은
 * 견주는 기준일 뿐이라 옅게 물러선다.
 */
function UsedOfBudget({
  used,
  budget,
  currency,
}: {
  used: number;
  budget: number;
  currency: string;
}) {
  return (
    <span className="shrink-0 tabular-nums">
      {/* 합계도 분류와 같은 크기다. 합계만 키우면 줄마다 글자 크기가 달라 목록이 고르지 않다. */}
      <span
        className={`text-sm font-semibold ${used > 0 ? 'text-gray-900' : 'text-gray-400'}`}
      >
        {formatCurrency(used, currency)}
      </span>
      <span className="text-sm text-gray-500"> / {formatCurrency(budget, currency)}</span>
    </span>
  );
}

/**
 * 예산 진행률 한 줄. 가계 분류별 목록의 것과 같은 모양이다.
 *
 * 예산이 없으면 그리지 않는다. 넘긴 지출 예산은 빨강으로 바꿔 한눈에 갈라 보이게
 * 한다. 수입은 목표를 넘긴 것이 잘된 일이라 빨강을 쓰지 않는다.
 */
function BudgetLine({
  budget,
  used,
  currency,
  type,
}: {
  budget: number;
  used: number;
  currency: string;
  type: 'income' | 'expense';
}) {
  // 훅은 이른 반환보다 앞이어야 한다. 조건에 따라 부르면 순서가 어긋난다.
  const { t } = useTranslation();

  if (budget <= 0) return null;

  const percent = budgetPercentage(budget, used);
  const over = used > budget;
  const warn = type === 'expense' && over;

  return (
    <div className="mt-1 flex items-center gap-2">
      <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${warn ? 'bg-red-500' : 'bg-blue-400'}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      {/* 예산액은 위 "쓴 금액 / 예산액"이 이미 적는다. 여기서는 진행만 말한다. */}
      <span className={`text-xs shrink-0 ${warn ? 'text-red-600' : 'text-gray-500'}`}>
        {percent}%
        {' · '}
        {over
          ? t('budget.over', { amount: formatCurrency(used - budget, currency) })
          : t('budget.left', { amount: formatCurrency(budget - used, currency) })}
      </span>
    </div>
  );
}
