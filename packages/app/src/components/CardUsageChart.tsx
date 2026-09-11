/*
 * 주기별 사용액 막대. 웹의 같은 그래프를 앱에 옮긴 것이다.
 *
 * 어느 막대가 어떤 색이고 축에 무엇이라 적는지는 core 의 cardUsageBars 가 정한다.
 * 여기 있는 것은 react-native-svg 로 그리는 일과, 눌러서 값을 읽는 일뿐이다.
 */
import { useState } from 'react';
import { Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';

import {
  CARD_USAGE_TARGET_COLOR,
  cardUsageBars,
  cardUsageDomain,
} from '@money/core/lib/card-usage-chart';
import { CHART_COLOR, barTicks, formatAxisAmount } from '@money/core/lib/chart';
import { todayKey } from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency } from '@money/core/lib/money';
import { useProjectTimeZone } from '@money/core/store/project';
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

const GRID_COLOR = '#e5e7eb';
const AXIS_TEXT_COLOR = '#6b7280';

export default function CardUsageChart({
  periods,
  currency,
  target,
}: {
  periods: CardUsagePeriod[];
  /** 사용액·기준액의 통화 (= 결제 통장의 통화) */
  currency: string;
  /** 실적 기준액. 없는 카드가 더 많아서 null이면 기준선도 색 구분도 없다. */
  target: number | null;
}) {
  const { t } = useTranslation();
  const timeZone = useProjectTimeZone();

  const [width, setWidth] = useState(0);
  const measure = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
  /**
   * 눌러 둔 막대. 웹에서 마우스를 올리면 뜨는 툴팁이 하던 일이다.
   *
   * 축에는 구간을 짧게만 적으므로(8월, 8.9~9.8), 정확한 날짜와 금액은 눌러서 읽는다.
   */
  const [picked, setPicked] = useState<number | null>(null);

  const bars = cardUsageBars(periods, todayKey(timeZone), target);
  if (bars.length === 0) return null;

  const [bottom, top] = cardUsageDomain(bars, target);
  const ticks = barTicks(bottom, top);
  const hasFuture = bars.some((bar) => bar.phase === 'future');

  const plotWidth = Math.max(width - AXIS_WIDTH - RIGHT_PAD, 1);
  const plotHeight = PLOT_HEIGHT - TOP_PAD - BOTTOM_PAD;
  const slot = plotWidth / bars.length;
  const barWidth = slot * BAR_RATIO;

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
        눌러서 읽은 값. 자리를 늘 비워 둔다 -- 눌렀을 때만 줄이 생기면 그래프가
        아래로 밀려 손가락 밑에서 막대가 움직인다.
      */}
      <View className="h-5 flex-row items-center justify-between gap-2">
        {pickedBar ? (
          <>
            <Text className="shrink text-xs text-gray-500" numberOfLines={1}>
              {pickedBar.range}
            </Text>
            <Text className="text-xs font-semibold text-gray-900">
              {formatCurrency(pickedBar.amount, currency)}
            </Text>
          </>
        ) : null}
      </View>

      <View onLayout={measure}>
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

      {/* 색이 무엇을 뜻하는지 적는다. 색만으로 구분하게 두지 않는다. */}
      {target !== null ? (
        <Text className="mt-1 text-xs text-gray-500">{t('settlement.chartHint')}</Text>
      ) : null}
      {hasFuture ? (
        <Text className="mt-1 text-xs text-gray-500">{t('settlement.chartFutureHint')}</Text>
      ) : null}
    </View>
  );
}
