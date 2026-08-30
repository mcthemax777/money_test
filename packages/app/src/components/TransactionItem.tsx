/*
 * 거래 한 줄. 웹 목록의 TransactionItem 과 같은 규칙이다.
 *   1줄: 무슨 거래인가 + 얼마
 *   2줄: 시각 + 과소비·수수료 같은 금액 표시
 */
import { Pressable, Text, View } from 'react-native';
import type { EntryListItem } from '@money/types';

import { formatTime } from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import { useProjectDisplayCurrency, useProjectTimeZone } from '@money/core/store/project';

/** 금액 색이 곧 "합계에 들어가는가"다. 이체와 카드사 이체는 회색이다. */
const AMOUNT_COLOR: Record<EntryListItem['kind'], string> = {
  income: 'text-green-600',
  expense: 'text-red-600',
  transfer: 'text-gray-500',
  card_payment: 'text-gray-500',
  adjustment: 'text-amber-600',
};

const SIGN: Partial<Record<EntryListItem['kind'], string>> = { income: '+', expense: '-' };

export default function TransactionItem({
  entry,
  onPress,
}: {
  entry: EntryListItem;
  onPress?: () => void;
}) {
  const { t } = useTranslation();
  const timeZone = useProjectTimeZone();
  const displayCurrency = useProjectDisplayCurrency();

  const flowTo = entry.toAccountName ?? entry.cardName;
  const categoryLabel = entry.parentCategoryName
    ? `${entry.parentCategoryName} > ${entry.categoryName}`
    : entry.categoryName;

  const title = (() => {
    if (entry.kind === 'card_payment') {
      const name = entry.cardName ?? t('editor.methodCard');
      return t(entry.cardTransferDirection === 'refund' ? 'entry.cardRefund' : 'entry.cardPayment', {
        name,
      });
    }
    if (entry.kind === 'transfer' && entry.accountName && flowTo) {
      return `${entry.accountName} → ${flowTo}`;
    }
    if (entry.kind === 'transfer') return t('entry.transfer');
    if (entry.kind === 'adjustment') return t('entry.adjustment');
    return entry.description || categoryLabel || t('entry.noTitle');
  })();

  const time = formatTime(entry.date, timeZone);
  const extra = toNumber(entry.extraAmount);

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      className="border-b border-gray-100 px-3 py-2.5 active:bg-gray-50"
    >
      <View className="flex-row items-baseline justify-between gap-3">
        <Text numberOfLines={1} className="flex-1 text-[15px] font-medium text-gray-900">
          {title}
        </Text>
        <Text className={`text-[15px] font-semibold ${AMOUNT_COLOR[entry.kind]}`}>
          {SIGN[entry.kind]}
          {formatCurrency(entry.amount, displayCurrency)}
        </Text>
      </View>

      {time || extra > 0 ? (
        <View className="mt-0.5 flex-row items-center justify-between">
          <Text className="text-xs text-gray-500">{time}</Text>
          {extra > 0 ? (
            <Text
              className={`text-xs font-medium ${
                entry.kind === 'income' ? 'text-green-600' : 'text-red-600'
              }`}
            >
              {entry.kind === 'income' ? t('entry.extraIncome') : t('entry.overspend')}{' '}
              {formatCurrency(entry.extraAmount, displayCurrency)}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}
