import { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { EntryListItem } from '@money/types';

import { weekdayNames } from '@money/core/lib/datetime';
import { groupEntriesByDate, sumEntries, type CountedShare } from '@money/core/lib/entries';
import { useTranslation } from '@money/core/lib/i18n';
import { formatNumber } from '@money/core/lib/money';
import { useProjectTimeZone } from '@money/core/store/project';

interface CalendarDay {
  date: Date;
  isCurrentMonth: boolean;
  entries: EntryListItem[];
  expenseTotal: number;
  incomeTotal: number;
}

/**
 * 달력. 웹의 TransactionCalendar 와 같은 값을 같은 자리에 그린다.
 *
 * 한 칸은 날짜 숫자와 그날의 지출·수입 소계다. 소계는 일반/과소비 중 보고 있는 몫만
 * 센다(share). 그러지 않으면 위 합계와 달력의 숫자가 어긋난다.
 */
export default function TransactionCalendar({
  entries,
  share,
  year,
  month,
  selectedDate,
  onDateSelect,
}: {
  entries: EntryListItem[];
  /** 일반/과소비 중 어느 몫을 셀지. 넘기지 않으면 거래 금액 전부다. */
  share?: CountedShare;
  year: number;
  month: number;
  /** 고른 날. 그 칸을 파랗게 칠한다. */
  selectedDate: Date | null;
  onDateSelect: (date: Date, entries: EntryListItem[]) => void;
}) {
  const { t } = useTranslation();
  // 거래가 며칠 칸에 들어가는지는 프로젝트 타임존 기준으로 판단한다.
  const timeZone = useProjectTimeZone();

  const days = useMemo(() => {
    const first = new Date(year, month - 1, 1);
    const last = new Date(year, month, 0);

    const start = new Date(first);
    start.setDate(start.getDate() - first.getDay());
    const end = new Date(last);
    end.setDate(end.getDate() + (6 - last.getDay()));

    const dateKey = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
        date.getDate(),
      ).padStart(2, '0')}`;

    /*
     * 날짜별로 한 번만 묶는다. 칸마다 전체 목록을 훑으면 타임존 변환이 거래 수 × 42번
     * 일어나 탭을 옮길 때마다 화면이 굳는다.
     */
    const byDate = groupEntriesByDate(entries, timeZone);

    const rows: CalendarDay[] = [];
    for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      const key = dateKey(cursor);
      /*
       * 이체와 카드사 이체도 그날 칸에 보여 준다. 합계에서 빼는 일은 sumEntries 가
       * 하므로(두 종류에 0을 돌려준다) 여기서 걸러 내지 않는다.
       */
      const dayEntries = byDate.get(key) ?? [];
      const { incomeTotal, expenseTotal } = sumEntries(dayEntries, share);

      rows.push({
        date: new Date(cursor),
        isCurrentMonth: cursor.getMonth() === month - 1,
        entries: dayEntries,
        expenseTotal,
        incomeTotal,
      });
    }

    return rows;
  }, [entries, month, share, timeZone, year]);

  const isSelected = (date: Date) =>
    Boolean(selectedDate) && date.getTime() === selectedDate?.getTime();

  return (
    <View className="overflow-hidden rounded-lg border border-gray-100 bg-white">
      <View className="flex-row border-b border-gray-100 bg-gray-50">
        {weekdayNames().map((day) => (
          <View key={day} className="flex-1 p-3">
            <Text className="text-center text-sm font-semibold text-gray-600">{day}</Text>
          </View>
        ))}
      </View>

      <View className="flex-row flex-wrap">
        {days.map((day) => {
          const selected = isSelected(day.date);

          return (
            <Pressable
              key={day.date.toISOString()}
              onPress={() => day.isCurrentMonth && onDateSelect(day.date, day.entries)}
              disabled={!day.isCurrentMonth}
              /* 날짜 숫자 + 지출·수입 두 줄이 들어가는 최소 높이 */
              className={`min-h-20 w-[14.28%] border-b border-r border-gray-100 p-2 ${
                selected ? 'bg-blue-500' : day.isCurrentMonth ? 'bg-white' : 'bg-gray-50'
              }`}
            >
              <Text
                className={`mb-1 text-sm font-semibold ${
                  selected ? 'text-white' : day.isCurrentMonth ? 'text-gray-900' : 'text-gray-400'
                }`}
              >
                {day.date.getDate()}
              </Text>

              {day.expenseTotal > 0 ? (
                <Text
                  numberOfLines={1}
                  className={`text-xs font-medium ${selected ? 'text-white' : 'text-red-600'}`}
                >
                  - {formatNumber(day.expenseTotal)}
                </Text>
              ) : null}
              {day.incomeTotal > 0 ? (
                <Text
                  numberOfLines={1}
                  className={`text-xs font-medium ${selected ? 'text-white' : 'text-green-600'}`}
                >
                  + {formatNumber(day.incomeTotal)}
                </Text>
              ) : null}

              {day.entries.length > 0 && day.expenseTotal === 0 && day.incomeTotal === 0 ? (
                <Text className={`text-xs ${selected ? 'text-white' : 'text-gray-500'}`}>
                  {t('ledger.entryCount', { count: day.entries.length })}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
