import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Settings } from 'lucide-react-native';
import type { BudgetDto, CategoryDto } from '@money/types';

import {
  BUDGET_TOTAL_TARGET,
  budgetPercentage,
  budgetTone,
  inCategoryOrder,
  tagBudgetTargetId,
} from '@money/core/lib/budget';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import { useProjectDisplayCurrency } from '@money/core/store/project';

import TypeTabs from './TypeTabs';

/**
 * 이 달 예산 진행률. 웹의 MonthlyBudgetSummary 와 같다.
 *
 * 예산을 잡아 둔 분류만 분류 화면에서 정한 차례로 늘어놓는다.
 */
export default function MonthlyBudgetSummary({
  budgets,
  categories,
  type,
  onTypeChange,
  onSelect,
  onOpenSettings,
}: {
  budgets: BudgetDto.MonthlyBudget[];
  /** 줄의 차례를 정하는 분류 목록 (분류 화면에서 정한 차례). */
  categories: readonly CategoryDto.Response[];
  type: 'income' | 'expense';
  /** 넘기면 제목 아래에 지출·수입 탭이 선다 (웹과 같은 까닭으로 상자 안에 둔다). */
  onTypeChange?: (type: 'income' | 'expense') => void;
  /**
   * 줄을 누르면 부른다. 가계 분류별에서 그 분류를 누를 때와 같은 상세 분석을 연다 (웹과 같다).
   * 합계 줄은 'total-expense' / 'total-income' 을 넘긴다.
   */
  onSelect?: (target: { id: string; name: string }) => void;
  /** 예산 설정 화면으로. 넘기면 제목 줄 오른쪽 끝에 톱니가 선다 (보기 권한은 넘기지 않는다). */
  onOpenSettings?: () => void;
}) {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();

  /** 전체 예산(분류 없는 예산)과 그 사용액 */
  const totalRow = budgets.find((budget) => !budget.categoryId && budget.categoryType === type);
  const totalBudget = toNumber(totalRow?.monthlyAmount);
  const totalUsed = toNumber(totalRow?.usedAmount);

  // 예산을 잡아 둔 분류만. 분류 화면에서 정한 차례로 본다 (inCategoryOrder).
  const rows = inCategoryOrder(
    budgets.filter(
      (budget) =>
        budget.categoryId && budget.categoryType === type && toNumber(budget.monthlyAmount) > 0,
    ),
    categories,
  );

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
      <BoxHeader
        title={type === 'income' ? t('budget.title.income') : t('budget.title.expense')}
        settingsLabel={t('budget.settings')}
        onOpenSettings={onOpenSettings}
      />

      {onTypeChange ? (
        <View className="mb-3">
          <TypeTabs
            type={type}
            onChange={onTypeChange}
            /* 고른 탭만 파랑이다. 금액은 아래 합계 줄이 말한다. */
            tone="selection"
          />
        </View>
      ) : null}

      {/*
        합계는 전체 예산을 잡아 두었을 때만 적는다. 예산이 없으면 사용액 한 줄만
        남는데, 그 숫자는 바로 위 탭이 이미 적고 있다.
      */}
      {totalBudget > 0 ? (
        <RowButton
          className="mb-3"
          onPress={
            onSelect &&
            (() =>
              onSelect({
                id: BUDGET_TOTAL_TARGET[type],
                name: type === 'income' ? t('ledger.totalIncome') : t('ledger.totalExpense'),
              }))
          }
        >
          <View className="flex-row items-baseline justify-between">
            <Text className="text-sm text-gray-600">{t('budget.total')}</Text>
            <UsedOfBudget used={totalUsed} budget={totalBudget} currency={displayCurrency} />
          </View>
          <BudgetLine budget={totalBudget} used={totalUsed} currency={displayCurrency} type={type} />
        </RowButton>
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
              /* 상세 제목은 가계와 같이 그 분류의 이름만 적는다. */
              onPress={
                onSelect &&
                (() => onSelect({ id: budget.categoryId!, name: budget.categoryName ?? '' }))
              }
            />
          ))}
        </View>
      )}

    </View>
  );
}

/**
 * 이 달의 태그 예산. 분류 예산 상자와 같은 모양의 상자를 따로 둔다 (웹의 TagBudgetSummary 와 같다).
 *
 * 지출·수입 탭을 따르지 않는다. 태그 예산은 쓴 돈에서 돌려받은 돈을 뺀 한 금액으로 견준다.
 * 예산을 잡은 태그만 태그 화면에서 정한 차례로 적는다.
 */
