'use client';

import { useMemo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ReportDto } from '@money/types';

import {
  CHART_ACTIVE_DOT,
  CHART_COLOR,
  CHART_EARLIER_COLOR,
  CHART_GRID,
  CHART_MARGIN,
  CHART_PREVIOUS_COLOR,
  CHART_TICK,
  CHART_TOOLTIP_STYLE,
  CHART_Y_AXIS_WIDTH,
  formatTooltipAmount,
  lineAxis,
} from '@/lib/chart';
import { formatCurrency, toNumber } from '@/lib/money';
import { useProjectDisplayCurrency } from '@/store/project';

/** 어느 지출을 세는지. total은 일반과 과소비를 합한 값이다. */
export type ExpenseField = 'normal' | 'extra' | 'total';

interface CumulativeExpenseChartProps {
  title: string;
  /**
   * 지출인지 수입인지.
   *
   * 그리는 방법은 같고, 지난달보다 늘어난 것이 나쁜 일인지(지출) 좋은 일인지
   * (수입)만 갈린다. 늘어난 수입에 빨간 글씨를 붙이면 뜻이 뒤집힌다.
   */
  type: 'income' | 'expense';
  /** 일반, 과소비(수입이면 추가 수입), 또는 둘을 합한 전체 */
  field: ExpenseField;
  /** 보고 있는 달 "YYYY-MM" */
  yearMonth: string;
  points: ReportDto.DailyExpensePoint[];
  previousYearMonth: string;
  previousPoints: ReportDto.DailyExpensePoint[];
  /** 전전달. 지난달 하나만 겹치면 그 달이 유난했던 것인지 알 수 없다. */
  earlierYearMonth: string;
  earlierPoints: ReportDto.DailyExpensePoint[];
  /**
   * 이번 달 선을 어디까지 그을지 (그 달의 며칠).
   *
   * 오늘 이후는 쓴 적이 없는 것이 아니라 아직 오지 않은 날이다. 0으로 이어 그리면
   * 선이 평평해져 "이번 달은 여기서 멈췄다"로 읽힌다.
   */
  throughDay: number;
}

