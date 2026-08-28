'use client';

import type { BudgetDto } from '@money/types';

import { budgetPercentage } from '@/lib/budget';
import { formatCurrency, toNumber } from '@/lib/money';
import { useProjectDisplayCurrency } from '@/store/project';

/** 전체 지출 줄. 분류 예산과 달리 categoryId가 없다. */
function isTotalExpense(budget: BudgetDto.MonthlyBudget): boolean {
  return !budget.categoryId && budget.categoryType === 'expense';
}

/**
 * 이 달의 총 사용금액과 예산을 잡아 둔 분류들의 진행률.
 *
 * 가계 화면의 분류별 목록과 같은 모양으로 적는다. 두 화면이 같은 숫자를 다른
 * 모양으로 보여 주면 같은 값인지 매번 확인하게 된다.
 *
 * 예산이 없는 분류는 적지 않는다. 홈은 훑어보는 화면이라 분류를 전부 늘어놓으면
 * 정작 넘긴 예산이 묻힌다. 분류 전체는 가계 화면의 분류별 탭에서 본다.
 */
export default function MonthlyBudgetSummary({
  budgets,
}: {
  budgets: BudgetDto.MonthlyBudget[];
}) {
  const displayCurrency = useProjectDisplayCurrency();

  const total = budgets.find(isTotalExpense);
  const totalUsed = toNumber(total?.usedAmount);
  const totalBudget = toNumber(total?.monthlyAmount);

  // 예산을 잡아 둔 지출 분류만. 많이 쓴 순으로 본다.
  const rows = budgets
    .filter(
      (budget) =>
        budget.categoryId && budget.categoryType === 'expense' && toNumber(budget.monthlyAmount) > 0,
    )
    .sort((a, b) => toNumber(b.usedAmount) - toNumber(a.usedAmount));

  /** 전체 사용액에서 이 분류가 차지하는 몫. 분류별 목록과 같은 표기다. */
  const shareOfTotal = (amount: number) => (totalUsed > 0 ? (amount / totalUsed) * 100 : 0);

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="mb-3 px-3 py-2">
        <div className="flex justify-between items-baseline">
          <span className="text-sm text-gray-600">합계</span>
          <span className="text-lg font-bold text-gray-900">
            {formatCurrency(totalUsed, displayCurrency)}
          </span>
        </div>
        <BudgetLine budget={totalBudget} used={totalUsed} currency={displayCurrency} />
      </div>

      {rows.length === 0 ? (
        <p className="px-3 text-sm text-gray-600">
          예산을 잡은 분류가 없습니다. 가계 화면의 분류별에서 예산을 정할 수 있습니다.
        </p>
      ) : (
        <div className="space-y-1">
          {rows.map((budget) => {
            const used = toNumber(budget.usedAmount);
            return (
              <div key={budget.budgetId} className="px-3 py-2 rounded-lg">
                <div className="flex justify-between items-baseline gap-2">
                  <span className="text-sm text-gray-800 truncate">
                    {budget.categoryName}
                    <span className="ml-1 text-xs text-gray-500">
                      ({shareOfTotal(used).toFixed(0)}%)
                    </span>
                  </span>
                  <span
                    className={`text-sm font-semibold shrink-0 ${
                      used > 0 ? 'text-gray-900' : 'text-gray-400'
                    }`}
                  >
                    {formatCurrency(used, displayCurrency)}
                  </span>
                </div>
                <BudgetLine
                  budget={toNumber(budget.monthlyAmount)}
                  used={used}
                  currency={displayCurrency}
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
 * 예산 진행률 한 줄. 가계 분류별 목록의 것과 같은 모양이다.
 *
 * 예산이 없으면 그리지 않는다. 넘긴 예산은 빨강으로 바꿔 한눈에 갈라 보이게 한다.
 */
function BudgetLine({
  budget,
  used,
  currency,
}: {
  budget: number;
  used: number;
  currency: string;
}) {
  if (budget <= 0) return null;

  const percent = budgetPercentage(budget, used);
  const over = used > budget;

  return (
    <div className="mt-1 flex items-center gap-2">
      <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${over ? 'bg-red-500' : 'bg-blue-400'}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <span className={`text-xs shrink-0 ${over ? 'text-red-600' : 'text-gray-500'}`}>
        예산 {formatCurrency(budget, currency)} · {percent}%
        {over
          ? ` · ${formatCurrency(used - budget, currency)} 초과`
          : ` · ${formatCurrency(budget - used, currency)} 남음`}
      </span>
    </div>
  );
}
