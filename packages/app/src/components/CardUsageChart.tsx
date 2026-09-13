/*
 * 주기별 사용액 막대. 웹의 같은 그래프를 앱에 옮긴 것이다.
 *
 * 어느 막대가 어떤 색이고 창이 어디에 놓이는지는 core 의 useCardUsageWindow 가
 * 정한다. 여기 있는 것은 react-native-svg 로 그리는 일과, 손가락을 받는 일뿐이다 --
 * 좌우로 끌면 창이 주기 위를 미끄러지고, 막대를 누르면 그 주기의 값을 읽는다.
 */
import { useRef, useState } from 'react';
import {
  PanResponder,
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
  type PanResponderInstance,
} from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';

import { CARD_USAGE_TARGET_COLOR } from '@money/core/lib/card-usage-chart';
import { useCardUsageWindow } from '@money/core/hooks/useCardUsageWindow';
import { CHART_COLOR, barTicks, formatAxisAmount } from '@money/core/lib/chart';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency } from '@money/core/lib/money';
import type { CardUsagePeriod } from '@money/core/lib/types';

const PLOT_HEIGHT = 200;
const AXIS_WIDTH = 48;
const RIGHT_PAD = 10;
const TOP_PAD = 16;
/** X축 이름이 앉는 자리 */
const BOTTOM_PAD = 20;

/** 막대가 제 칸에서 차지하는 비율. 나머지는 이웃과의 사이 틈이다. */
const BAR_RATIO = 0.62;

/** 막대 위에 금액을 적는 최대 개수. 이보다 많으면 글자끼리 겹친다. */
const LABEL_LIMIT = 6;

/** 이보다 적게 움직인 것은 끌기가 아니라 누르다가 손이 떨린 것이다(px). */
const DRAG_THRESHOLD = 4;

const GRID_COLOR = '#e5e7eb';
const AXIS_TEXT_COLOR = '#6b7280';

