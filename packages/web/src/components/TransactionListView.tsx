'use client';

import TransactionItem, { EntryListItem } from './TransactionItem';
import { formatCurrency } from '@/lib/money';
import { sumEntries } from '@/lib/entries';

interface TransactionListViewProps {
  entries: EntryListItem[];
  onEntryClick: (entry: EntryListItem) => void;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export default function TransactionListView({
  entries,
  onEntryClick,
}: TransactionListViewProps) {
  // 날짜 문자열을 다시 파싱하지 않도록 ISO 날짜(YYYY-MM-DD)로 묶는다.
  const grouped = new Map<string, EntryListItem[]>();
  for (const entry of entries) {
    const key = new Date(entry.date).toISOString().slice(0, 10);
    const list = grouped.get(key) ?? [];
    list.push(entry);
    grouped.set(key, list);
  }

  const sortedDates = [...grouped.keys()].sort((a, b) => b.localeCompare(a));

  return (
    <div className="space-y-6">
      {sortedDates.map((isoDate) => {
        const dayEntries = grouped.get(isoDate)!;
        const date = new Date(isoDate);
        const { incomeTotal, expenseTotal } = sumEntries(dayEntries);

        return (
          <div key={isoDate}>
            <div className="flex items-center justify-between mb-3 sticky top-0 bg-gray-100 py-2 px-3 rounded-lg border border-gray-200">
              <h3 className="text-lg font-bold text-gray-900">
                {date.toLocaleDateString('ko-KR')}{' '}
                <span className="text-sm text-gray-600">({WEEKDAYS[date.getUTCDay()]})</span>
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
