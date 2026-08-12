'use client';

import { useState, useMemo } from 'react';

interface Transaction {
  id: string;
  description: string;
  amount: number;
  type: 'income' | 'expense' | 'transfer';
  date: string;
  mainCategory: string;
  mainCategoryId?: string;
  subCategory?: string;
  subCategoryId?: string;
  accountId?: string;
  cardId?: string;
  personId?: string;
}

interface CalendarDay {
  date: Date;
  isCurrentMonth: boolean;
  transactions: Transaction[];
  expenseTotal: number;
  incomeTotal: number;
}

interface Props {
  transactions: Transaction[];
  onDateSelect: (date: Date, transactions: Transaction[]) => void;
  onMonthChange?: (year: number, month: number) => void;
  startDate?: Date | null;
  endDate?: Date | null;
}

export default function TransactionCalendar({
  transactions,
  onDateSelect,
  onMonthChange,
  startDate,
  endDate,
}: Props) {
  const [currentDate, setCurrentDate] = useState(new Date());

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
      const dayTransactions = transactions.filter(
        (tx) => tx.date.split('T')[0] === dateStr
      );

      const expenseTotal = dayTransactions
        .filter((tx) => tx.type === 'expense')
        .reduce((sum, tx) => sum + tx.amount, 0);

      const incomeTotal = dayTransactions
        .filter((tx) => tx.type === 'income')
        .reduce((sum, tx) => sum + tx.amount, 0);

      calendarDays.push({
        date: new Date(currentDay),
        isCurrentMonth: currentDay.getMonth() === month,
        transactions: dayTransactions,
        expenseTotal,
        incomeTotal,
      });

      currentDay.setDate(currentDay.getDate() + 1);
    }

    return calendarDays;
  }, [currentDate, transactions]);

  const handlePrevMonth = () => {
    const newDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1);
    setCurrentDate(newDate);
    onMonthChange?.(newDate.getFullYear(), newDate.getMonth() + 1);
  };

  const handleNextMonth = () => {
    const newDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1);
    setCurrentDate(newDate);
    onMonthChange?.(newDate.getFullYear(), newDate.getMonth() + 1);
  };

  const handleToday = () => {
    const today = new Date();
    setCurrentDate(today);
    onMonthChange?.(today.getFullYear(), today.getMonth() + 1);
  };

  const weekDays = ['일', '월', '화', '수', '목', '금', '토'];

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold text-gray-900">
          {currentDate.getFullYear()}년 {currentDate.getMonth() + 1}월
        </h2>
        <div className="flex gap-3">
          <button
            onClick={handlePrevMonth}
            className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition"
            title="이전 달"
          >
            <span className="text-xl">←</span>
          </button>
          <button
            onClick={handleNextMonth}
            className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition"
            title="다음 달"
          >
            <span className="text-xl">→</span>
          </button>
        </div>
      </div>

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
                  onDateSelect(day.date, day.transactions);
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

              {day.transactions.length > 0 && day.expenseTotal === 0 && day.incomeTotal === 0 && (
                <div className="text-xs text-gray-500">
                  {day.transactions.length}건
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
