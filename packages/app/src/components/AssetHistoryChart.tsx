/*
 * 자산 추이. 웹의 같은 그래프를 앱에 옮긴 것이다.
 *
 * 무엇을 받아 어느 칸을 그릴지는 core 의 useAssetHistory 가 정한다 (웹과 같은 훅이다).
 * 여기 있는 것은 그리는 일과 손가락을 받는 일뿐이다 -- 선은 react-native-svg 로 긋고,
 * 좌우로 끌면 창이 시간 위를 미끄러지고, 칸을 누르면 그 자리의 잔액을 읽는다.
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
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';

import { CHART_COLOR } from '@money/core/lib/chart';
import {
  GRANULARITY_OPTIONS,
  historyPointLabel,
  useAssetHistory,
  type AssetHistoryInput,
} from '@money/core/hooks/useAssetHistory';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency } from '@money/core/lib/money';
import { useProjectDisplayCurrency } from '@money/core/store/project';

import SegmentedTabs from './SegmentedTabs';

/** 그리는 자리의 높이(px). 웹은 300이지만 앱 화면에서는 그만큼이 화면 절반을 먹는다. */
const PLOT_HEIGHT = 220;

/**
 * 축과 여백이 먹는 폭(px).
 *
 * Y축 눈금 글자가 "1,000.5만"까지 길어지므로 넉넉히 잡는다. 웹은 recharts 가 글자에
 * 맞춰 재 주지만 여기서는 우리가 정한다.
 */
const AXIS_WIDTH = 48;
const RIGHT_PAD = 14;
const TOP_PAD = 14;
/** X축 이름이 앉는 자리 */
const BOTTOM_PAD = 22;

/** 이보다 적게 움직인 것은 끌기가 아니라 누르다가 손이 떨린 것이다(px). */
const DRAG_THRESHOLD = 4;

/** X축에 이름을 몇 개까지 적을지. 서른하루를 다 적으면 글자가 서로 겹친다. */
const MAX_X_LABELS = 6;

/** 격자선 색 (tailwind gray-200). 웹 그래프의 가로 점선과 같은 자리다. */
const GRID_COLOR = '#e5e7eb';
const AXIS_TEXT_COLOR = '#6b7280';