export default function CardUsageChart({
  periods,
  currency,
  target,
  cardId,
}: {
  periods: CardUsagePeriod[];
  /** 사용액·기준액의 통화 (= 결제 통장의 통화) */
  currency: string;
  /** 실적 기준액. 없는 카드가 더 많아서 null이면 기준선도 색 구분도 없다. */
  target: number | null;
  /** 어느 카드의 그래프인지. 카드가 바뀌면 끌어 둔 창을 제자리로 되돌린다. */
  cardId?: string;
}) {
  const { t } = useTranslation();
  const usage = useCardUsageWindow(periods, target, cardId);
  const bars = usage.bars;

  const [width, setWidth] = useState(0);
  const measure = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
  /**
   * 눌러 둔 막대. 웹에서 마우스를 올리면 뜨는 툴팁이 하던 일이다.
   *
   * 축에는 구간을 짧게만 적으므로(8월, 8.9~9.8), 정확한 날짜와 금액은 눌러서 읽는다.
   */
  const [picked, setPicked] = useState<number | null>(null);

  const plotWidth = Math.max(width - AXIS_WIDTH - RIGHT_PAD, 1);
  const plotHeight = PLOT_HEIGHT - TOP_PAD - BOTTOM_PAD;
  /**
   * 한 칸의 폭(px).
   *
   * 창은 늘 꽉 채워 잘라 오므로(useCardUsageWindow) 끄는 동안 이 값이 변하지 않는다.
   * 받아 둔 주기가 창보다 적을 때만 그 수에 맞춰 넓어진다 -- 그때는 끌 곳도 없다.
   */
  const slot = plotWidth / Math.max(bars.length, 1);
  const barWidth = slot * BAR_RATIO;

  /*
   * 끌기. 손가락을 따라 창이 주기 위를 미끄러진다.
   *
   * 자산 추이 그래프와 같은 규칙이다 -- 가로로 움직일 때만 손가락을 가져오고(세로는
   * 흘려보내야 화면을 훑어 내릴 수 있다), 규칙은 한 번만 만들고 그때그때의 값은
   * ref 로 들여보낸다.
   */
  const live = useRef({ offset: usage.offset, slot, panFrom: usage.panFrom });
  live.current = { offset: usage.offset, slot, panFrom: usage.panFrom };

  const dragStart = useRef(0);
  const pan = useRef<PanResponderInstance | null>(null);
  if (!pan.current) {
    pan.current = PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_event, gesture) =>
        Math.abs(gesture.dx) > DRAG_THRESHOLD && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderGrant: () => {
        dragStart.current = live.current.offset;
      },
      // 오른쪽으로 끌면 지난 주기(+), 왼쪽으로 끌면 앞 주기(-)다.
      onPanResponderMove: (_event, gesture) => {
        live.current.panFrom(dragStart.current, Math.round(gesture.dx / live.current.slot));
      },
      onPanResponderTerminationRequest: () => false,
    });
  }

  if (bars.length === 0) return null;

  const [bottom, top] = usage.domain;
  const ticks = barTicks(bottom, top);

  const yOf = (value: number) => {
    const ratio = top === bottom ? 0 : (value - bottom) / (top - bottom);
    return TOP_PAD + (1 - ratio) * plotHeight;
  };
  /** 막대가 서는 바닥. 사용액이 음수인 주기가 있으면 0선이 축 위로 올라온다. */
  const baseY = yOf(Math.max(bottom, 0));
  const centerOf = (index: number) => AXIS_WIDTH + slot * (index + 0.5);

  const pickedBar = picked !== null && picked < bars.length ? bars[picked] : null;
  /** 축 이름에 날짜 범위가 들어가면 글자가 길어진다. 그때만 한 호 줄인다. */
  const labelSize = bars.some((bar) => bar.label.includes('~')) ? 9 : 10;

  return (
    <View>
      {/*
        눌러서 읽은 값과 창을 되돌리는 단추가 같은 줄에 선다. 자리를 늘 비워 둔다 --
        눌렀을 때만 줄이 생기면 그래프가 아래로 밀려 손가락 밑에서 막대가 움직인다.
      */}
      <View className="h-6 flex-row items-center justify-between gap-2">
        {pickedBar ? (
          <>
            <Text className="shrink text-xs text-gray-500" numberOfLines={1}>
              {pickedBar.range}
            </Text>
            <Text className="text-xs font-semibold text-gray-900">
              {formatCurrency(pickedBar.amount, currency)}
            </Text>
          </>
        ) : (
          <View className="flex-1" />
        )}

        {/* 창이 제자리를 벗어나 있을 때만. 그만큼 다시 끌지 않아도 된다. */}
        {usage.offset !== 0 ? (
          <Pressable
            onPress={usage.resetWindow}
            hitSlop={6}
            className="rounded bg-gray-200 px-2 py-0.5 active:bg-gray-300"
          >
            <Text className="text-xs text-gray-700">{t('history.backToNow')}</Text>
          </Pressable>
        ) : null}
      </View>

      <View onLayout={measure} {...pan.current!.panHandlers}>
        <Pressable
          onPress={(event) => {
            const index = Math.floor((event.nativeEvent.locationX - AXIS_WIDTH) / slot);
            if (index < 0 || index >= bars.length) return;
            // 같은 막대를 다시 누르면 접는다. 읽고 나서 치우는 길이 있어야 한다.
            setPicked((prev) => (prev === index ? null : index));
          }}
        >
          <Svg width="100%" height={PLOT_HEIGHT}>
            {/* 가로 격자선과 Y축 눈금 */}
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

            {bars.map((bar, index) => {
              const valueY = yOf(bar.amount);
              const height = Math.abs(valueY - baseY);

              return (
                <Rect
                  key={bar.key}
                  x={centerOf(index) - barWidth / 2}
                  y={Math.min(valueY, baseY)}
                  width={barWidth}
                  height={height}
                  /*
                    네 귀퉁이가 함께 둥글어진다(react-native-svg 의 Rect). 웹은 값이
                    있는 쪽만 둥글리지만, 반지름이 3이면 바닥에 붙은 쪽은 눈에 띄지
                    않으므로 그 차이를 두고 쓴다.
                  */
                  rx={3}
                  fill={bar.fill ?? CHART_COLOR}
                  fillOpacity={bar.fillOpacity}
                />
              );
            })}

            {/* 막대 위 금액. 몇 개 안 될 때만 적는다. */}
            {bars.length <= LABEL_LIMIT
              ? bars.map((bar, index) => (
                  <SvgText
                    key={`amount-${bar.key}`}
                    x={centerOf(index)}
                    y={Math.min(yOf(bar.amount), baseY) - 4}
                    fontSize={10}
                    fill={AXIS_TEXT_COLOR}
                    textAnchor="middle"
                  >
                    {formatAxisAmount(bar.amount, currency)}
                  </SvgText>
                ))
              : null}

            {/* X축 이름 */}
            {bars.map((bar, index) => (
              <SvgText
                key={`label-${bar.key}`}
                x={centerOf(index)}
                y={PLOT_HEIGHT - 6}
                fontSize={labelSize}
                fill={AXIS_TEXT_COLOR}
                textAnchor="middle"
              >
                {bar.label}
              </SvgText>
            ))}

            {/* 실적 기준선. 이 선 위로 올라온 막대가 실적을 채운 주기다. */}
            {target !== null && target > 0 ? (
              <>
                <Line
                  x1={AXIS_WIDTH}
                  y1={yOf(target)}
                  x2={AXIS_WIDTH + plotWidth}
                  y2={yOf(target)}
                  stroke={CARD_USAGE_TARGET_COLOR}
                  strokeWidth={1}
                  strokeDasharray="4 4"
                />
                <SvgText
                  x={AXIS_WIDTH + plotWidth}
                  y={yOf(target) - 4}
                  fontSize={10}
                  fill={CARD_USAGE_TARGET_COLOR}
                  textAnchor="end"
                >
                  {t('settlement.targetLine', { amount: formatAxisAmount(target, currency) })}
                </SvgText>
              </>
            ) : null}
          </Svg>
        </Pressable>
      </View>

      {/*
        그래프에 선 막대를 그대로 글로 옮긴 줄. 맨 위가 왼쪽 끝 막대다.

        구간은 양끝 날짜까지, 금액은 줄이지 않고 적는다 -- 축과 막대 위의 글자는
        자리가 좁아 "8월"·"12.3만"으로 줄여 둔 것이라, 정확한 값은 막대를 하나씩
        눌러 보지 않으면 읽을 수 없었다.
      */}
      <View className="mt-3 border-t border-gray-100">
        {bars.map((bar) => (
          <View
            key={`row-${bar.key}`}
            className="flex-row items-center justify-between gap-3 border-b border-gray-100 py-1.5"
          >
            <Text className="shrink text-xs text-gray-500" numberOfLines={1}>
              {bar.range}
            </Text>
            <Text className="text-sm font-medium text-gray-900">
              {formatCurrency(bar.amount, currency)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
