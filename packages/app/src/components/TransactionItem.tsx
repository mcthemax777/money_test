/*
 * 거래 한 줄. 웹 목록의 TransactionItem 과 같은 규칙이다.
 *   1줄: 무슨 거래인가 + 얼마
 *   2줄: 시각 + 과소비·수수료 같은 금액 표시
 */
import { memo } from 'react';
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

/*
 * 누름은 거래를 되돌려 준다.
 *
 * 부르는 쪽이 `() => onPress(entry)` 를 만들어 넘기면 그릴 때마다 새 함수라 아래
 * `memo` 가 늘 헛돈다. 거래 화면은 한 달을 통째로 펼치면 이 줄이 200개까지 서므로,
 * 함수 하나 때문에 200줄이 다시 그려지는 일을 두면 안 된다.
 */
function TransactionItemView({
  entry,
  onPress,
}: {
  entry: EntryListItem;
  onPress?: (entry: EntryListItem) => void;
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
      onPress={onPress && (() => onPress(entry))}
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

      {/*
        붙은 태그. 금액 줄 아래에 둔다.
        이름만 작게 늘어놓는다 -- 목록 한 줄에서 태그는 "이 거래가 어느 일에 딸렸나"를
        알려 주는 곁말이라, 제목만큼 크면 무엇이 거래인지 흐려진다.
      */}
      {entry.tags.length > 0 ? (
        <View className="mt-1 flex-row flex-wrap items-center gap-1">
          {entry.tags.map((tag) => (
            <View
              key={tag.id}
              className="flex-row items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5"
            >
              {tag.color ? (
                <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
              ) : null}
              <Text className="text-[11px] text-gray-600">{tag.name}</Text>
            </View>
          ))}
        </View>
      ) : null}

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

/**
 * 값이 그대로면 다시 그리지 않는다.
 *
 * 한 줄을 그리는 값이 싸지 않다. 시각 표기만 해도 거래마다 Intl 을 두 번 거친다.
 * 거래 화면은 줄 하나가 도착할 때마다 상태가 바뀌는데, 그때 이미 서 있는 줄까지 전부
 * 다시 그리면 한 달 펼치기가 눈에 보이게 밀린다.
 */
export default memo(TransactionItemView);
