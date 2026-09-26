/*
 * 12개월 추이 막대. 웹 분류 상세의 같은 그래프를 앱에 옮긴 것이다. 요일별·시간대별
 * 평균도 같은 막대라 이것으로 그린다 (X축 이름을 어디에 적을지만 다르다).
 *
 * 그릴 값은 core 의 useCategoryDetail 이 준다. 여기 있는 것은 react-native-svg 로
 * 그리는 일과, 막대를 눌러 그 달의 금액을 읽는 일뿐이다 (웹에서 마우스를 올리면
 * 뜨는 툴팁이 하던 일이다).
 */
import { useState } from 'react';
import { Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';

import { CHART_COLOR, barDomain, barTicks, formatAxisAmount } from '@money/core/lib/chart';
import type { BarPoint } from '@money/core/lib/usage-pattern';
import { formatCurrency } from '@money/core/lib/money';

/** 그리는 자리의 높이(px). 웹은 300 이지만 앱에서는 그만큼이 화면 절반을 먹는다. */
const PLOT_HEIGHT = 200;

/** 축과 여백이 먹는 폭(px). 눈금 글자가 "1,000.5만"까지 길어지므로 넉넉히 잡는다. */
const AXIS_WIDTH = 48;
const RIGHT_PAD = 10;
const TOP_PAD = 16;
/** X축 이름이 앉는 자리 */
const BOTTOM_PAD = 20;

/** 막대가 제 칸에서 차지하는 비율. 나머지는 이웃과의 사이 틈이다. */
const BAR_RATIO = 0.62;

const GRID_COLOR = '#e5e7eb';
const AXIS_TEXT_COLOR = '#6b7280';

/**
 * 열두 달은 다 적으면 글자가 겹치므로 한 칸 걸러 적는다. 마지막 달(= 보고 있는 달)
 * 부터 거꾸로 세므로 그 달은 늘 적힌다.
 */
const everyOtherFromEnd = (index: number, count: number) => (count - 1 - index) % 2 === 0;

export default function MonthlyAmountChart({
  points,
  currency,
  showAxisLabel = everyOtherFromEnd,
}: {
  points: BarPoint[];
  /** 금액의 통화. 축과 읽는 줄이 함께 쓴다. */
  currency: string;
  /** 몇 번째 막대 밑에 이름을 적을지. 적지 않은 막대도 눌러서 이름을 읽는다. */
  showAxisLabel?: (index: number, count: number) => boolean;
}) {
  /** 그리는 자리의 폭. 화면 크기에 따라 달라 그려진 뒤 잰다. */
  const [width, setWidth] = useState(0);
  const measure = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  /** 눌러 둔 막대. 축은 "12.3만"으로 줄여 적으므로 정확한 금액은 눌러서 읽는다. */
  const [picked, setPicked] = useState<number | null>(null);

  const plotWidth = Math.max(width - AXIS_WIDTH - RIGHT_PAD, 1);
  const plotHeight = PLOT_HEIGHT - TOP_PAD - BOTTOM_PAD;
  const slot = plotWidth / Math.max(points.length, 1);
  const barWidth = slot * BAR_RATIO;

  const [bottom, top] = barDomain(points.map((point) => point.amount));
  const ticks = barTicks(bottom, top);

  const yOf = (value: number) => {
    const ratio = top === bottom ? 0 : (value - bottom) / (top - bottom);
    return TOP_PAD + (1 - ratio) * plotHeight;
  };
  /** 막대가 서는 바닥. 금액이 음수인 달이 있으면 0선이 축 위로 올라온다. */
  const baseY = yOf(Math.max(bottom, 0));
  const centerOf = (index: number) => AXIS_WIDTH + slot * (index + 0.5);

  const pickedPoint = picked !== null && picked < points.length ? points[picked] : null;

  return (
    <View>
      {/*
        눌러서 읽은 값. 자리를 늘 비워 둔다 -- 눌렀을 때만 줄이 생기면 그래프가
        아래로 밀려 손가락 밑에서 막대가 움직인다.
      */}
      <View className="h-6 flex-row items-center justify-between gap-2">
        {pickedPoint ? (
          <>
            <Text className="shrink text-xs text-gray-500" numberOfLines={1}>
              {pickedPoint.label}
            </Text>
            <Text className="text-xs font-semibold text-gray-900">
              {formatCurrency(pickedPoint.amount, currency)}
            </Text>
          </>
        ) : (
          <View className="flex-1" />
        )}
      </View>

      <View onLayout={measure}>
        <Pressable
          onPress={(event) => {
            const index = Math.floor((event.nativeEvent.locationX - AXIS_WIDTH) / slot);
            if (index < 0 || index >= points.length) return;
            // 같은 막대를 다시 누르면 접는다. 읽고 나서 치우는 길이 있어야 한다.
            setPicked((prev) => (prev === index ? null : index));
          }}
        >
          <Svg width="100%" height={PLOT_HEIGHT}>
            {ticks.map((tick) => (
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
            {ticks.map((tick) => (
              <SvgText
                key={`tick-${tick}`}
                x={AXIS_WIDTH - 6}
                y={yOf(tick) + 4}
                fontSize={10}
                fill={AXIS_TEXT_COLOR}
                textAnchor="end"
              >
                {formatAxisAmount(tick, currency)}
              </SvgText>
            ))}

            {points.map((point, index) => {
              const valueY = yOf(point.amount);

              return (
                <Rect
                  key={`bar-${point.label}-${index}`}
                  x={centerOf(index) - barWidth / 2}
                  y={Math.min(valueY, baseY)}
                  width={barWidth}
                  height={Math.abs(valueY - baseY)}
                  rx={3}
                  fill={CHART_COLOR}
                  /* 눌러 둔 막대만 진하게. 어느 달을 읽고 있는지 그림에도 표가 나야 한다. */
                  fillOpacity={picked === null || picked === index ? 1 : 0.45}
                />
              );
            })}

            {/* X축 이름. 어느 막대에 적을지는 showAxisLabel 이 정한다. */}
            {points.map((point, index) =>
              showAxisLabel(index, points.length) ? (
                <SvgText
                  key={`label-${point.label}-${index}`}
                  x={centerOf(index)}
                  y={PLOT_HEIGHT - 6}
                  fontSize={10}
                  fill={AXIS_TEXT_COLOR}
                  textAnchor="middle"
                >
                  {point.label}
                </SvgText>
              ) : null,
            )}
          </Svg>
        </Pressable>
      </View>
    </View>
  );
}
