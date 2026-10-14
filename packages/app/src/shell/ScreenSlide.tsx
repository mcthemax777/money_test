/*
 * 화면을 위에 덮어 여는 움직임 (2026-10-10 사용자 요청). 웹의 `screen-push`·`screen-return` 과 같다.
 *
 * 거래·분석에서 아이콘이나 목록 줄을 눌러 다른 화면을 펼 때 쓴다. 새 화면은 오른쪽에서 밀려 들어와
 * 앞 화면을 덮고(`ScreenPush`), 뒤로가기로 닫으면 덮였던 화면이 조금 왼쪽에서 제자리로 돌아온다
 * (`ScreenReturn`). 앞 화면은 그리기만 멈추고 상태를 그대로 든 채 기다리므로 돌아오면 떠날 때 그대로다.
 *
 * 화면은 껍데기의 스크롤 하나 안에 그려지므로(`AppShell`) 정말로 겹쳐 두지 않고 그리기를 바꾼다 --
 * 겹치면 두 화면이 한 스크롤을 나눠 쓴다. 옮기는 것은 transform 뿐이라 RevealTop·StickySections 가
 * 재는 자리(measureLayout)는 흔들리지 않는다.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';

import { RevealScope } from '../components/ChartReveal';
import LoadingBlock from '../components/LoadingBlock';

import { ScreenVisibleContext, useAfterPaint, useScreenVisible } from './after-paint';

/** 웹의 260ms cubic-bezier(0.32, 0.72, 0, 1) 와 같다. */
const DURATION = 260;
const EASING = Easing.bezier(0.32, 0.72, 0, 1);

/** 위에 덮어 연 화면. 그려지는 순간 오른쪽 끝에서 밀려 들어온다. */
export function ScreenPush({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: DURATION,
      easing: EASING,
      useNativeDriver: true,
    }).start();
  }, [progress]);
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [width, 0] });
  /*
   * 안의 화면은 두 그림 뒤에 그린다 (after-paint). 누른 그림에서 그 화면의 그래프·목록까지 그리면
   * 밀려 드는 움직임이 그만큼 늦게 시작해 손끝에서 멈춘 것처럼 느껴진다. 그동안 돌림 표시가 선다.
   */
  const ready = useAfterPaint();
  return (
    <Animated.View style={{ transform: [{ translateX }] }}>
      {ready ? children : <LoadingBlock />}
    </Animated.View>
  );
}

/**
 * 위에 다른 화면을 덮을 수 있는 앞 화면.
 *
 * 덮인 동안(`covered`)에는 **지우지 않고 숨겨 둔다** (2026-10-15 사용자 요청 -- 팝업처럼). 받아 둔
 * 값·고른 탭·파고든 자리가 그대로 남아 돌아올 때 다시 받지 않고, 숨어 있는 동안에도 다른 기기의
 * 변경을 받아 고쳐 둔다. 덮개가 걷히면 왼쪽에서 제자리로 온다. 처음 열 때는 움직이지 않는다.
 */
export function ScreenReturn({
  covered,
  style,
  children,
}: {
  covered: boolean;
  /** 감싼 것들 사이의 간격처럼, 감싸기 전 부모가 주던 모양을 잇는다. */
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const parentVisible = useScreenVisible();
  const progress = useRef(new Animated.Value(1)).current;
  const wasCovered = useRef(covered);
  useEffect(() => {
    const isBack = wasCovered.current && !covered;
    wasCovered.current = covered;
    if (!isBack) return;
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: DURATION,
      easing: EASING,
      useNativeDriver: true,
    }).start();
  }, [progress, covered]);
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-width * 0.25, 0] });
  const opacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });
  return (
    <Animated.View
      style={[style, { opacity, transform: [{ translateX }] }, covered ? HIDDEN : null]}
    >
      {/*
        덮개가 걷히면 안의 그래프도 다시 그려지듯 움직인다 (ChartReveal). 덮인 동안에는 안의 것이
        스크롤 바닥 신호·붙박이 단추·뒤로가기를 받지 않는다 (ScreenVisibleContext).
      */}
      <ScreenVisibleContext.Provider value={parentVisible && !covered}>
        <RevealScope visible={!covered}>{children}</RevealScope>
      </ScreenVisibleContext.Provider>
    </Animated.View>
  );
}

/** 자리를 차지하지 않고 숨는다. 안의 것은 그대로 살아 있다. */
const HIDDEN = { display: 'none' } as const;
