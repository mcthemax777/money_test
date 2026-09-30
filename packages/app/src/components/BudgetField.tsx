import { Pressable, Text, View } from 'react-native';

import type { BudgetSettingRow } from '@money/core/lib/budget';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency } from '@money/core/lib/money';
import { useProjectDisplayCurrency } from '@money/core/store/project';

/**
 * 상세 창 안의 "이번 달 예산" 칸. 웹의 BudgetField 와 같다.
 *
 * 금액을 여기서 바로 고치지 않고 예산 팝업을 연다. 예산은 적용 범위와 월별 조정이 함께
 * 가는 값이라, 칸 하나로 고치면 어느 달까지 바뀌는지 알 수 없다.
 */
export default function BudgetField({
  row,
  onEdit,
}: {
  /** 이 대상의 이 달 예산. 아직 받지 못했으면 없다. */
  row: BudgetSettingRow | undefined;
  /** 예산 팝업을 연다. 보기 권한에게는 넘기지 않는다. */
  onEdit?: () => void;
}) {
  const { t } = useTranslation();
  const currency = useProjectDisplayCurrency();

  return (
    <View>
      <Text className="mb-1 text-sm font-medium text-gray-700">{t('budget.thisMonth')}</Text>
      <View className="flex-row items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
        <View className="flex-1 flex-row flex-wrap items-center gap-2">
          <Text className={row?.isSet ? 'text-gray-900' : 'text-gray-400'}>
            {row?.isSet ? formatCurrency(row.amount, currency) : t('common.none')}
          </Text>
          {row?.isOverridden ? (
            <Text className="text-xs text-amber-700">{t('budget.monthAdjusted')}</Text>
          ) : null}
        </View>
        {onEdit ? (
          <Pressable
            onPress={onEdit}
            accessibilityRole="button"
            className="rounded-lg border border-blue-200 px-3 py-1 active:bg-blue-50"
          >
            <Text className="text-sm text-blue-600">{t('budget.settings')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
