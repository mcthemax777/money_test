'use client';

import TransactionItem, { EntryListItem } from './TransactionItem';
import { formatCurrency } from '@/lib/money';
import { sumEntries } from '@/lib/entries';
import { dateKeyOf, formatDateMarker } from '@/lib/datetime';
import { useProjectTimeZone } from '@/store/project';

interface TransactionListViewProps {
  entries: EntryListItem[];
  onEntryClick: (entry: EntryListItem) => void;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export default function TransactionListView({
  entries,
  onEntryClick,
}: TransactionListViewProps) {
  const timeZone = useProjectTimeZone();

  // 날짜 문자열을 다시 파싱하지 않도록 달력 날짜(YYYY-MM-DD)로 묶는다.
  // 어느 날에 속하는지는 프로젝트 타임존 기준이다.
  const grouped = new Map<string, EntryListItem[]>();
  for (const entry of entries) {
    const key = dateKeyOf(entry.date, timeZone);
    const list = grouped.get(key) ?? [];
    list.push(entry);
    grouped.set(key, list);
  }

  const sortedDates = [...grouped.keys()].sort((a, b) => b.localeCompare(a));

  return (
    <div className="space-y-6">
      {sortedDates.map((isoDate) => {
        const dayEntries = grouped.get(isoDate)!;
        // 요일만 필요하다. isoDate는 달력 날짜라 UTC로 읽는다.
        const weekday = WEEKDAYS[new Date(isoDate).getUTCDay()];
        const { incomeTotal, expenseTotal } = sumEntries(dayEntries);

        return (
          <div key={isoDate}>
            <div className="flex items-center justify-between mb-3 sticky top-0 bg-gray-100 py-2 px-3 rounded-lg border border-gray-200">
              <h3 className="text-lg font-bold text-gray-900">
                {formatDateMarker(isoDate)}{' '}
                <span className="text-sm text-gray-600">({weekday})</span>
              </h3>
              <div className="flex gap-6 text-sm font-semibold">
                {incomeTotal > 0 && (
                  <span className="text-green-600">+{formatCurrency(incomeTotal)}</span>
                )}
                {expenseTotal > 0 && (
                  <span className="text-red-600">-{formatCurrency(expenseTotal)}</span>
                )}
              </div>
            </div>
            <div className="space-y-2">
              {dayEntries.map((entry) => (
                <TransactionItem
                  key={entry.id}
                  entry={entry}
                  onClick={() => onEntryClick(entry)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
