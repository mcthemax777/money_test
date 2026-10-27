import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * 기기의 "애니메이션 줄이기". 고양이 그림들이 함께 쓴다.
 *
 * 고양이의 움직임은 reanimated 가 아니라 RN 의 Animated(네이티브 드라이버)로 돌린다 (2026-10-28). reanimated 로 돌리면
 * react-native-svg 가 그림 조각을 그릴 때마다 보내는 이벤트에 reanimated 가 제 값을 실으려다, 아직 붙지 않은 뷰에서
 * `RetryableMountingLayerException` 을 내고 그 스택을 통째로 로그에 적는다. 고양이가 여럿인 획득 알림에서 그 경고가
 * 2만 번 찍혀 UI 실이 멈췄다(실기기 ANR). 그래서 이 갈래는 그 길을 타지 않는다.
 */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (alive) setReduce(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);
  return reduce;
}
