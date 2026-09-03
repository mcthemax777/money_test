import { Text, View } from 'react-native';
import type { EntryListItem } from '@money/types';

import { formatDateMarker, weekdayNames } from '@money/core/lib/datetime';
import { groupEntriesByDate, sumEntries, type CountedShare } from '@money/core/lib/entries';
import { formatCurrency } from '@money/core/lib/money';
import { useProjectDisplayCurrency, useProjectTimeZone } from '@money/core/store/project';

import TransactionItem from './TransactionItem';

/** 토요일은 파랑, 일요일은 빨강. 달력과 같은 규칙이다. */
const WEEKDAY_COLOR: Record<number, string> = {
  0: 'text-red-500',
  6: 'text-blue-500',
};

/**
 * 날짜별로 묶은 거래 목록. 웹의 TransactionListView 와 같다.
 *
 * 하루치를 한 상자에 담고 줄 사이는 선으로만 나눈다. 줄마다 카드를 띄우면 그림자와
 * 여백이 줄 수만큼 쌓여 한 화면에 두세 건밖에 안 들어간다.
 */
export default function TransactionListView({
  entries,
  share,
  onEntryClick,
}: {
  entries: EntryListItem[];
  share?: CountedShare;
  onEntryClick?: (entry: EntryListItem) => void;
}) {
  const timeZone = useProjectTimeZone();
  const displayCurrency = useProjectDisplayCurrency();
  const weekdays = weekdayNames();

  const grouped = groupEntriesByDate(entries, timeZone);

  const sortedDates = [...grouped.keys()].sort((a, b) => b.localeCompare(a));

  return (
    <View className="gap-4">
      {sortedDates.map((isoDate) => {
        const dayEntries = grouped.get(isoDate) ?? [];
        // 요일만 필요하다. isoDate 는 달력 날짜라 UTC 로 읽는다.
        const weekdayIndex = new Date(isoDate).getUTCDay();
        const { incomeTotal, expenseTotal } = sumEntries(dayEntries, share);

        return (
          <View key={isoDate}>
            <View className="flex-row items-baseline justify-between gap-3 px-3 py-1.5">
              <Text className="text-sm font-semibold text-gray-700">
                {formatDateMarker(isoDate)}{' '}
                <Text className={`font-normal ${WEEKDAY_COLOR[weekdayIndex] ?? 'text-gray-500'}`}>
                  ({weekdays[weekdayIndex]})
                </Text>
              </Text>
              <View className="flex-row gap-3">
                {incomeTotal > 0 ? (
                  <Text className="text-xs font-semibold text-green-600">
                    +{formatCurrency(incomeTotal, displayCurrency)}
                  </Text>
                ) : null}
                {expenseTotal > 0 ? (
                  <Text className="text-xs font-semibold text-red-600">
                    -{formatCurrency(expenseTotal, displayCurrency)}
                  </Text>
                ) : null}
              </View>
            </View>

            <View className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              {dayEntries.map((entry) => (
                <TransactionItem key={entry.id} entry={entry} onPress={onEntryClick} />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}
