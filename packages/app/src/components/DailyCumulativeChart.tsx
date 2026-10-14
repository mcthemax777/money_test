/*
 * 일별 누적 사용금액. 웹의 같은 그래프를 앱에 옮긴 것이다.
 *
 * 며칠 자리에 어느 값이 서는지는 core 의 buildCumulativeRows 가 정한다(웹과 같은
 * 함수다). 여기 있는 것은 react-native-svg 로 선을 긋는 일과, 눌러서 그 날의
 * 값을 읽는 일뿐이다 -- 웹에서 마우스를 올리면 뜨는 툴팁이 하던 일이다.
 *
 * 달 단위로 보고 있으면 앞선 두 달을 같은 그림에 겹친다. 한 달 총액만 보면 "많이
 * 썼다"는 것을 말일에야 알게 되는데, 같은 날짜끼리 누적을 견주면 달 중간에도
 * 앞서 가는지 알 수 있다.
 */
import { useEffect, useState } from 'react';
import { Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';

import {
  CHART_COLOR,
  CHART_EARLIER_COLOR,
  CHART_PREVIOUS_COLOR,
  lineAxis,
} from '@money/core/lib/chart';
import { monotonePath } from '@money/core/lib/chart-path';
import {
  buildCumulativeRows,
  defaultCumulativeIndex,
  type CumulativeSeries,
  type DailyCumulativePoint,
} from '@money/core/lib/entries';
import { formatCurrency } from '@money/core/lib/money';
import {
  cumulativeLineRange,
  cumulativeReadoutLines,
  type ChangeTone,
  type CumulativeKind,
} from '@money/core/lib/month-compare';
import { useProjectDisplayCurrency } from '@money/core/store/project';

/** 그리는 자리의 높이(px). 웹은 300 이지만 앱에서는 그만큼이 화면 절반을 먹는다. */
const PLOT_HEIGHT = 220;

const AXIS_WIDTH = 48;
const RIGHT_PAD = 14;
const TOP_PAD = 14;
/** X축 이름이 앉는 자리 */
const BOTTOM_PAD = 22;

/** X축에 이름을 몇 개까지 적을지. 서른하루를 다 적으면 글자가 서로 겹친다. */
const MAX_X_LABELS = 6;

const GRID_COLOR = '#e5e7eb';
const AXIS_TEXT_COLOR = '#6b7280';

/** 증감의 색. 나쁨 빨강, 좋음 초록, 그대로나 견줄 것이 없으면 회색 (2026-10-14 사용자 요청). */
const TONE_CLASS: Record<ChangeTone, string> = {
  bad: 'text-red-600',
  good: 'text-green-600',
  neutral: 'text-gray-500',
};
/** 그릴 선. 오래된 달일수록 옅어 눈이 이번 달 선을 먼저 잡는다. */
type SeriesKey = 'earlier' | 'previous' | 'current';

export default function DailyCumulativeChart({
  current,
  comparisons = [],
  currentName,
  currentPeriodKey,
  throughDay,
  tooltipName,
  currentStartKey,
  onOpenDay,
  kind = 'expense',
}: {
  /** 보고 있는 구간의 일별 누적. x축이 이 값의 label 을 따른다. */
  current: DailyCumulativePoint[];
  /** 앞선 달들. 오래된 것부터(전전달, 지난달) 넘긴다. 달 단위로 볼 때만 있다. */
  comparisons?: CumulativeSeries[];
  /** 견줄 달이 있을 때 이번 달 선에 붙일 이름. "8월" */
  currentName?: string;
  /** 이번 기간 선의 열쇠. 주면 아래 줄이 선마다 그 날을 적는다 (웹과 같은 규칙). */
  currentPeriodKey?: string;
  /** 이번 달 선을 그 달의 며칠까지 그을지. 넘기지 않으면 끝까지 그린다. */
  throughDay?: number;
  /** 견줄 달이 없을 때 읽는 줄에 적을 이름 */
  tooltipName: string;
  /** 무엇을 쌓은 선인가. 아래 증감의 색이 갈린다 -- 지출은 늘면 빨강, 수입·순수입은 늘면 초록. */
  kind?: CumulativeKind;
  /** 이번 기간의 첫날 "YYYY-MM-DD". 아래 줄을 눌러 그 날을 열 때 센다. */
  currentStartKey?: string;
  /**
   * 그래프 아래 줄(전전·전·지금)을 누르면 그 선의 첫날부터 그 날까지의 거래 화면을 연다
   * (2026-10-15 사용자 요청 -- 누적이니 그 누적을 이룬 거래다). 그래프를 누르는 것은 날을
   * 고르기만 한다. 주지 않으면 줄은 누를 수 없다.
   */
  onOpenDay?: (range: { from: string; to: string }) => void;
}) {
  const displayCurrency = useProjectDisplayCurrency();

  const [width, setWidth] = useState(0);
  const measure = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  const rows = buildCumulativeRows(current, comparisons, throughDay);

  /** 눌러 둔 날. null 이면 아무것도 읽지 않는다. 처음에는 오늘을 읽고 있다. */
  const [picked, setPicked] = useState<number | null>(() =>
    defaultCumulativeIndex(rows, throughDay),
  );
  // 다른 달로 넘어가면 그 달의 오늘(지난 달이면 말일)로 다시 맞춘다.
  useEffect(() => {
    setPicked(defaultCumulativeIndex(rows, throughDay));
    // rows 는 그릴 때마다 새로 만들어지므로 달을 가르는 값만 본다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [throughDay, currentName, rows.length]);
  const [earlier, previous] = comparisons;

  const plotWidth = Math.max(width - AXIS_WIDTH - RIGHT_PAD, 1);
  const plotHeight = PLOT_HEIGHT - TOP_PAD - BOTTOM_PAD;

  const axis = lineAxis(
    rows
      .flatMap((row) => [row.current, row.previous, row.earlier])
      .filter((value): value is number => value !== null),
    displayCurrency,
  );
  const [bottom, top] = axis.domain;

  const yOf = (value: number) => {
    const ratio = top === bottom ? 0.5 : (value - bottom) / (top - bottom);
    return TOP_PAD + (1 - ratio) * plotHeight;
  };
  /** 칸 사이 간격. 점이 하나뿐이면 나눌 수 없으므로 폭을 통째로 준다. */
  const gap = plotWidth / Math.max(rows.length - 1, 1);
  const xOf = (index: number) => AXIS_WIDTH + gap * index;

  /**
   * 선 하나의 길. 값이 없는 날은 빼고 잇는다.
   *
   * 빠지는 자리는 늘 뒤쪽이다 -- 이번 달 선은 오늘에서 끊기고(throughDay), 앞선
   * 달 선은 그 달이 짧으면 말일에서 끝난다. 그래서 가운데가 비어 선이 건너뛰는
   * 일은 없다.
   */
  const pathOf = (key: SeriesKey) =>
    monotonePath(
      rows
        .map((row, index) => ({ value: row[key], index }))
        .filter((item): item is { value: number; index: number } => item.value !== null)
        .map((item) => ({ x: xOf(item.index), y: yOf(item.value) })),
    );

  const lines: Array<{ key: SeriesKey; name: string; color: string; strokeWidth: number }> = [
    ...(earlier
      ? [
          {
            key: 'earlier' as const,
            name: earlier.name,
            color: CHART_EARLIER_COLOR,
            strokeWidth: 1.5,
          },
        ]
      : []),
    ...(previous
      ? [
          {
            key: 'previous' as const,
            name: previous.name,
            color: CHART_PREVIOUS_COLOR,
            strokeWidth: 1.5,
          },
        ]
      : []),
    {
      key: 'current' as const,
      name: comparisons.length > 0 ? (currentName ?? tooltipName) : tooltipName,
      color: CHART_COLOR,
      strokeWidth: 2,
    },
  ];

  /** X축에 이름을 적을 칸. 너무 촘촘하면 몇 칸씩 건너뛴다. */
  const labelStep = Math.max(1, Math.ceil(rows.length / MAX_X_LABELS));
  const pickedRow = picked !== null && picked < rows.length ? rows[picked] : null;

  if (rows.length === 0) return null;

  return (
    <View>
      <View onLayout={measure}>
        <Pressable
          onPress={(event) => {
            /* 점이 아니라 빈 곳을 눌러도 가장 가까운 칸으로 본다. */
            const index = Math.round((event.nativeEvent.locationX - AXIS_WIDTH) / gap);
            const clamped = Math.min(Math.max(index, 0), rows.length - 1);
            // 같은 칸을 다시 누르면 접는다. 읽고 나서 치우는 길이 있어야 한다.
            setPicked((prev) => (prev === clamped ? null : clamped));
          }}
        >
          <Svg width="100%" height={PLOT_HEIGHT}>
            {axis.ticks.map((tick) => (
              <Line
                key={`grid-${tick}`}
                x1={AXIS_WIDTH}
                y1={yOf(tick)}
                x2={AXIS_WIDTH + plotWidth}
                y2={yOf(tick)}
                stroke={GRID_COLOR}
                strokeWidth={1}
              />
            ))}
            {axis.ticks.map((tick) => (
              <SvgText
                key={`tick-${tick}`}
                x={AXIS_WIDTH - 6}
                y={yOf(tick) + 4}
                fontSize={10}
                fill={AXIS_TEXT_COLOR}
                textAnchor="end"
              >
                {axis.tickFormatter(tick)}
              </SvgText>
            ))}

            {lines.map((line) => (
              <Path
                key={line.key}
                d={pathOf(line.key)}
                stroke={line.color}
                strokeWidth={line.strokeWidth}
                fill="none"
              />
            ))}

            {/* 읽고 있는 자리. 세로선 하나와 선마다 점 하나다. */}
            {pickedRow ? (
              <>
                <Line
                  x1={xOf(picked!)}
                  y1={TOP_PAD}
                  x2={xOf(picked!)}
                  y2={TOP_PAD + plotHeight}
                  stroke={GRID_COLOR}
                  strokeWidth={1}
                />
                {lines.map((line) => {
                  const value = pickedRow[line.key];
                  if (value === null) return null;

                  return (
                    <Circle
                      key={`dot-${line.key}`}
                      cx={xOf(picked!)}
                      cy={yOf(value)}
                      r={4}
                      fill={line.color}
                    />
                  );
                })}
              </>
            ) : null}

            {/* X축 이름 */}
            {rows.map((row, index) =>
              index % labelStep === 0 ? (
                <SvgText
                  key={`label-${index}`}
                  x={xOf(index)}
                  y={PLOT_HEIGHT - 6}
                  fontSize={10}
                  fill={AXIS_TEXT_COLOR}
                  textAnchor="middle"
                >
                  {row.label}
                </SvgText>
              ) : null,
            )}
          </Svg>
        </Pressable>
      </View>

      {/*
        눌러서 읽은 날과 값. 그래프 **아래에** 선마다 한 줄씩(전전, 전, 지금) 적는다 (2026-10-08
        사용자 요청 -- 위에 한 줄로 다 적으니 답답했다). 범례 노릇도 한다. 줄 수는 고른 날과
        상관없이 같아 그래프가 움직이지 않는다 -- 고르지 않았으면 값 자리만 비운다.
        줄의 여백·폭·구분선·글자 크기는 원형 아래 목록(CategoryPieChart)과 같다 (2026-10-14 사용자 요청).
      */}
      <View className="mt-2">
        {/* 선마다 날짜가 붙으면 칸 이름 줄은 군더더기다. 날짜를 붙일 수 없는 보기에만 둔다. */}
        {currentPeriodKey ? null : (
          <Text className="border-b border-gray-100 px-1 py-1.5 text-xs font-semibold text-gray-700">
            {pickedRow?.label ?? ' '}
          </Text>
        )}
        {cumulativeReadoutLines(pickedRow, pickedRow ? picked : null, comparisons, {
          name: lines[lines.length - 1].name,
          periodKey: currentPeriodKey,
        }, kind, displayCurrency).map((item) => {
          const color = lines.find((line) => line.key === item.key)?.color ?? CHART_COLOR;
          /* 그 선에 그 날의 값이 있을 때만 연다. 아직 오지 않은 날이나 짧은 달 끝은 열 날이 없다. */
          const range =
            onOpenDay && currentStartKey && picked !== null && item.value !== null
              ? cumulativeLineRange(item.key, picked, currentStartKey, comparisons)
              : null;
          return (
            <Pressable
              key={item.key}
              onPress={range ? () => onOpenDay!(range) : undefined}
              disabled={!range}
              className="flex-row items-center gap-2 border-b border-gray-100 px-1 py-1.5 active:bg-gray-50"
            >
              <View style={{ width: 10, height: 2, backgroundColor: color, borderRadius: 1 }} />
              <Text className="shrink text-sm text-gray-600" numberOfLines={1}>
                {item.name}
              </Text>
              {/* 금액은 검정으로 통일한다. 어느 선인지는 왼쪽 색 막대가 말한다 (2026-10-14 사용자 요청). */}
              <Text className="ml-auto text-sm font-semibold text-gray-900">
                {item.value === null ? '-' : formatCurrency(item.value, displayCurrency)}
              </Text>
              {/* 증감 자리는 늘 둔다. 줄마다 금액의 오른쪽 끝이 맞아야 위아래로 견주기 쉽다. */}
              <Text className={`text-right text-xs ${TONE_CLASS[item.tone]}`} style={{ minWidth: 48 }}>
                {item.change ?? ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
