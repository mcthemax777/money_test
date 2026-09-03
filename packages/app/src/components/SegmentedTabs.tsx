/*
 * 한 줄에 나란히 선 탭.
 *
 * 흰 알약을 눌린 칸에 그리는 대신 **하나를 두고 옮긴다.** 칸마다 바탕을 켜고 끄면 탭이
 * 순간이동해, 세 탭이 한 줄에 나란한 것인지 서로 다른 화면인지가 흐려진다. 미끄러져
 * 가면 "옆으로 옮겼다"가 그대로 보인다.
 *
 * 거래 화면과 카테고리 화면이 함께 쓴다. 두 벌로 두면 한쪽만 고쳐져 같은 탭이 화면마다
 * 다르게 움직인다.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, Text, View, type LayoutChangeEvent } from 'react-native';

/*
 * 탭 막대의 여백. 흰 알약을 손으로 옮기려면 숫자로 알아야 한다.
 *
 * 아래 className 의 `p-1` `gap-2` 와 짝이다. 한쪽만 고치면 알약이 글자에서 어긋나므로
 * 함께 고친다.
 */
const PAD = 4;
const GAP = 8;

export interface SegmentedTab<T extends string> {
  id: T;
  label: string;
}

export default function SegmentedTabs<T extends string>({
  tabs,
  selected,
  onSelect,
}: {
  tabs: ReadonlyArray<SegmentedTab<T>>;
  selected: T;
  onSelect: (id: T) => void;
}) {
  /*
   * 탭 막대의 폭. 흰 알약이 어디로 미끄러질지 이 값으로 센다.
   *
   * 글자 길이가 언어마다 달라 미리 적어 둘 수 없다(날짜/Date/日付). 그려진 뒤 재고,
   * 화면을 돌리면 다시 잰다.
   */
  const [barWidth, setBarWidth] = useState(0);
  const measure = (event: LayoutChangeEvent) => setBarWidth(event.nativeEvent.layout.width);

  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === selected),
  );
  const tabWidth =
    barWidth > 0 ? (barWidth - PAD * 2 - GAP * (tabs.length - 1)) / tabs.length : 0;

  return (
    <View className="relative flex-row gap-2 rounded-lg bg-gray-200 p-1" onLayout={measure}>
      <Indicator index={activeIndex} width={tabWidth} />
      {tabs.map((tab) => (
        <Pressable
          key={tab.id}
          onPress={() => onSelect(tab.id)}
          /* 바탕은 위의 알약이 맡는다. 여기서 켜면 알약이 도착하기 전에 두 칸이 희다. */
          className="flex-1 items-center rounded-md px-4 py-2"
        >
          <Text
            className={`font-medium ${
              tab.id === selected ? 'text-blue-600' : 'text-gray-600'
            }`}
          >
            {tab.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** 어느 탭을 보고 있는지 알리는 흰 알약. */
function Indicator({ index, width }: { index: number; width: number }) {
  const slide = useRef(new Animated.Value(index)).current;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: index,
      duration: 180,
      // 위치만 바꾸므로 UI 스레드에 맡긴다. 목록이 길어도 알약은 끊기지 않는다.
      useNativeDriver: true,
    }).start();
  }, [index, slide]);

  // 아직 재지 못했다. 알약을 0 폭으로 그리면 첫 칸에 실선이 한 번 스친다.
  if (width <= 0) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: PAD,
        top: PAD,
        bottom: PAD,
        width,
        borderRadius: 6,
        backgroundColor: '#ffffff',
        transform: [
          {
            translateX: slide.interpolate({
              inputRange: [0, 1],
              outputRange: [0, width + GAP],
            }),
          },
        ],
      }}
    />
  );
}
