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

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-4">
      <div>
        <p className="text-sm text-gray-600">총 사용금액</p>
        <p className="mt-1 text-3xl font-bold text-gray-900 tabular-nums">
          {formatCurrency(totalUsed, displayCurrency)}
        </p>
        {totalBudget > 0 && (
          <BudgetBar used={totalUsed} budget={totalBudget} className="mt-2" />
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-600">
          예산을 잡은 분류가 없습니다. 가계 화면의 분류별에서 예산을 정할 수 있습니다.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((budget) => {
            const used = toNumber(budget.usedAmount);
            const amount = toNumber(budget.monthlyAmount);
            return (
              <li key={budget.budgetId}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate text-gray-900">{budget.categoryName}</span>
                  <span className="shrink-0 tabular-nums text-gray-600">
                    {formatCurrency(used, displayCurrency)} /{' '}
                    {formatCurrency(amount, displayCurrency)}
                  </span>
                </div>
                <BudgetBar used={used} budget={amount} className="mt-1" />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** 진행률 막대. 넘긴 예산은 빨강으로 바꿔 한눈에 갈라 보이게 한다. */
function BudgetBar({
  used,
  budget,
  className,
}: {
  used: number;
  budget: number;
  className: string;
}) {
  const percentage = budgetPercentage(budget, used);
  const over = used > budget;

  return (
    <div className={className}>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full rounded-full ${over ? 'bg-red-500' : 'bg-blue-600'}`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
      <p className={`mt-1 text-xs ${over ? 'text-red-600' : 'text-gray-500'}`}>
        {percentage}%
        {over && ` · ${formatCurrencyOver(used - budget)}`}
      </p>
    </div>
  );
}

/** 초과분은 통화 기호 없이 짧게 적는다. 막대 아래 한 줄이라 길면 접힌다. */
function formatCurrencyOver(over: number): string {
  return `${new Intl.NumberFormat('ko-KR').format(Math.round(over))} 초과`;
}
