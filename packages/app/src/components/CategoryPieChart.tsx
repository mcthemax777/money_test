/*
 * 분류 구성비 원형차트. 웹 분류 상세의 같은 그림을 앱에 옮긴 것이다.
 *
 * 조각과 그 차례는 core 의 useCategoryDetail 이 정한다. 여기 있는 것은
 * react-native-svg 로 부채꼴을 그리는 일과, 눌러서 한 단 내려가는 일뿐이다.
 *
 * **이름표를 조각 옆이 아니라 아래 목록에 둔다.** 웹은 조각마다 "이름 금액 (12.3%)"를
 * 둘레에 적지만, 폰 너비에서는 그 글자들이 서로 겹쳐 읽을 수 없다. 색만으로 갈라
 * 보게 두지 않으려면 이름은 어딘가에 반드시 있어야 하므로 아래로 내렸다.
 */
import { Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import { useState } from 'react';
import Svg, { Circle, G, Path } from 'react-native-svg';

import type { CategorySlice } from '@money/core/hooks/useCategoryDetail';
import { CHART_PIE_COLORS } from '@money/core/lib/chart';
import { formatCurrency } from '@money/core/lib/money';

/** 원이 차지하는 자리의 높이(px) */
const PLOT_HEIGHT = 220;
const RADIUS = 96;

/** 12시에서 시작해 시계 방향으로 돈다. */
const START_ANGLE = -Math.PI / 2;

/** 조각 하나가 원을 거의 다 차지하면 부채꼴 대신 원을 그린다 (호의 양끝이 겹친다). */
const FULL_RATIO = 0.9999;

function arcPath(cx: number, cy: number, from: number, to: number): string {
  const large = to - from > Math.PI ? 1 : 0;
  const x1 = cx + RADIUS * Math.cos(from);
  const y1 = cy + RADIUS * Math.sin(from);
  const x2 = cx + RADIUS * Math.cos(to);
  const y2 = cy + RADIUS * Math.sin(to);

  return `M ${cx} ${cy} L ${x1} ${y1} A ${RADIUS} ${RADIUS} 0 ${large} 1 ${x2} ${y2} Z`;
}

export default function CategoryPieChart({
  slices,
  currency,
  onDrill,
}: {
  slices: CategorySlice[];
  currency: string;
  /**
   * 조각을 눌러 한 단 내려갈 때. 주지 않으면 누를 수 없는 그림이 된다.
   *
   * id 가 없는 조각("미분류")은 실제 분류가 아니라 내려갈 곳이 없다. 그 줄은
   * 눌러도 아무 일도 일어나지 않는다.
   */
  onDrill?: (categoryId: string) => void;
}) {
  const [width, setWidth] = useState(0);
  const measure = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  const total = slices.reduce((acc, slice) => acc + slice.value, 0);
  /* 전부 0원이면 그릴 것이 없다. 비율을 낼 수도 없다. */
  if (total <= 0) return null;

  const cx = width / 2;
  const cy = PLOT_HEIGHT / 2;

  /** 조각마다 시작·끝 각과 색. 그림과 아래 목록이 같은 값을 쓴다. */
  let cursor = START_ANGLE;
  const wedges = slices.map((slice, index) => {
    const ratio = slice.value / total;
    const from = cursor;
    cursor += ratio * Math.PI * 2;

    return {
      slice,
      ratio,
      from,
      to: cursor,
      color: CHART_PIE_COLORS[index % CHART_PIE_COLORS.length],
    };
  });

  /** 누른 자리가 어느 조각인지. 가운데에서의 각으로 찾는다. */
  const wedgeAt = (x: number, y: number) => {
    const dx = x - cx;
    const dy = y - cy;
    if (Math.hypot(dx, dy) > RADIUS) return null;

    // atan2 는 -PI~PI 를 주므로 시작 각(12시)에서 잰 0~2PI 로 옮긴다.
    let angle = Math.atan2(dy, dx) - START_ANGLE;
    if (angle < 0) angle += Math.PI * 2;

    return wedges.find((wedge) => angle >= wedge.from - START_ANGLE && angle < wedge.to - START_ANGLE);
  };

  return (
    <View>
      <View onLayout={measure}>
        <Pressable
          onPress={(event) => {
            if (!onDrill) return;

            const wedge = wedgeAt(event.nativeEvent.locationX, event.nativeEvent.locationY);
            if (wedge?.slice.id) onDrill(wedge.slice.id);
          }}
        >
          <Svg width="100%" height={PLOT_HEIGHT}>
            {/* 폭을 재기 전에는 가운데를 모른다. 첫 프레임에는 그리지 않는다. */}
            {width > 0 ? (
              <G>
                {wedges.length === 1 || wedges[0].ratio >= FULL_RATIO ? (
                  <Circle cx={cx} cy={cy} r={RADIUS} fill={wedges[0].color} />
                ) : (
                  wedges.map((wedge) => (
                    <Path
                      key={wedge.slice.id ?? wedge.slice.name}
                      d={arcPath(cx, cy, wedge.from, wedge.to)}
                      fill={wedge.color}
                    />
                  ))
                )}
              </G>
            ) : null}
          </Svg>
        </Pressable>
      </View>

      {/*
        이름표. 조각과 같은 차례, 같은 색이다.

        줄 자체가 조각을 누르는 것과 같은 단추다. 작은 원에서 부채꼴 하나를 정확히
        짚는 것보다 줄을 누르는 편이 손에 맞는다.
      */}
      <View className="mt-2">
        {wedges.map((wedge) => {
          const canDrill = Boolean(onDrill && wedge.slice.id);

          return (
            <Pressable
              key={wedge.slice.id ?? wedge.slice.name}
              onPress={canDrill ? () => onDrill!(wedge.slice.id!) : undefined}
              disabled={!canDrill}
              className="flex-row items-baseline gap-2 border-b border-gray-100 px-1 py-1.5 active:bg-gray-50"
            >
              <View
                style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: wedge.color }}
              />
              <Text numberOfLines={1} className="shrink text-sm text-gray-800">
                {wedge.slice.name}
              </Text>
              <Text className="text-xs text-gray-500">{(wedge.ratio * 100).toFixed(1)}%</Text>
              <Text className="ml-auto text-sm font-medium text-gray-900">
                {formatCurrency(wedge.slice.value, currency)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
