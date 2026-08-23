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

/**
 * 주말 요일 색. 토요일은 파랑, 일요일은 빨강.
 *
 * 달력에서 쓰는 관습이다. 목록의 수입(초록)·지출(빨강)과 같은 채도를 써서 한 화면에
 * 색이 튀지 않게 한다. 평일은 날짜를 읽는 데 방해가 되지 않도록 회색으로 물러선다.
 */
const WEEKDAY_COLOR: Record<number, string> = {
  0: 'text-red-600',
  6: 'text-blue-600',
};
const WEEKDAY_COLOR_DEFAULT = 'text-gray-400';

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
    <div className="space-y-4">
      {sortedDates.map((isoDate) => {
        const dayEntries = grouped.get(isoDate)!;
        // 요일만 필요하다. isoDate는 달력 날짜라 UTC로 읽는다.
        const weekdayIndex = new Date(isoDate).getUTCDay();
        const { incomeTotal, expenseTotal } = sumEntries(dayEntries);

        return (
          <div key={isoDate}>
            {/*
              날짜 머리글. 스크롤하는 동안 붙어 있어야 지금 보는 줄이 며칠인지 알 수 있다.
              바탕색은 페이지와 같게 두어 흰 목록 위를 지날 때 글자가 겹쳐 보이지 않는다.
            */}
            <div className="sticky top-0 z-10 flex items-baseline justify-between gap-3 bg-gray-50 px-3 py-1.5">
              <h3 className="text-sm font-semibold text-gray-700">
                {formatDateMarker(isoDate)}{' '}
                <span
                  className={`font-normal ${
                    WEEKDAY_COLOR[weekdayIndex] ?? WEEKDAY_COLOR_DEFAULT
                  }`}
                >
                  ({WEEKDAYS[weekdayIndex]})
                </span>
              </h3>
              <div className="flex gap-3 text-xs font-semibold tabular-nums">
                {incomeTotal > 0 && (
                  <span className="text-green-600">+{formatCurrency(incomeTotal)}</span>
                )}
                {expenseTotal > 0 && (
                  <span className="text-red-600">-{formatCurrency(expenseTotal)}</span>
                )}
              </div>
            </div>

            {/*
              하루치를 한 상자에 담고 줄 사이는 선으로만 나눈다. 줄마다 카드를 띄우면
              그림자와 여백이 줄 수만큼 쌓여 휴대폰에서 한 화면에 두세 건밖에 안 들어간다.
            */}
            <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
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
