'use client';

import { useMemo } from 'react';
import type { EntryListItem } from './TransactionItem';
import { sumEntries } from '@/lib/entries';
import { dateKeyOf } from '@/lib/datetime';
import { useProjectTimeZone } from '@/store/project';

interface CalendarDay {
  date: Date;
  isCurrentMonth: boolean;
  entries: EntryListItem[];
  expenseTotal: number;
  incomeTotal: number;
}

interface Props {
  entries: EntryListItem[];
  /** 화면에 표시할 연도 */
  year: number;
  /** 화면에 표시할 월 (1~12) */
  month: number;
  onDateSelect: (date: Date, entries: EntryListItem[]) => void;
  onMonthChange: (year: number, month: number) => void;
  startDate?: Date | null;
  endDate?: Date | null;
}

export default function TransactionCalendar({
  entries,
  year,
  month,
  onDateSelect,
  onMonthChange,
  startDate,
  endDate,
}: Props) {
  // 거래가 며칠 칸에 들어가는지는 프로젝트 타임존 기준으로 판단한다.
  const timeZone = useProjectTimeZone();
  // 표시 월은 부모가 관리한다. 내부 상태를 두면 홈 상단의 월 이동과 어긋난다.
  const currentDate = useMemo(() => new Date(year, month - 1, 1), [year, month]);

  const isDateInRange = (date: Date): boolean => {
    if (!startDate) return false;
    if (!endDate) return false;
    return date >= startDate && date <= endDate;
  };

  const isStartOrEndDate = (date: Date): boolean => {
    if (startDate && date.getTime() === startDate.getTime()) return true;
    if (endDate && date.getTime() === endDate.getTime()) return true;
    return false;
  };

  const days = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());

    const endDate = new Date(lastDay);
    endDate.setDate(endDate.getDate() + (6 - lastDay.getDay()));

    const calendarDays: CalendarDay[] = [];
    const currentDay = new Date(startDate);

    const getLocalDateStr = (date: Date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    while (currentDay <= endDate) {
      const dateStr = getLocalDateStr(currentDay);
      // 카드대금 결제는 소비가 아니라 부채 상환이라 달력 합계에서 뺀다.
      const dayEntries = entries.filter(
        (entry) =>
          dateKeyOf(entry.date, timeZone) === dateStr && entry.kind !== 'card_payment',
      );

      const { incomeTotal, expenseTotal } = sumEntries(dayEntries);

      calendarDays.push({
        date: new Date(currentDay),
        isCurrentMonth: currentDay.getMonth() === month,
        entries: dayEntries,
        expenseTotal,
        incomeTotal,
      });

      currentDay.setDate(currentDay.getDate() + 1);
    }

    return calendarDays;
  }, [currentDate, entries, timeZone]);

  // Date 생성자가 월 넘김(1월->전년 12월, 12월->다음해 1월)을 알아서 처리한다.
  const handlePrevMonth = () => {
    const prev = new Date(year, month - 2, 1);
    onMonthChange(prev.getFullYear(), prev.getMonth() + 1);
  };

  const handleNextMonth = () => {
    const next = new Date(year, month, 1);
    onMonthChange(next.getFullYear(), next.getMonth() + 1);
  };

  const handleToday = () => {
    const today = new Date();
    onMonthChange(today.getFullYear(), today.getMonth() + 1);
  };

  const weekDays = ['일', '월', '화', '수', '목', '금', '토'];

  return (
    <div className="w-full">
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="grid grid-cols-7 gap-0 bg-gradient-to-b from-gray-50 to-white border-b border-gray-100">
          {weekDays.map((day) => (
            <div
              key={day}
              className="p-3 text-center font-semibold text-gray-600 text-sm"
            >
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-0">
          {days.map((day, index) => (
            <div
              key={index}
              onClick={() => {
                if (day.isCurrentMonth) {
                  onDateSelect(day.date, day.entries);
                }
              }}
              className={`min-h-28 p-2 border-b border-r border-gray-100 last-of-type:border-r-0 ${
                index % 7 === 6 ? 'border-r-0' : ''
              } ${
                isStartOrEndDate(day.date)
                  ? 'bg-blue-500 text-white'
                  : isDateInRange(day.date)
                  ? 'bg-blue-100'
                  : !day.isCurrentMonth
                  ? 'bg-gray-50'
                  : 'bg-white hover:bg-blue-50'
              } ${day.isCurrentMonth ? 'cursor-pointer transition' : ''}`}
            >
              <p
                className={`text-sm font-semibold mb-1 ${
                  isStartOrEndDate(day.date)
                    ? 'text-white'
                    : day.isCurrentMonth
                    ? 'text-gray-900'
                    : 'text-gray-400'
                }`}
              >
                {day.date.getDate()}
              </p>

              {(day.expenseTotal > 0 || day.incomeTotal > 0) && (
                <div className="space-y-1">
                  {day.expenseTotal > 0 && (
                    <div className={`text-xs font-medium truncate ${
                      isStartOrEndDate(day.date) ? 'text-white' : 'text-red-600'
                    }`}>
                      - {new Intl.NumberFormat('ko-KR').format(day.expenseTotal)}
                    </div>
                  )}
                  {day.incomeTotal > 0 && (
                    <div className={`text-xs font-medium truncate ${
                      isStartOrEndDate(day.date) ? 'text-white' : 'text-green-600'
                    }`}>
                      + {new Intl.NumberFormat('ko-KR').format(day.incomeTotal)}
                    </div>
                  )}
                </div>
              )}

              {day.entries.length > 0 && day.expenseTotal === 0 && day.incomeTotal === 0 && (
                <div className="text-xs text-gray-500">
                  {day.entries.length}건
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
