'use client';

import { useMemo } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

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
import { useProjectDisplayCurrency } from '@/store/project';

/** buildDailyCumulative 한 점 */
export interface DailyCumulativePoint {
  label: string;
  amount: number;
  cumulative: number;
}

/** 겹쳐 그릴 앞선 달 하나 */
export interface CumulativeSeries {
  /** 범례에 적을 이름. "7월" */
  name: string;
  points: DailyCumulativePoint[];
}

interface Props {
  /** 보고 있는 구간의 일별 누적. x축이 이 값의 label을 따른다. */
  current: DailyCumulativePoint[];
  /**
   * 앞선 달들. 오래된 것부터(전전달, 지난달) 넘긴다.
   *
   * 달 단위로 볼 때만 넘긴다. 기간을 직접 정하면 견줄 "지난 기간"이 없다.
   * 열흘짜리 구간의 지난달은 한 달인지 같은 열흘인지 정해지지 않는다.
   */
  comparisons?: CumulativeSeries[];
  /** 견줄 달이 있을 때 이번 달 선에 붙일 이름. "8월" */
  currentName?: string;
  /**
   * 이번 달 선을 어디까지 그을지 (그 달의 며칠). 넘기지 않으면 끝까지 그린다.
   *
   * 오늘 이후는 쓴 적이 없는 것이 아니라 아직 오지 않은 날이다. 평평하게 이어
   * 그리면 앞선 달 선 아래에 붙어 "이번 달은 덜 썼다"로 잘못 읽힌다.
   */
  throughDay?: number;
  /** 견줄 달이 없을 때 툴팁에 적을 이름 */
  tooltipName: string;
  height: number;
}

/**
 * 일별 누적 사용금액.
 *
 * 분류별·수단별 상세가 함께 쓴다. 달 단위로 보고 있으면 앞선 두 달을 같은 그림에
 * 겹친다. 한 달 총액만 보면 "많이 썼다"는 것을 말일에야 알게 되는데, 같은 날짜끼리
 * 누적을 견주면 달 중간에도 앞서 가는지 알 수 있다. 홈의 지출 그래프와 같은 규칙이다.
 */
export default function DailyCumulativeChart({
  current,
  comparisons = [],
  currentName,
  throughDay,
  tooltipName,
  height,
}: Props) {
  const displayCurrency = useProjectDisplayCurrency();
  const [earlier, previous] = comparisons;

  const rows = useMemo(() => {
    const length = Math.max(current.length, ...comparisons.map((c) => c.points.length), 0);
    const drawUntil = throughDay ?? current.length;

    return Array.from({ length }, (_, index) => ({
      // 앞선 달이 이 달보다 길면(31일 vs 30일) 이 달에는 없는 날이 생긴다.
      // 견주기는 달 단위에서만 하므로 그 자리의 이름은 날짜 그대로다.
      label: current[index]?.label ?? `${index + 1}일`,
      current: index < drawUntil ? (current[index]?.cumulative ?? null) : null,
      previous: previous?.points[index]?.cumulative ?? null,
      earlier: earlier?.points[index]?.cumulative ?? null,
    }));
  }, [current, comparisons, previous, earlier, throughDay]);

  const axis = lineAxis(
    rows
      .flatMap((row) => [row.current, row.previous, row.earlier])
      .filter((value): value is number => value !== null),
    displayCurrency,
  );

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={CHART_MARGIN}>
        <CartesianGrid {...CHART_GRID} />
        <XAxis dataKey="label" tick={CHART_TICK} />
        {/* 꺾은선은 값이 움직인 구간만 그린다 (lineAxis 주석 참고) */}
        <YAxis
          domain={axis.domain}
          ticks={axis.ticks}
          tickFormatter={axis.tickFormatter}
          tick={CHART_TICK}
          width={CHART_Y_AXIS_WIDTH}
        />
        <Tooltip
          contentStyle={CHART_TOOLTIP_STYLE}
          formatter={(value, name) => formatTooltipAmount(value, name as string, displayCurrency)}
        />
        {/* 선이 하나뿐이면 범례를 지운다. 툴팁이 같은 이름을 보여 준다. */}
        {comparisons.length > 0 && <Legend />}
        {/* 오래된 달일수록 옅어 눈이 이번 달 선을 먼저 잡는다. */}
        {earlier && (
          <Line
            type="monotone"
            dataKey="earlier"
            name={earlier.name}
            stroke={CHART_EARLIER_COLOR}
            dot={false}
            activeDot={CHART_ACTIVE_DOT}
          />
        )}
        {previous && (
          <Line
            type="monotone"
            dataKey="previous"
            name={previous.name}
            stroke={CHART_PREVIOUS_COLOR}
            dot={false}
            activeDot={CHART_ACTIVE_DOT}
          />
        )}
        <Line
          type="monotone"
          dataKey="current"
          name={comparisons.length > 0 ? (currentName ?? tooltipName) : tooltipName}
          stroke={CHART_COLOR}
          strokeWidth={2}
          dot={false}
          activeDot={CHART_ACTIVE_DOT}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
