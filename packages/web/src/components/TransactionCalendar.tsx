'use client';

import { useMemo } from 'react';
import type { EntryListItem } from './TransactionItem';
import { groupEntriesByDate, sumEntries, type CountedShare } from '@money/core/lib/entries';
import { currentYearMonth, weekdayNames } from '@money/core/lib/datetime';
import { formatNumber } from '@money/core/lib/money';
import { useProjectTimeZone } from '@money/core/store/project';
import { useTranslation } from '@money/core/lib/i18n';

interface CalendarDay {
  date: Date;
  isCurrentMonth: boolean;
  entries: EntryListItem[];
  expenseTotal: number;
  incomeTotal: number;
}

interface Props {
  entries: EntryListItem[];
  /** 일반/과소비 중 어느 몫을 셀지. 넘기지 않으면 거래 금액 전부다. */
  share?: CountedShare;
  /** 화면에 표시할 연도 */
  year: number;
  /** 화면에 표시할 월 (1~12) */
  month: number;
  onDateSelect: (date: Date, entries: EntryListItem[]) => void;
  onMonthChange: (year: number, month: number) => void;
  startDate?: Date | null;
  endDate?: Date | null;
  /**
   * 조회 구간의 양끝 ("YYYY-MM-DD"). 기간 보기에서 달력을 여러 장 그릴 때 쓴다.
   *
   * 구간 밖의 날은 흐리게 두고 누를 수 없게 한다. 그 날짜의 거래는 애초에
   * 받아오지 않았으므로, 누를 수 있게 두면 "거래 없음"이 사실처럼 보인다.
   */
  periodStart?: string;
  periodEnd?: string;
}

export default function TransactionCalendar({
  entries,
  share,
  year,
  month,
  onDateSelect,
  onMonthChange,
  startDate,
  endDate,
  periodStart,
  periodEnd,
}: Props) {
  const { t } = useTranslation();
  // 거래가 며칠 칸에 들어가는지는 프로젝트 타임존 기준으로 판단한다.
  const timeZone = useProjectTimeZone();
  // 표시 월은 부모가 관리한다. 내부 상태를 두면 홈 상단의 월 이동과 어긋난다.
  const currentDate = useMemo(() => new Date(year, month - 1, 1), [year, month]);

  const isDateInRange = (date: Date): boolean => {
    if (!startDate) return false;
    if (!endDate) return false;
    return date >= startDate && date <= endDate;
  };

  /** 조회 구간 안의 날인지. 구간을 안 넘기면 표시 중인 달 전체가 대상이다. */
  const isInPeriod = (day: CalendarDay): boolean => {
    if (!day.isCurrentMonth) return false;
    if (!periodStart || !periodEnd) return true;

    const key = `${day.date.getFullYear()}-${String(day.date.getMonth() + 1).padStart(2, '0')}-${String(
      day.date.getDate(),
    ).padStart(2, '0')}`;
    return key >= periodStart && key <= periodEnd;
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

    /*
     * 날짜별로 한 번만 묶는다. 칸마다 전체 목록을 훑으면 타임존 변환이 거래 수 × 42번
     * 일어난다. 거래 120건이면 5천 번이 넘어 보기를 옮길 때마다 화면이 늦게 그려진다.
     */
    const byDate = groupEntriesByDate(entries, timeZone);

    const getLocalDateStr = (date: Date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    while (currentDay <= endDate) {
      const dateStr = getLocalDateStr(currentDay);
      // 이체와 카드사 이체도 그날 칸에 보여 준다. 합계에서 빼는 일은
      // sumEntries가 하므로(두 종류에 0을 돌려준다) 여기서 걸러 내지 않는다.
      const dayEntries = byDate.get(dateStr) ?? [];

      const { incomeTotal, expenseTotal } = sumEntries(dayEntries, share);

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
    // 브라우저 로컬이 아니라 프로젝트 타임존 기준의 "오늘"이다.
    // 다른 타임존에서 쓰면 자정 무렵에 엉뚱한 달로 넘어간다.
    const { year: todayYear, month: todayMonth } = currentYearMonth(timeZone);
    onMonthChange(todayYear, todayMonth);
  };

  const weekDays = weekdayNames();

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
          {days.map((day, index) => {
            const selectable = isInPeriod(day);
            return (
            <div
              key={index}
              onClick={() => {
                if (selectable) {
                  onDateSelect(day.date, day.entries);
                }
              }}
              /* min-h-20: 날짜 숫자 + 지출·수입 두 줄이 들어가는 최소 높이 (80px) */
              className={`min-h-20 p-2 border-b border-r border-gray-100 last-of-type:border-r-0 ${
                index % 7 === 6 ? 'border-r-0' : ''
              } ${
                isStartOrEndDate(day.date)
                  ? 'bg-blue-500 text-white'
                  : isDateInRange(day.date)
                  ? 'bg-blue-100'
                  : !selectable
                  ? 'bg-gray-50'
                  : 'bg-white hover:bg-blue-50'
              } ${selectable ? 'cursor-pointer transition' : ''}`}
            >
              <p
                className={`text-sm font-semibold mb-1 ${
                  isStartOrEndDate(day.date)
                    ? 'text-white'
                    : selectable
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
                      - {formatNumber(day.expenseTotal)}
                    </div>
                  )}
                  {day.incomeTotal > 0 && (
                    <div className={`text-xs font-medium truncate ${
                      isStartOrEndDate(day.date) ? 'text-white' : 'text-green-600'
                    }`}>
                      + {formatNumber(day.incomeTotal)}
                    </div>
                  )}
                </div>
              )}

              {day.entries.length > 0 && day.expenseTotal === 0 && day.incomeTotal === 0 && (
                <div className="text-xs text-gray-500">
                  {t('ledger.entryCount', { count: day.entries.length })}
                </div>
              )}
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
