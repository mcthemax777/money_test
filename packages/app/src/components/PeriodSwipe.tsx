import { useRef, type ReactNode } from 'react';
import { Animated, Easing, PanResponder, type PanResponderInstance } from 'react-native';

import {
  PERIOD_SWIPE_FOLLOW,
  PERIOD_SWIPE_MS,
  PERIOD_SWIPE_SLIDE,
  claimsPeriodSwipe,
  periodSwipeStep,
} from '@money/core/lib/period-swipe';

/**
 * 감싼 자리를 가로로 끌면 기간을 앞뒤로 넘긴다. 날짜 줄의 ‹ › 단추와 같은 일을 한다.
 * 웹의 usePeriodSwipe 와 같은 판정(core 의 period-swipe)을 쓴다.
 *
 * 가로가 세로보다 확실히 클 때만 손을 가져온다(capture 쪽이라 안의 단추보다 먼저 본다).
 * 그 밖의 손은 그대로 흘려보내야 껍데기 ScrollView 로 화면을 훑어 내리는 길이 막히지 않는다.
 * 누르기만 한 손은 가져오지 않으므로 안의 단추·줄은 예전처럼 눌린다.
 *
 * 끄는 동안 내용이 손을 조금 따라오고, 넘기면 새 기간이 끈 쪽 반대편에서 미끄러져 들어온다.
 * 넘기지 않고 놓으면 제자리로 돌아간다.
 */
export default function PeriodSwipe({
  onShift,
  children,
}: {
  /** 옮길 칸 수. 왼쪽으로 밀면 1(다음), 오른쪽으로 밀면 -1(지난)이다. */
  onShift: (delta: 1 | -1) => void;
  children: ReactNode;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  /*
   * PanResponder 는 한 번만 만든다(AssetHistoryChart 와 같은 까닭). 렌더마다 새로 만들면
   * 끄는 중에 규칙이 바뀌어 손가락을 놓친다. 그때그때의 onShift 는 ref 로 들여보낸다.
   */
  const latest = useRef(onShift);
  latest.current = onShift;

  const pan = useRef<PanResponderInstance | null>(null);
  if (!pan.current) {
    const animateTo = (x: number, alpha: number) =>
      Animated.parallel([
        Animated.timing(translateX, {
          toValue: x,
          duration: PERIOD_SWIPE_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: alpha,
          duration: PERIOD_SWIPE_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();

    const release = (dx: number, vx: number) => {
      const step = periodSwipeStep(dx, vx);
      if (step === 0) {
        animateTo(0, 1);
        return;
      }
      /*
       * 기간은 바로 넘기고, 새 내용은 끈 쪽 반대편에 투명하게 세웠다가 미끄러져 들어오게 한다.
       * 옛 내용이 빠져나가는 애니메이션이 끝나기를 기다렸다 넘기면, 그사이 다시 잡은 손이
       * 애니메이션을 끊을 때 넘기기까지 함께 사라진다.
       */
      latest.current(step);
      translateX.setValue(step === 1 ? PERIOD_SWIPE_SLIDE : -PERIOD_SWIPE_SLIDE);
      opacity.setValue(0);
      animateTo(0, 1);
    };

    pan.current = PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_event, gesture) =>
        claimsPeriodSwipe(gesture.dx, gesture.dy),
      onPanResponderGrant: () => {
        // 들어오던 애니메이션 중에 다시 잡았으면 그 자리에서 멈춘다.
        translateX.stopAnimation();
        opacity.stopAnimation();
        opacity.setValue(1);
      },
      onPanResponderMove: (_event, gesture) => {
        translateX.setValue(gesture.dx * PERIOD_SWIPE_FOLLOW);
      },
      onPanResponderRelease: (_event, gesture) => release(gesture.dx, gesture.vx),
      // 다른 쪽이 손을 빼앗아 갔으면 넘기지 않고 제자리로 돌린다.
      onPanResponderTerminate: () => animateTo(0, 1),
      onPanResponderTerminationRequest: () => false,
    });
  }

  return (
    <Animated.View
      style={{ transform: [{ translateX }], opacity }}
      {...pan.current.panHandlers}
    >
      {children}
    </Animated.View>
  );
}
