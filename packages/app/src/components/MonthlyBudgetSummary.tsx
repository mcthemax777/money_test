import { Text, View } from 'react-native';
import type { BudgetDto } from '@money/types';

import { budgetPercentage } from '@money/core/lib/budget';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import { useProjectDisplayCurrency } from '@money/core/store/project';

/**
 * 이 달 예산 진행률. 웹의 MonthlyBudgetSummary 와 같다.
 *
 * 예산을 잡아 둔 분류만 많이 쓴(번) 순으로 늘어놓는다.
 */
export default function MonthlyBudgetSummary({
  budgets,
  type,
}: {
  budgets: BudgetDto.MonthlyBudget[];
  type: 'income' | 'expense';
}) {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();

  /** 전체 예산(분류 없는 예산)과 그 사용액 */
  const totalRow = budgets.find((budget) => !budget.categoryId && budget.categoryType === type);
  const totalBudget = toNumber(totalRow?.monthlyAmount);
  const totalUsed = toNumber(totalRow?.usedAmount);

  const rows = budgets
    .filter(
      (budget) =>
        budget.categoryId && budget.categoryType === type && toNumber(budget.monthlyAmount) > 0,
    )
    .sort((a, b) => toNumber(b.usedAmount) - toNumber(a.usedAmount));

  /*
   * 분류 이름. 소분류는 "대분류 > 소분류"로 적는다. 소분류 이름은 대분류 밑에서만
   * 뜻이 통한다("커피"만으로는 식비인지 간식인지 알 수 없다).
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
    <View className="rounded-lg bg-white p-4 shadow-sm">
      <Text className="mb-3 font-semibold text-gray-900">
        {type === 'income' ? t('budget.title.income') : t('budget.title.expense')}
      </Text>

      {/*
        합계는 전체 예산을 잡아 두었을 때만 적는다. 예산이 없으면 사용액 한 줄만
        남는데, 그 숫자는 바로 위 탭이 이미 적고 있다.
      */}
      {totalBudget > 0 ? (
        <View className="mb-3 py-2">
          <View className="flex-row items-baseline justify-between">
            <Text className="text-sm text-gray-600">{t('budget.total')}</Text>
            <UsedOfBudget used={totalUsed} budget={totalBudget} currency={displayCurrency} />
          </View>
          <BudgetLine budget={totalBudget} used={totalUsed} currency={displayCurrency} type={type} />
        </View>
      ) : null}

      {rows.length === 0 ? (
        <Text className="text-sm text-gray-600">
          {type === 'income' ? t('budget.none.income') : t('budget.none.expense')}
        </Text>
      ) : (
        <View className="gap-1">
          {rows.map((budget) => {
            const used = toNumber(budget.usedAmount);

            return (
              <View key={budget.budgetId} className="py-2">
                <View className="flex-row items-baseline justify-between gap-2">
                  <Text numberOfLines={1} className="shrink text-sm text-gray-800">
                    {nameOf(budget)}
                  </Text>
                  <UsedOfBudget
                    used={used}
                    budget={toNumber(budget.monthlyAmount)}
                    currency={displayCurrency}
                  />
                </View>
                <BudgetLine
                  budget={toNumber(budget.monthlyAmount)}
                  used={used}
                  currency={displayCurrency}
                  type={type}
                />
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

/**
 * "쓴 금액 / 잡아 둔 금액".
 *
 * 쓴 금액만 적으면 그 액수가 큰지 작은지 알 수 없다. 예산액은 견주는 기준일 뿐이라
 * 옅게 물러선다.
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
    <Text className="shrink-0">
      <Text className={`text-sm font-semibold ${used > 0 ? 'text-gray-900' : 'text-gray-400'}`}>
        {formatCurrency(used, currency)}
      </Text>
      <Text className="text-sm text-gray-500"> / {formatCurrency(budget, currency)}</Text>
    </Text>
  );
}

/**
 * 예산 진행률 한 줄.
 *
 * 넘긴 지출 예산은 빨강으로 바꿔 한눈에 갈라 보이게 한다. 수입은 목표를 넘긴 것이
 * 잘된 일이라 빨강을 쓰지 않는다.
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
  const { t } = useTranslation();

  if (budget <= 0) return null;

  const percent = budgetPercentage(budget, used);
  const over = used > budget;
  const warn = type === 'expense' && over;

  return (
    <View className="mt-1 flex-row items-center gap-2">
      <View className="h-1 flex-1 overflow-hidden rounded-full bg-gray-100">
        <View
          className={`h-full ${warn ? 'bg-red-500' : 'bg-blue-400'}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </View>
      {/* 예산액은 위 "쓴 금액 / 예산액"이 이미 적는다. 여기서는 진행만 말한다. */}
      <Text className={`shrink-0 text-xs ${warn ? 'text-red-600' : 'text-gray-500'}`}>
        {percent}%{' · '}
        {over
          ? t('budget.over', { amount: formatCurrency(used - budget, currency) })
          : t('budget.left', { amount: formatCurrency(budget - used, currency) })}
      </Text>
    </View>
  );
}
