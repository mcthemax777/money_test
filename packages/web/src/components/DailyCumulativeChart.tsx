'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
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
  CHART_Y_AXIS_WIDTH,
  lineAxis,
} from '@money/core/lib/chart';
import {
  buildCumulativeRows,
  defaultCumulativeIndex,
  type CumulativeSeries,
  type DailyCumulativePoint,
} from '@money/core/lib/entries';
import { formatCurrency } from '@money/core/lib/money';
import { cumulativeReadoutLines } from '@money/core/lib/month-compare';
import { useProjectDisplayCurrency } from '@money/core/store/project';

/** 선마다의 색. 오래된 기간일수록 옅어 눈이 지금 선을 먼저 잡는다. */
const LINE_COLOR = {
  earlier: CHART_EARLIER_COLOR,
  previous: CHART_PREVIOUS_COLOR,
  current: CHART_COLOR,
} as const;

/*
 * 그리는 값의 모양은 만드는 쪽(core의 buildDailyCumulative)에 있다. 이 화면을
 * 거쳐 가져다 쓰던 곳이 많아 이름은 여기서도 그대로 내보낸다.
 */
export type { CumulativeSeries, DailyCumulativePoint };

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
   * 이번 기간 선의 열쇠. 주면 아래 줄이 선마다 그 날을 적는다("10월 1주차 목요일"). 견줄 기간이
   * 없는 보기(직접 정한 기간)는 주지 않는다 -- 그때는 칸 이름 한 줄과 선 이름이다.
   */
  currentPeriodKey?: string;
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
  currentPeriodKey,
  throughDay,
  tooltipName,
  height,
}: Props) {
  const displayCurrency = useProjectDisplayCurrency();
  const [earlier, previous] = comparisons;

  /* 줄을 만드는 규칙은 core 에 둔다. 앱의 같은 그래프가 그대로 쓴다. */
  const rows = useMemo(
    () => buildCumulativeRows(current, comparisons, throughDay),
    [current, comparisons, throughDay],
  );

  const defaultIndex = defaultCumulativeIndex(rows, throughDay);
  /**
   * 읽고 있는 날. 마우스를 올리거나 누른 칸이고, 처음에는 오늘(지난 기간이면 끝날)이다.
   * 마우스가 그래프를 떠나도 남긴다 -- 아래 줄을 읽으러 내려가는 동안 값이 사라지면 안 된다.
   */
  const [picked, setPicked] = useState<number | null>(defaultIndex);
  // 다른 기간으로 넘어가면 그 기간의 오늘로 다시 맞춘다.
  useEffect(() => {
    setPicked(defaultIndex);
  }, [defaultIndex, currentName, rows.length]);
  const pickedRow = picked !== null && picked < rows.length ? rows[picked] : null;
  const pickFrom = (state: { activeTooltipIndex?: unknown } | null | undefined) => {
    const index = Number(state?.activeTooltipIndex);
    if (Number.isInteger(index) && index >= 0) setPicked(index);
  };
  const currentLineName = comparisons.length > 0 ? (currentName ?? tooltipName) : tooltipName;

  const axis = lineAxis(
    rows
      .flatMap((row) => [row.current, row.previous, row.earlier])
      .filter((value): value is number => value !== null),
    displayCurrency,
  );

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart
          data={rows}
          margin={CHART_MARGIN}
          onMouseMove={pickFrom}
          /* 터치 화면에는 마우스 움직임이 없다. 누른 칸을 읽는다. */
          onClick={pickFrom}
        >
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
          {/*
          값은 툴팁 상자 대신 아래 줄에 적는다(그림 위를 가리지 않게). 툴팁은 세로선과 점만
          남긴다. 처음부터 오늘을 짚고 있고, 기간이 바뀌면 key 로 새로 붙여 그 기간의 오늘로 맞춘다.
        */}
          <Tooltip
            key={`${currentName ?? ''}-${defaultIndex ?? ''}`}
            defaultIndex={defaultIndex ?? undefined}
            content={() => null}
          />
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
            name={currentLineName}
            stroke={CHART_COLOR}
            strokeWidth={2}
            dot={false}
            activeDot={CHART_ACTIVE_DOT}
          />
        </LineChart>
      </ResponsiveContainer>
      {/*
        읽고 있는 날의 값. 선마다 한 줄씩(전전, 전, 지금) 아래에 적는다 (2026-10-08 사용자 요청,
        앱과 같은 모양). 범례 노릇도 한다. 줄 수가 늘 같아 고르는 동안 아래가 출렁이지 않는다.
      */}
      <div className="mt-2 space-y-1 px-4 text-sm">
        {/* 선마다 날짜가 붙으면 칸 이름 줄은 군더더기다. 날짜를 붙일 수 없는 보기에만 둔다. */}
        {currentPeriodKey ? null : (
          <p className="text-xs font-semibold text-gray-700">{pickedRow?.label ?? '\u00a0'}</p>
        )}
        {cumulativeReadoutLines(pickedRow, pickedRow ? picked : null, comparisons, {
          name: currentLineName,
          periodKey: currentPeriodKey,
        }).map((item) => (
          <div key={item.key} className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-0.5 w-3 shrink-0 rounded"
              style={{ backgroundColor: LINE_COLOR[item.key] }}
            />
            <span className="truncate text-gray-600">{item.name}</span>
            <span className="ml-auto font-semibold" style={{ color: LINE_COLOR[item.key] }}>
              {item.value === null ? '-' : formatCurrency(item.value, displayCurrency)}
            </span>
            {/* 증감 자리는 늘 둔다. 줄마다 금액의 오른쪽 끝이 맞아야 위아래로 견주기 쉽다. */}
            <span className="min-w-16 text-right text-xs text-gray-500">{item.change ?? ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
