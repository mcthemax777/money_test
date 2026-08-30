'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  currentYearMonth,
  formatMonthShort,
  formatYearMonth,
  formatYearOnly,
} from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency } from '@money/core/lib/money';
import { useProjectDisplayCurrency, useProjectTimeZone } from '@money/core/store/project';

interface MonthHeaderProps {
  year: number;
  month: number;
  incomeTotal: number;
  expenseTotal: number;
  /** 화살표와 년월 선택 모두 이 하나로 처리한다. */
  onMonthChange: (year: number, month: number) => void;
  /** 같은 줄 오른쪽 끝에 붙일 것 (탭, 추가 버튼 등) */
  right?: React.ReactNode;

  /*
   * 기간 보기.
   *
   * 달력의 달과 어긋나는 구간(카드 청구주기, 여행 기간)을 보려면 달 이동만으로는
   * 안 된다. 아래 값들을 넘기면 "기간" 전환 버튼이 붙고, 켜면 달 이동 대신
   * 날짜 두 개를 받는다. 넘기지 않으면 예전처럼 달 이동만 있다.
   */
  rangeStart?: string;
  rangeEnd?: string;
  isRangeMode?: boolean;
  /** 시작일·종료일이 바뀔 때. 둘 다 채워져야 조회가 바뀐다. */
  onRangeChange?: (start: string, end: string) => void;
  /** 달 보기 <-> 기간 보기 전환 */
  onPeriodModeChange?: (mode: 'month' | 'range') => void;
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export default function MonthHeader({
  year,
  month,
  incomeTotal,
  expenseTotal,
  onMonthChange,
  right,
  rangeStart = '',
  rangeEnd = '',
  isRangeMode = false,
  onRangeChange,
  onPeriodModeChange,
}: MonthHeaderProps) {
  const { t } = useTranslation();
  const timeZone = useProjectTimeZone();
  const displayCurrency = useProjectDisplayCurrency();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  // 선택기 안에서 보고 있는 연도. 실제 선택과 분리해야 12월에서 다음 해를 훑어볼 수 있다.
  const [pickerYear, setPickerYear] = useState(year);
  const ref = useRef<HTMLDivElement>(null);

  // Date 생성자가 연도 넘김을 처리하므로 12월/1월을 따로 분기하지 않는다.
  const shift = (delta: number) => {
    const shifted = new Date(year, month - 1 + delta, 1);
    onMonthChange(shifted.getFullYear(), shifted.getMonth() + 1);
  };

  const openPicker = () => {
    // 닫았다 열 때 이전에 훑어보던 연도가 남아 있으면 안 된다. 현재 선택으로 되돌린다.
    setPickerYear(year);
    setIsPickerOpen(true);
  };

  useEffect(() => {
    if (!isPickerOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsPickerOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsPickerOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPickerOpen]);

  // "이번 달" 판단은 프로젝트 타임존 기준이다.
  const { year: thisYear, month: thisMonth } = currentYearMonth(timeZone);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-6">
        {isRangeMode ? (
          /* 기간 보기. 달을 넘어가는 구간을 직접 정한다. */
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={rangeStart}
              max={rangeEnd || undefined}
              onChange={(e) => onRangeChange?.(e.target.value, rangeEnd)}
              className="px-2 py-1 border border-gray-300 rounded-lg text-sm"
            />
            <span className="text-gray-500">~</span>
            <input
              type="date"
              value={rangeEnd}
              min={rangeStart || undefined}
              onChange={(e) => onRangeChange?.(rangeStart, e.target.value)}
              className="px-2 py-1 border border-gray-300 rounded-lg text-sm"
            />
            <button
              type="button"
              onClick={() => onPeriodModeChange?.('month')}
              className="px-3 py-1 text-sm border rounded-lg text-gray-700 hover:bg-gray-100"
            >
              {t('month.byMonth')}
            </button>
          </div>
        ) : (
        /* 화살표는 년월 텍스트 양옆에 붙는다 */
        <div ref={ref} className="relative flex items-center gap-1">
          <button
            type="button"
            onClick={() => shift(-1)}
            className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition"
            aria-label={t('month.prev')}
            title={t('month.prev')}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => (isPickerOpen ? setIsPickerOpen(false) : openPicker())}
            className="px-2 py-1 text-2xl font-bold text-gray-900 rounded-lg hover:bg-gray-100 transition"
            aria-haspopup="dialog"
            aria-expanded={isPickerOpen}
            title={t('month.pick')}
          >
            {formatYearMonth(year, month)}
          </button>

          <button
            type="button"
            onClick={() => shift(1)}
            className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition"
            aria-label={t('month.next')}
            title={t('month.next')}
          >
            <ChevronRight className="w-5 h-5" />
          </button>

          {isPickerOpen && (
            <div className="absolute top-full left-0 mt-2 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-20 p-3">
              {/* 연도 이동 */}
              <div className="flex items-center justify-between mb-3">
                <button
                  type="button"
                  onClick={() => setPickerYear((y) => y - 1)}
                  className="p-1 px-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition"
                  aria-label={t('month.prevYear')}
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="font-semibold text-gray-900">{formatYearOnly(pickerYear)}</span>
                <button
                  type="button"
                  onClick={() => setPickerYear((y) => y + 1)}
                  className="p-1 px-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition"
                  aria-label={t('month.nextYear')}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-4 gap-1">
                {MONTHS.map((m) => {
                  const isSelected = pickerYear === year && m === month;
                  const isThisMonth = pickerYear === thisYear && m === thisMonth;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        onMonthChange(pickerYear, m);
                        setIsPickerOpen(false);
                      }}
                      className={`py-2 text-sm rounded transition ${
                        isSelected
                          ? 'bg-blue-600 text-white font-semibold'
                          : isThisMonth
                            ? 'text-blue-600 font-semibold hover:bg-blue-50'
                            : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {formatMonthShort(m)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 달을 넘어가는 구간을 보려면 여기서 전환한다. */}
          {onPeriodModeChange && (
            <button
              type="button"
              onClick={() => onPeriodModeChange('range')}
              className="ml-2 px-3 py-1 text-sm border rounded-lg text-gray-700 hover:bg-gray-100"
            >
              {t('month.byRange')}
            </button>
          )}
        </div>
        )}

        <div className="flex gap-6 text-sm font-semibold">
          {incomeTotal > 0 && (
            <span className="text-green-600">+{formatCurrency(incomeTotal, displayCurrency)}</span>
          )}
          {expenseTotal > 0 && (
            <span className="text-red-600">-{formatCurrency(expenseTotal, displayCurrency)}</span>
          )}
        </div>
      </div>

      {right && <div className="flex items-center gap-3">{right}</div>}
    </div>
  );
}