export function TagBudgetSummary({
  tagBudgets,
  onSelect,
  onOpenSettings,
}: {
  tagBudgets: BudgetDto.MonthlyTagBudget[];
  /**
   * 줄을 누르면 부른다. 분류 예산 줄과 같은 상세 분석을 연다 -- id 는 `tag:<태그 id>` 이고
   * 분석은 그 태그가 붙은 줄의 지출을 그린다 (useCategoryDetail 의 resolveTarget).
   */
  onSelect?: (target: { id: string; name: string }) => void;
  /** 태그 예산 설정으로. 넘기면 제목 줄 오른쪽 끝에 톱니가 선다 (보기 권한은 넘기지 않는다). */
  onOpenSettings?: () => void;
}) {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();

  // 예산을 잡아 둔 태그만. 응답이 이미 태그 화면에서 정한 차례라 그대로 둔다 (2026-10-08 사용자 요청).
  const rows = tagBudgets.filter((budget) => toNumber(budget.monthlyAmount) > 0);

  return (
    <View className="rounded-lg bg-white p-4 shadow-sm">
      <BoxHeader
        title={t('budget.tagTitle')}
        settingsLabel={t('budget.tagSettings')}
        onOpenSettings={onOpenSettings}
      />

      {rows.length === 0 ? (
        <Text className="text-sm text-gray-600">{t('budget.none.tag')}</Text>
      ) : (
        <View className="gap-1">
          {rows.map((budget) => (
            <BudgetRow
              key={budget.budgetId}
              name={budget.tagName}
              color={budget.tagColor}
              isTag
              used={toNumber(budget.usedAmount)}
              budget={toNumber(budget.monthlyAmount)}
              currency={displayCurrency}
              /* 쓴 돈에서 돌려받은 돈을 뺀 값이라 넘기면 지출 예산처럼 붉게 뜬다. */
              type="expense"
              onPress={
                onSelect &&
                (() =>
                  onSelect({
                    id: tagBudgetTargetId(budget.tagId),
                    name: t('budget.tagTarget', { name: budget.tagName }),
                  }))
              }
            />
          ))}
        </View>
      )}
    </View>
  );
}

/** 예산 상자의 제목 줄. 오른쪽 끝에 설정 톱니가 선다. 분류 상자와 태그 상자가 함께 쓴다. */
function BoxHeader({
  title,
  settingsLabel,
  onOpenSettings,
}: {
  title: string;
  settingsLabel: string;
  onOpenSettings?: () => void;
}) {
  return (
    <View className="mb-3 flex-row items-center justify-between gap-2">
      <Text className="font-semibold text-gray-900">{title}</Text>
      {/* 누를 자리는 32px, 음수 여백으로 상자의 오른쪽 위 선에 붙인다 (웹과 같은 값). */}
      {onOpenSettings ? (
        <Pressable
          onPress={onOpenSettings}
          accessibilityRole="button"
          accessibilityLabel={settingsLabel}
          className="-my-1 -mr-2 h-8 w-8 items-center justify-center rounded-lg active:bg-gray-100"
        >
          <Settings size={16} color="#6b7280" />
        </Pressable>
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
  onPress,
}: {
  name: string;
  color?: string;
  isTag?: boolean;
  used: number;
  budget: number;
  currency: string;
  type: 'income' | 'expense';
  onPress?: () => void;
}) {
  return (
    <RowButton onPress={onPress}>
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
    </RowButton>
  );
}

/**
 * 예산 한 줄의 틀. 누를 수 있으면 눌린 동안 옅은 바탕이 서고, 아니면 그냥 칸이다
 * (웹의 RowButton 과 같다). 여백을 음수로 되돌려 글자 자리는 누를 수 없는 줄과 같다.
 */
function RowButton({
  onPress,
  className = '',
  children,
}: {
  onPress?: () => void;
  className?: string;
  children: ReactNode;
}) {
  if (!onPress) return <View className={`py-2 ${className}`}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className={`-mx-2 rounded-md px-2 py-2 active:bg-gray-50 ${className}`}
    >
      {children}
    </Pressable>
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
 * 넘긴 지출 예산은 빨강으로 바꿔 한눈에 갈라 보이게 한다. 수입은 목표를 채운 것이
 * 잘된 일이라 채우면 초록이다 (2026-10-09 사용자 요청, 웹과 같다).
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
  const tone = budgetTone(type, used, budget);

  return (
    <View className="mt-1 flex-row items-center gap-2">
      <View className="h-1 flex-1 overflow-hidden rounded-full bg-gray-100">
        <View
          className={`h-full ${
            tone === 'over' ? 'bg-red-500' : tone === 'reached' ? 'bg-green-500' : 'bg-blue-400'
          }`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </View>
      {/* 예산액은 위 "쓴 금액 / 예산액"이 이미 적는다. 여기서는 진행만 말한다. */}
      <Text
        className={`shrink-0 text-xs ${
          tone === 'over' ? 'text-red-600' : tone === 'reached' ? 'text-green-600' : 'text-gray-500'
        }`}
      >
        {percent}%{' · '}
        {over
          ? t('budget.over', { amount: formatCurrency(used - budget, currency) })
          : t('budget.left', { amount: formatCurrency(budget - used, currency) })}
      </Text>
    </View>
  );
}
