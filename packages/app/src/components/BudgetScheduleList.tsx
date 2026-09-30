import { Pressable, Text, TextInput, View } from 'react-native';

import { useBudgetSchedule } from '@money/core/hooks/useBudgetSchedule';
import { formatYearMonth } from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency, formatNumber } from '@money/core/lib/money';
import { useProjectDisplayCurrency } from '@money/core/store/project';

/**
 * 한 분류의 월별 예산 목록. 웹의 BudgetScheduleList 와 같고 로직도 같은 훅이다.
 *
 * 여기서 고치는 것은 언제나 그 달 하나뿐이다(BudgetOverride). 여러 달을 한꺼번에
 * 바꾸는 일은 위쪽 폼의 "적용 범위"가 맡는다.
 *
 * 웹은 열두 줄을 목록 안에서 따로 굴리지만 앱은 그대로 늘어놓는다. 팝업 본문이 이미
 * 굴러가는 자리라 안에 또 굴리는 칸을 두면 손짓이 어느 쪽에 먹는지 헷갈린다.
 */
export default function BudgetScheduleList(props: {
  projectId: string | null;
  /** 분류 예산이면 분류 id, 합계면 'BUDGET_TOTAL_INCOME' / 'BUDGET_TOTAL_EXPENSE'. */
  categoryId?: string;
  /** 태그 예산이면 그 태그. 이때 categoryId 는 없다. */
  tagId?: string;
  type: 'income' | 'expense';
  startMonth: string;
  reloadToken: number;
  onChange: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();
  const schedule = useBudgetSchedule(props);

  return (
    <View className="border-t border-gray-200 pt-4">
      <View className="mb-2 flex-row items-center justify-between">
        <Text className="text-sm font-medium text-gray-700">{t('schedule.title')}</Text>
        <View className="flex-row items-center gap-1">
          <Pressable
            onPress={schedule.showPrev}
            className="rounded border border-gray-300 px-2 py-1 active:bg-gray-50"
          >
            <Text className="text-xs text-gray-600">{t('schedule.prev')}</Text>
          </Pressable>
          <Text className="px-1 text-xs text-gray-500">
            {schedule.windowStart} ~ {schedule.windowEnd}
          </Text>
          <Pressable
            onPress={schedule.showNext}
            className="rounded border border-gray-300 px-2 py-1 active:bg-gray-50"
          >
            <Text className="text-xs text-gray-600">{t('schedule.next')}</Text>
          </Pressable>
        </View>
      </View>

      {schedule.error ? (
        <View className="mb-2 rounded border border-red-200 bg-red-50 p-2">
          <Text className="text-xs text-red-600">{schedule.error}</Text>
        </View>
      ) : null}

      {schedule.isLoading ? (
        <Text className="py-6 text-center text-sm text-gray-500">{t('feed.loadingMore')}</Text>
      ) : (
        <View>
          {schedule.months.map((row, index) => {
            const [year, month] = row.yearMonth.split('-').map(Number);
            const label = formatYearMonth(year, month);
            const isEditing = schedule.editingMonth === row.yearMonth;
            /* 규칙이 안 걸치는 달. 조정은 규칙에 붙는 값이라 고칠 수가 없다. */
            const hasRule = Boolean(row.budgetId);

            return (
              <View
                key={row.yearMonth}
                className={`flex-row items-center gap-2 py-1.5 ${
                  index > 0 ? 'border-t border-gray-100' : ''
                }`}
              >
                <Text className="w-24 text-sm text-gray-600">{label}</Text>

                {isEditing ? (
                  <>
                    <TextInput
                      value={schedule.editingValue}
                      onChangeText={schedule.setEditingValue}
                      keyboardType="number-pad"
                      autoFocus
                      onSubmitEditing={() => schedule.saveMonth(row)}
                      className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-right text-sm text-gray-900"
                    />
                    <Pressable
                      onPress={() => schedule.saveMonth(row)}
                      disabled={schedule.isSaving}
                      accessibilityLabel={t('schedule.saveLabel', { month: label })}
                      className={`rounded bg-blue-600 px-2 py-1 ${
                        schedule.isSaving ? 'opacity-50' : 'active:bg-blue-700'
                      }`}
                    >
                      <Text className="text-xs text-white">{t('common.save')}</Text>
                    </Pressable>
                    <Pressable
                      onPress={schedule.cancelEdit}
                      disabled={schedule.isSaving}
                      accessibilityLabel={t('schedule.cancelLabel', { month: label })}
                      className="rounded border border-gray-300 px-2 py-1 active:bg-gray-50"
                    >
                      <Text className="text-xs text-gray-600">{t('common.cancel')}</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <View className="flex-1 items-end">
                      <Text className="text-sm text-gray-900">
                        {hasRule
                          ? formatCurrency(row.amount, displayCurrency)
                          : t('schedule.noBudget')}
                      </Text>
                      {/* 규칙 금액과 다른 달. 원래 얼마였는지 함께 보여 준다. */}
                      {row.isOverridden ? (
                        <Text className="text-xs text-amber-700">
                          {t('schedule.adjusted', { amount: formatNumber(row.ruleAmount) })}
                        </Text>
                      ) : null}
                    </View>

                    <Pressable
                      onPress={() => schedule.startEdit(row)}
                      disabled={!hasRule || schedule.isSaving}
                      accessibilityLabel={t('schedule.editLabel', { month: label })}
                      hitSlop={6}
                      className="px-2 py-1"
                    >
                      <Text className={`text-xs ${hasRule ? 'text-blue-600' : 'text-gray-300'}`}>
                        {t('schedule.edit')}
                      </Text>
                    </Pressable>

                    {row.isOverridden ? (
                      <Pressable
                        onPress={() => schedule.clearMonth(row)}
                        disabled={schedule.isSaving}
                        accessibilityLabel={t('schedule.revertLabel', { month: label })}
                        hitSlop={6}
                        className="px-2 py-1"
                      >
                        <Text className="text-xs text-gray-500">{t('schedule.revert')}</Text>
                      </Pressable>
                    ) : null}
                  </>
                )}
              </View>
            );
          })}
        </View>
      )}

      <Text className="mt-2 text-xs text-gray-500">{t('schedule.hint')}</Text>
    </View>
  );
}
