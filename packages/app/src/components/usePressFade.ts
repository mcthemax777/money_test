/*
 * 누른 느낌. 손을 대면 흐려지고, 떼면 천천히 돌아온다.
 *
 * NativeWind 의 `active:` 는 누르고 있는 동안에만 켜진다. 짧게 톡 치면 손을 대고 떼는
 * 사이가 한 프레임도 안 되어 아무것도 보이지 않고, 곧바로 상세가 열려 눌렸는지 알 수
 * 없다. 돌아오는 길을 애니메이션으로 두면 짧은 탭에도 흐려졌다 돌아오는 것이 보인다
 * (TouchableOpacity 와 같은 방식이다).
 */
import { useCallback } from 'react';
import { useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

/** 손을 댔을 때의 투명도. */
const PRESSED_OPACITY = 0.55;
/** 흐려지는 시간. 짧아야 손을 대자마자 반응한 것으로 보인다. */
const IN_MS = 60;
/** 돌아오는 시간. 짧은 탭에도 보이려면 이쪽이 길어야 한다. */
const OUT_MS = 200;

export interface PressFade {
  /** 0 이면 그대로, 1 이면 다 눌린 것. 다른 스타일에 섞어 쓸 때 읽는다. */
  pressed: SharedValue<number>;
  /** 눌린 만큼 흐리게 하는 투명도. 섞지 않고 그대로 붙일 때 쓴다. */
  style: ReturnType<typeof useAnimatedStyle>;
  onPressIn: () => void;
  onPressOut: () => void;
}

export function pressedOpacity(pressed: number): number {
  'worklet';
  return 1 - pressed * (1 - PRESSED_OPACITY);
}

export function usePressFade(): PressFade {
  const pressed = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ opacity: pressedOpacity(pressed.value) }));

  const onPressIn = useCallback(() => {
    pressed.value = withTiming(1, { duration: IN_MS });
  }, [pressed]);
  const onPressOut = useCallback(() => {
    pressed.value = withTiming(0, { duration: OUT_MS });
  }, [pressed]);

  return { pressed, style, onPressIn, onPressOut };
}