export default function AssetHistoryChart(props: AssetHistoryInput) {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();
  const history = useAssetHistory(props);
  const { points, yAxis } = history;

  /** 그리는 자리의 폭. 글자 길이와 화면 크기에 따라 달라 그려진 뒤 잰다. */
  const [width, setWidth] = useState(0);
  const measure = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  /**
   * 눌러서 값을 읽어 둔 칸. **null 이면 맨 오른쪽 칸**이다.
   *
   * 단위를 가리지 않는다 -- 일·월·연 모두 누른 자리의 잔액을 읽는다. 예전에는
   * 월·연의 누름이 한 단 아래로 내려가는 길이었는데, 내려갈 곳은 위의 탭이 이미
   * 가리키고 있어 같은 자리에 두 가지 뜻이 겹쳐 있었다.
   *
   * 고르지 않은 상태를 "맨 오른쪽"으로 두는 것이 요점이다. 숫자로 굳혀 두면 창을
   * 끌 때 그 자리에 눌러 둔 칸이 남아, 화면에 보이지도 않는 날짜의 잔액이 읽힌다.
   * null 로 두면 끌어도 늘 선이 끝나는 칸을 읽는다.
   */
  const [picked, setPicked] = useState<number | null>(null);

  const plotWidth = Math.max(width - AXIS_WIDTH - RIGHT_PAD, 1);
  const plotHeight = PLOT_HEIGHT - TOP_PAD - BOTTOM_PAD;

  /** 칸 사이의 거리(px). 점이 하나뿐이면 나눌 것이 없어 폭 전체로 둔다. */
  const gap = plotWidth / Math.max(points.length - 1, 1);

  const [low, high] = yAxis.domain;
  const yOf = (balance: number) => {
    const ratio = high === low ? 0.5 : (balance - low) / (high - low);
    return TOP_PAD + (1 - ratio) * plotHeight;
  };
  const xOf = (index: number) => AXIS_WIDTH + index * gap;

  /**
   * 한 칸이 화면에서 차지하는 폭(px). 이만큼 끌면 한 칸이 넘어간다.
   *
   * 그려진 점의 수가 아니라 창 크기로 센다. 다시 받는 중에는 점이 창보다 적을 수 있고,
   * 그때 손에 걸리는 무게가 달라지면 끌던 속도가 갑자기 바뀐다.
   */
  const stepWidth = Math.max(plotWidth / Math.max(history.span - 1, 1), 8);

  /*
   * 끌기. 손가락을 따라 창이 시간 위를 미끄러진다.
   *
   * 가로로 움직일 때만 손가락을 가져온다(capture 쪽이라 안의 누름보다 먼저 본다).
   * 세로는 그대로 흘려보내야 화면을 훑어 내리는 길이 막히지 않는다.
   *
   * 규칙은 한 번만 만들고 그때그때의 값은 ref 로 들여보낸다. 렌더마다 새로 만들면
   * 끄는 중에 규칙이 바뀌어 손가락을 놓치고, 반대로 한 번 만든 규칙이 첫 렌더의
   * offset·폭을 닫아 두면 창이 늘 처음 자리에서만 움직인다.
   */
  const live = useRef({ offset: history.offset, stepWidth, panFrom: history.panFrom });
  live.current = { offset: history.offset, stepWidth, panFrom: history.panFrom };

  const dragStart = useRef(0);
  const pan = useRef<PanResponderInstance | null>(null);
  if (!pan.current) {
    pan.current = PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_event, gesture) =>
        Math.abs(gesture.dx) > DRAG_THRESHOLD && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderGrant: () => {
        dragStart.current = live.current.offset;
      },
      // 오른쪽으로 끌면 지난 날짜(+), 왼쪽으로 끌면 앞날(-)이다.
      onPanResponderMove: (_event, gesture) => {
        live.current.panFrom(dragStart.current, Math.round(gesture.dx / live.current.stepWidth));
      },
      onPanResponderTerminationRequest: () => false,
    });
  }

  /** 누른 자리에서 가장 가까운 칸. 점이 아니라 빈 곳을 눌러도 그 칸으로 본다. */
  const handleTap = (locationX: number) => {
    if (points.length === 0) return;

    const index = Math.round((locationX - AXIS_WIDTH) / gap);
    const clamped = Math.min(Math.max(index, 0), points.length - 1);
    setPicked(clamped);
  };

  /** X축에 이름을 적을 칸. 너무 촘촘하면 몇 칸씩 건너뛴다. */
  const labelStep = Math.max(1, Math.ceil(points.length / MAX_X_LABELS));
  const lastIndex = points.length - 1;
  /*
   * 지금 읽고 있는 칸. 아직 아무 데도 누르지 않았으면 맨 오른쪽이다.
   *
   * 눌러 둔 자리가 창 밖으로 밀려난 경우(다시 받는 중이라 점이 창보다 적다)에도
   * 맨 오른쪽으로 되돌린다 -- 없는 칸을 가리키면 읽는 줄이 통째로 사라진다.
   */
  const activeIndex = picked !== null && picked <= lastIndex ? picked : lastIndex;
  const activePoint = activeIndex >= 0 ? points[activeIndex] : null;

  return (
    <View className="rounded-lg bg-white p-4 shadow-sm">
      <View className="mb-3 flex-row items-center justify-between gap-2">
        <Text className="text-base font-semibold text-gray-900">{t(history.titleKey)}</Text>

        {/* 지난 날짜든 앞날이든 지금을 벗어나 있을 때. 그만큼 다시 끌지 않아도 된다. */}
        {history.offset !== 0 ? (
          <Pressable
            onPress={history.resetWindow}
            className="rounded bg-gray-200 px-3 py-1 active:bg-gray-300"
          >
            <Text className="text-sm text-gray-700">{t('history.backToNow')}</Text>
          </Pressable>
        ) : null}
      </View>

      <View className="mb-3">
        <SegmentedTabs
          tabs={GRANULARITY_OPTIONS.map((option) => ({
            id: option.value,
            label: t(option.labelKey),
          }))}
          selected={history.granularity}
          onSelect={(value) => {
            setPicked(null);
            history.selectGranularity(value);
          }}
        />
      </View>

      {/* 처음 한 번만 자리를 비운다. 끌면서 다시 받는 동안에는 그리던 선을 그대로 둔다. */}
      {history.isLoading && points.length === 0 ? (
        <Text className="py-12 text-center text-sm text-gray-500">{t('feed.loadingMore')}</Text>
      ) : history.error ? (
        <Text className="py-12 text-center text-sm text-red-600">{history.error}</Text>
      ) : !history.hasAnyValue && history.offset === 0 ? (
        <Text className="py-12 text-center text-sm text-gray-500">{t('history.empty')}</Text>
      ) : (
        <>
          {/*
            읽고 있는 칸의 때와 잔액. 그래프 오른쪽 위에 선다.

            날짜는 **연도까지** 적는다(historyPointLabel). X축은 눈금이 겹치지 않게
            "9/10"·"9월" 로 줄여 두는데, 창을 해가 바뀌는 자리로 끌면 그것만으로는
            어느 해인지 알 수 없다. 읽는 자리는 한 칸뿐이라 길어도 된다.

            자리를 늘 비워 둔다(h-5). 값이 있을 때만 한 줄이 생기면 그래프가 그만큼
            아래로 밀려, 누른 손가락 밑에서 선이 움직인다.
          */}
          <View className="h-5 flex-row items-center justify-end gap-2">
            {activePoint ? (
              <>
                <Text className="text-xs text-gray-500">
                  {historyPointLabel(activePoint.date)}
                </Text>
                <Text className="text-xs font-semibold text-gray-900">
                  {formatCurrency(activePoint.balance, displayCurrency)}
                </Text>
              </>
            ) : null}
          </View>

          <View onLayout={measure} {...pan.current!.panHandlers}>
            <Pressable onPress={(event) => handleTap(event.nativeEvent.locationX)}>
              <Svg width="100%" height={PLOT_HEIGHT}>
                {/* 가로 격자선과 Y축 눈금. 세로선은 긋지 않는다(선과 겹쳐 데이터처럼 보인다). */}
                {yAxis.ticks.map((tick) => (
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
                {yAxis.ticks.map((tick) => (
                  <SvgText
                    key={`tick-${tick}`}
                    x={AXIS_WIDTH - 6}
                    y={yOf(tick) + 4}
                    fontSize={10}
                    fill={AXIS_TEXT_COLOR}
                    textAnchor="end"
                  >
                    {yAxis.tickFormatter(tick)}
                  </SvgText>
                ))}

                {/* X축 이름 */}
                {points.map((point, index) =>
                  index % labelStep === 0 || index === lastIndex ? (
                    <SvgText
                      key={`x-${point.date}`}
                      x={xOf(index)}
                      y={PLOT_HEIGHT - 6}
                      fontSize={10}
                      fill={AXIS_TEXT_COLOR}
                      textAnchor={index === lastIndex ? 'end' : index === 0 ? 'start' : 'middle'}
                    >
                      {point.label}
                    </SvgText>
                  ) : null,
                )}

                {/* 잔액 선 */}
                {points.length > 1 ? (
                  <Path
                    d={points
                      .map(
                        (point, index) =>
                          `${index === 0 ? 'M' : 'L'} ${xOf(index)} ${yOf(point.balance)}`,
                      )
                      .join(' ')}
                    stroke={CHART_COLOR}
                    strokeWidth={2}
                    fill="none"
                  />
                ) : null}

                {/*
                  읽고 있는 칸. 세로선으로 짚고 그 위에 점을 찍는다.

                  금액은 그리는 자리 안에 적지 않는다. 값은 위의 읽는 줄이 이미
                  말하고 있어, 선 옆에 또 적으면 같은 숫자가 한 화면에 둘이 된다.
                  게다가 그 글자는 선을 따라 오르내리므로 격자선·X축 이름과 겹치는
                  자리가 생긴다.
                */}
                {activePoint ? (
                  <>
                    <Line
                      x1={xOf(activeIndex)}
                      y1={TOP_PAD}
                      x2={xOf(activeIndex)}
                      y2={TOP_PAD + plotHeight}
                      stroke={CHART_COLOR}
                      strokeWidth={1}
                      strokeDasharray="3 3"
                    />
                    <Circle
                      cx={xOf(activeIndex)}
                      cy={yOf(activePoint.balance)}
                      r={4}
                      fill={CHART_COLOR}
                      stroke="#ffffff"
                      strokeWidth={2}
                    />
                  </>
                ) : null}
              </Svg>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}
