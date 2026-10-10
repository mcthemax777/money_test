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
  return <Animated.View style={{ transform: [{ translateX }] }}>{children}</Animated.View>;
}

/**
 * 덮였다가 돌아온 앞 화면. `returned` 이면(core `useScreenReturn`) 그려지는 순간 왼쪽에서 제자리로
 * 오고, 처음 열 때는 움직이지 않는다.
 */
export function ScreenReturn({
  returned,
  style,
  children,
}: {
  returned: boolean;
  /** 감싼 것들 사이의 간격처럼, 감싸기 전 부모가 주던 모양을 잇는다. */
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const progress = useRef(new Animated.Value(returned ? 0 : 1)).current;
  useEffect(() => {
    if (!returned) return;
    Animated.timing(progress, {
      toValue: 1,
      duration: DURATION,
      easing: EASING,
      useNativeDriver: true,
    }).start();
  }, [progress, returned]);
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-width * 0.25, 0] });
  const opacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });
  return (
    <Animated.View style={[style, { opacity, transform: [{ translateX }] }]}>{children}</Animated.View>
  );
}
