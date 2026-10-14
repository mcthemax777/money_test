/*
 * 그래프가 나타날 때의 움직임 (2026-10-15 사용자 요청 -- 모든 그래프는 노출될 때 움직인다).
 *
 *   선   왼쪽에서 오른쪽으로 그어진다 (`RevealCurtain direction="right"`)
 *   막대 바닥에서 솟는다 (`RevealCurtain direction="up"`)
 *   원형 돌며 커진다 (`PieReveal`)
 *
 * 처음 그려질 때만이 아니라 **숨었다가 다시 보일 때도** 다시 움직인다 -- 분석 탭은 한 번 연 탭을,
 * 덮은 화면 아래의 화면은 통째로 숨겨 두므로(지우지 않는다) 그때는 새로 그려지지 않는다. 숨겼다
 * 보이는 쪽이 `RevealScope` 로 알린다.
 *
 * 선·막대는 그림 위에 흰 막을 덮었다가 걷는다. 선 하나하나의 길이를 재어 그리는 것보다 단순하고,
 * 모든 그래프가 같은 방식으로 움직인다. 그래프는 모두 흰 상자 안에 서므로 막의 색이 바탕과 같다.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing } from 'react-native';

const DURATION = 600;
const EASING = Easing.out(Easing.cubic);

/** 다시 보일 때마다 오르는 번호. 그래프는 이 번호가 바뀌면 움직임을 처음부터 다시 한다. */
const RevealContext = createContext('0');

/**
 * 숨었다 보이는 자리. `visible` 이 다시 참이 될 때마다 안의 그래프들을 다시 움직인다.
 * 처음 그려질 때는 그래프가 스스로 움직이므로 번호를 올리지 않는다.
 */
export function RevealScope({ visible, children }: { visible: boolean; children: ReactNode }) {
  const parent = useContext(RevealContext);
  const [count, setCount] = useState(0);
  const wasVisible = useRef(visible);
  useEffect(() => {
    if (visible && !wasVisible.current) setCount((value) => value + 1);
    wasVisible.current = visible;
  }, [visible]);
  // 바깥 자리가 다시 보여도 안의 그래프가 움직여야 한다. 두 번호를 함께 싣는다.
  return (
    <RevealContext.Provider value={`${parent}/${count}`}>{children}</RevealContext.Provider>
  );
}

/** 0 → 1 로 가는 값. 그려질 때와 다시 보일 때마다 처음부터 간다. */
function useRevealProgress(): Animated.Value {
  const token = useContext(RevealContext);
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: DURATION,
      easing: EASING,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, token]);
  return progress;
}

/**
 * 그림 위의 흰 막. 그림 상자(`REVEAL_BOX` -- 막이 밖으로 새지 않게 자른다) 안에 넣고, 막이 덮을
 * 자리를 축 여백만큼 비워 준다 -- 축 눈금과 이름은 처음부터 보이고 값이 그려지는 자리만 걷힌다.
 */
export function RevealCurtain({
  direction,
  left = 0,
  right = 0,
  top = 0,
  bottom = 0,
  color = '#ffffff',
}: {
  /** right: 왼쪽부터 드러난다(선). up: 바닥부터 드러난다(막대). */
  direction: 'right' | 'up';
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  /** 그래프가 선 상자의 바탕색 */
  color?: string;
}) {
  const progress = useRevealProgress();
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left,
        right,
        top,
        bottom,
        backgroundColor: color,
        // 오른쪽(위쪽) 끝을 붙잡고 줄어든다 -- 왼쪽(아래쪽)부터 드러난다.
        transformOrigin: direction === 'right' ? 'right' : 'top',
        transform: direction === 'right' ? [{ scaleX: scale }] : [{ scaleY: scale }],
      }}
    />
  );
}

/** 원형이 돌며 커진다. 원과 그 아래 목록 중 원만 감싼다. */
export function PieReveal({ children }: { children: ReactNode }) {
  const progress = useRevealProgress();
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const rotate = progress.interpolate({ inputRange: [0, 1], outputRange: ['-90deg', '0deg'] });
  return (
    <Animated.View style={{ opacity: progress, transform: [{ scale }, { rotate }] }}>
      {children}
    </Animated.View>
  );
}

/** 막을 덮는 그림 상자의 모양. 막이 상자 밖으로 새지 않게 자른다. */
export const REVEAL_BOX = { position: 'relative', overflow: 'hidden' } as const;
