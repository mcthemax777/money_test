'use client';

interface MonthHeaderProps {
  year: number;
  month: number;
  incomeTotal: number;
  expenseTotal: number;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}

export default function MonthHeader({
  year,
  month,
  incomeTotal,
  expenseTotal,
  onPrevMonth,
  onNextMonth,
}: MonthHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-6">
        <h2 className="text-2xl font-bold text-gray-900">
          {year}년 {month}월
        </h2>
        <div className="flex gap-6 text-sm font-semibold">
          {incomeTotal > 0 && (
            <span className="text-green-600">
              +{new Intl.NumberFormat('ko-KR', {
                style: 'currency',
                currency: 'KRW',
              }).format(incomeTotal)}
            </span>
          )}
          {expenseTotal > 0 && (
            <span className="text-red-600">
              -{new Intl.NumberFormat('ko-KR', {
                style: 'currency',
                currency: 'KRW',
              }).format(expenseTotal)}
            </span>
          )}
        </div>
      </div>
      <div className="flex gap-3">
        <button
          onClick={onPrevMonth}
          className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition"
          title="이전 달"
        >
          <span className="text-xl">←</span>
        </button>
        <button
          onClick={onNextMonth}
          className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition"
          title="다음 달"
        >
          <span className="text-xl">→</span>
        </button>
      </div>
    </div>
  );
}