/** "YYYY-MM"의 날짜 수 */
function daysInMonth(yearMonth: string): number {
  const [year, month] = yearMonth.split('-').map(Number);
  // month는 1-based다. 다음 달의 0일 = 이 달의 말일.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 날짜별 금액을 1일부터의 누적으로. 거래가 없는 날은 앞 날의 값을 잇는다. */
function cumulativeByDay(
  points: ReportDto.DailyExpensePoint[],
  field: ExpenseField,
  days: number,
): number[] {
  const amountOfDay = new Map<number, number>();
  for (const point of points) {
    const day = Number(point.date.slice(8, 10));
    // 전체는 서버가 따로 주지 않는다. 두 값을 합친 것이 그날의 지출이다.
    const amount =
      field === 'total'
        ? toNumber(point.normal) + toNumber(point.extra)
        : toNumber(point[field]);
    amountOfDay.set(day, (amountOfDay.get(day) ?? 0) + amount);
  }

  const result: number[] = [];
  let running = 0;
  for (let day = 1; day <= days; day += 1) {
    running += amountOfDay.get(day) ?? 0;
    result.push(running);
  }
  return result;
}

/**
 * 이 달과 지난달의 누적 지출(또는 수입)을 겹쳐 그린다.
 *
 * 한 달 총액만 보면 "많이 썼다"는 것을 말일에야 알게 된다. 같은 날짜끼리 누적을
 * 견주면 달 중간에도 지난달보다 앞서 가는지 알 수 있다.
 */
export default function CumulativeExpenseChart({
  title,
  type,
  field,
  yearMonth,
  points,
  previousYearMonth,
  previousPoints,
  earlierYearMonth,
  earlierPoints,
  throughDay,
}: CumulativeExpenseChartProps) {
  const displayCurrency = useProjectDisplayCurrency();

  const { rows, current, previous } = useMemo(() => {
    const days = daysInMonth(yearMonth);
    const previousDays = daysInMonth(previousYearMonth);
    const earlierDays = daysInMonth(earlierYearMonth);
    const currentSeries = cumulativeByDay(points, field, days);
    const previousSeries = cumulativeByDay(previousPoints, field, previousDays);
    const earlierSeries = cumulativeByDay(earlierPoints, field, earlierDays);

    /*
     * 0일부터 그린다. 누적은 아무것도 쓰지 않은 0에서 출발하는 값이라, 1일의 지출이
     * 0에서 올라가는 선으로 보여야 한다. 1일부터 그리면 첫 날 지출만큼 이미 올라간
     * 자리에서 선이 시작해 그만큼을 놓친다.
     */
    const rows = Array.from(
      { length: Math.max(days, previousDays, earlierDays) + 1 },
      (_, day) => {
        if (day === 0) return { day, current: 0, previous: 0, earlier: 0 };
        return {
          day,
          current: day <= Math.min(throughDay, days) ? currentSeries[day - 1] : null,
          previous: day <= previousDays ? previousSeries[day - 1] : null,
          earlier: day <= earlierDays ? earlierSeries[day - 1] : null,
        };
      },
    );

    return {
      rows,
      current: currentSeries[Math.min(throughDay, days) - 1] ?? 0,
      // 같은 날짜까지의 지난달. 달 중간에는 지난달 총액과 견주면 늘 적게 나온다.
      previous: previousSeries[Math.min(throughDay, previousDays) - 1] ?? 0,
    };
  }, [
    points,
    previousPoints,
    earlierPoints,
    field,
    yearMonth,
    previousYearMonth,
    earlierYearMonth,
    throughDay,
  ]);

  const axis = lineAxis(
    // 0을 넣어 축이 바닥에서 시작하게 한다. 누적은 0에서 출발하는 값이다.
    [
      0,
      ...rows
        .flatMap((row) => [row.current, row.previous, row.earlier])
        .filter((v): v is number => v !== null),
    ],
    displayCurrency,
  );
  const difference = current - previous;
  /*
   * 지난달보다 나쁜 쪽인지.
   *
   * 지출은 늘어난 것이, 수입은 줄어든 것이 나쁜 쪽이다. 한 색으로 고정하면 수입
   * 그래프에서 "지난달보다 더 벌었다"에 빨간 글씨가 붙는다.
   */
  const isWorse = type === 'expense' ? difference > 0 : difference < 0;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        <p className="text-sm text-gray-600">
          <span className="font-semibold text-gray-900 tabular-nums">
            {formatCurrency(current, displayCurrency)}
          </span>{' '}
          · 지난달 같은 기간{' '}
          <span className="tabular-nums">{formatCurrency(previous, displayCurrency)}</span>{' '}
          <span className={isWorse ? 'text-red-600' : 'text-blue-600'}>
            ({difference > 0 ? '+' : ''}
            {formatCurrency(difference, displayCurrency)})
          </span>
        </p>
      </div>

      <div className="mt-3 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={CHART_MARGIN}>
            <CartesianGrid {...CHART_GRID} />
            <XAxis
              dataKey="day"
              tick={CHART_TICK}
              // 0은 달이 시작하기 전 자리다. "0일"이라는 날은 없다.
              tickFormatter={(day) => (day === 0 ? '0' : `${day}일`)}
            />
            <YAxis
              width={CHART_Y_AXIS_WIDTH}
              tick={CHART_TICK}
              domain={axis.domain}
              ticks={axis.ticks}
              tickFormatter={axis.tickFormatter}
            />
            <Tooltip
              contentStyle={CHART_TOOLTIP_STYLE}
              labelFormatter={(day) => (day === 0 ? '월초' : `${day}일`)}
              formatter={(value, name) =>
                formatTooltipAmount(value, name as string, displayCurrency)
              }
            />
            <Legend />
            {/* 셋 다 실선이다. 오래된 달일수록 옅어 눈이 이번 달 선을 먼저 잡는다. */}
            <Line
              type="monotone"
              dataKey="earlier"
              name={`${Number(earlierYearMonth.slice(5))}월`}
              stroke={CHART_EARLIER_COLOR}
              dot={false}
              activeDot={CHART_ACTIVE_DOT}
            />
            <Line
              type="monotone"
              dataKey="previous"
              name={`${Number(previousYearMonth.slice(5))}월`}
              stroke={CHART_PREVIOUS_COLOR}
              dot={false}
              activeDot={CHART_ACTIVE_DOT}
            />
            <Line
              type="monotone"
              dataKey="current"
              name={`${Number(yearMonth.slice(5))}월`}
              stroke={CHART_COLOR}
              strokeWidth={2}
              dot={false}
              activeDot={CHART_ACTIVE_DOT}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
