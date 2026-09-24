/*
 * 굴려도 화면 위에 남는 머리글. 웹의 `sticky top-0` 과 같은 자리를 앱에서 만든다.
 *
 * 앱은 화면 전체가 껍데기의 스크롤 하나라(`AppShell`) 화면이 그린 것은 무엇이든 함께
 * 굴러간다. `ScrollView` 의 `stickyHeaderIndices` 는 **직계 자식**만 붙일 수 있는데,
 * 껍데기의 자식은 화면 하나뿐이라 그 안쪽의 탭 막대에는 걸 수 없다. 그래서 굴러간
 * 만큼을 되받아 제자리에 남게 한다 -- 제자리를 지나기 전에는 0 이고, 지난 뒤에는
 * 지난 만큼 따라 내려온다.
 *
 * 움직임은 UI 실에서 센다(worklet). 굴러간 값은 껍데기의 스크롤 사건이 날라 주므로
 * 목록을 그리느라 JS 가 붙잡히면 그 사이에는 따라오지 못한다 -- 거래 화면은 줄을
 * 나눠 그려 그 멈춤을 짧게 두고 있다(TransactionsScreen 의 예산 참고).
 */
import { useCallback, useRef, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { useScrollControl, useScrollY } from './scroll';

/**
 * 붙어 있는 동안의 바탕. 페이지와 같은 회색(gray-50)이다.
 *
 * 투명하게 두면 아래를 지나가는 줄이 탭 막대의 둥근 모서리로 비쳐 보인다. 위아래
 * 여백도 같은 바탕이라 줄이 막대에 닿기 전에 회색이 먼저 온다 (웹도 같은 8px 이다).
 */
const BACKGROUND = '#f9fafb';
const PADDING = 8;

export default function StickyTop({ children }: { children: ReactNode }) {
  const scrollY = useScrollY();
  const { offsetOf, areaOf } = useScrollControl();
  const box = useRef<View>(null);
  /**
   * 굴리지 않았을 때 이 머리글이 서 있는 자리. 스크롤 내용 안에서의 y 다.
   *
   * 처음에는 무한대다 -- 아직 재지 못한 동안에는 어디에도 붙지 말아야 한다.
   */
  const anchor = useSharedValue(Number.POSITIVE_INFINITY);

  /*
   * 창 좌표로 재고 스크롤 내용의 좌표로 옮긴다. 화면 위쪽의 것(머리글·알림 줄)이
   * 늘거나 줄면 이 자리도 따라 바뀌므로 `onLayout` 이 올 때마다 다시 잰다.
   */
  const measure = useCallback(() => {
    box.current?.measureInWindow((_x, y) => {
      anchor.value = y - areaOf().top + offsetOf();
    });
  }, [anchor, areaOf, offsetOf]);

  const follow = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.max(0, scrollY.value - anchor.value) }],
  }));

  return (
    /*
     * 재는 상자와 움직이는 상자를 나눈다. 바깥은 제자리에 남아 아래 줄이 설 자리를
     * 지키고(빼면 붙는 순간 목록이 한 칸 위로 튄다), 안쪽만 따라 내려온다.
     *
     * `zIndex` 는 바깥에 준다. 형제 중에서 누가 위에 그려질지를 정하는 값이라, 움직이는
     * 안쪽에 주면 목록이 막대 위에 그려진다.
     */
    <View ref={box} onLayout={measure} style={{ zIndex: 10 }}>
      <Animated.View
        style={[{ backgroundColor: BACKGROUND, paddingVertical: PADDING }, follow]}
      >
        {children}
      </Animated.View>
    </View>
  );
}
