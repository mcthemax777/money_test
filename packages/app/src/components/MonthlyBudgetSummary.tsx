import { Pressable, Text, View } from 'react-native';
import { Settings } from 'lucide-react-native';
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
  tagBudgets = [],
  type,
  onOpenSettings,
}: {
  budgets: BudgetDto.MonthlyBudget[];
  /** 태그 예산. 분류 아래에 같은 모양으로 적는다. 예산을 잡은 태그만 선다. */
  tagBudgets?: BudgetDto.MonthlyTagBudget[];
  type: 'income' | 'expense';
  /** 예산 설정 화면으로. 넘기면 제목 줄 오른쪽 끝에 톱니가 선다 (보기 권한은 넘기지 않는다). */
  onOpenSettings?: () => void;
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

  /* 예산을 잡은 태그. 분류와 같이 많이 쓴(번) 순이다. */
  const tagRows = tagBudgets
    .filter((budget) => budget.type === type && toNumber(budget.monthlyAmount) > 0)
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
      <View className="mb-3 flex-row items-center justify-between gap-2">
        <Text className="font-semibold text-gray-900">
          {type === 'income' ? t('budget.title.income') : t('budget.title.expense')}
        </Text>
        {/* 누를 자리는 32px, 음수 여백으로 상자의 오른쪽 위 선에 붙인다 (웹과 같은 값). */}
        {onOpenSettings ? (
          <Pressable
            onPress={onOpenSettings}
            accessibilityRole="button"
            accessibilityLabel={t('budget.settings')}
            className="-my-1 -mr-2 h-8 w-8 items-center justify-center rounded-lg active:bg-gray-100"
          >
            <Settings size={16} color="#6b7280" />
          </Pressable>
        ) : null}
      </View>

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
          {rows.map((budget) => (
            <BudgetRow
              key={budget.budgetId}
              name={nameOf(budget)}
              used={toNumber(budget.usedAmount)}
              budget={toNumber(budget.monthlyAmount)}
              currency={displayCurrency}
              type={type}
            />
          ))}
        </View>
      )}

      {/* 태그 예산. 분류 아래에 칸을 나눠 적는다 (웹과 같은 까닭). 잡은 태그가 없으면 두지 않는다. */}
      {tagRows.length > 0 ? (
        <View className="mt-3 border-t border-gray-100 pt-3">
          <Text className="mb-1 text-xs font-medium text-gray-500">{t('budget.tagSection')}</Text>
          <View className="gap-1">
            {tagRows.map((budget) => (
              <BudgetRow
                key={budget.budgetId}
                name={budget.tagName}
                color={budget.tagColor}
                isTag
                used={toNumber(budget.usedAmount)}
                budget={toNumber(budget.monthlyAmount)}
                currency={displayCurrency}
                type={type}
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** 예산 한 줄. 분류와 태그가 같은 모양을 쓴다. 태그는 이름 앞에 색 점이 선다. */
function BudgetRow({
  name,
  color,
  isTag = false,
  used,
  budget,
  currency,
  type,
}: {
  name: string;
  color?: string;
  isTag?: boolean;
  used: number;
  budget: number;
  currency: string;
  type: 'income' | 'expense';
}) {
  return (
    <View className="py-2">
      <View className="flex-row items-baseline justify-between gap-2">
        <View className="shrink flex-row items-center gap-1.5">
          {isTag ? (
            <View
              className="h-2 w-2 rounded-full bg-gray-300"
              style={color ? { backgroundColor: color } : undefined}
            />
          ) : null}
          <Text numberOfLines={1} className="shrink text-sm text-gray-800">
            {name}
          </Text>
        </View>
        <UsedOfBudget used={used} budget={budget} currency={currency} />
      </View>
      <BudgetLine budget={budget} used={used} currency={currency} type={type} />
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
