'use client';

/*
 * 그래프가 나타날 때의 움직임 (2026-10-15 사용자 요청 -- 모든 그래프는 노출될 때 움직인다, 앱의
 * 같은 이름 부품과 같은 규칙).
 *
 * 그리는 일은 recharts 가 처음 그릴 때의 움직임에 맡긴다(선은 그어지고, 막대는 솟고, 원은 돈다).
 * 여기서는 **숨었다가 다시 보일 때도** 처음처럼 그리게 한다 -- 분석 탭은 한 번 연 탭을, 덮은 화면
 * 아래의 화면은 통째로 숨겨 두므로(`hidden`, 지우지 않는다) 다시 보여도 새로 그려지지 않는다.
 * 숨겼다 보이는 쪽이 `RevealScope` 로 알리고, 그래프는 `useRevealKey` 를 열쇠로 달아 새로 선다.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

/** recharts 의 처음 그리기 시간. 이 동안만 움직임을 켜 두는 그래프(`useRevealAnimating`)가 쓴다. */
const REVEAL_MS = 1500;

const RevealContext = createContext('0');

/** 숨었다 보이는 자리. `visible` 이 다시 참이 될 때마다 안의 그래프들을 처음부터 다시 그린다. */
export function RevealScope({ visible, children }: { visible: boolean; children: ReactNode }) {
  const parent = useContext(RevealContext);
  const [count, setCount] = useState(0);
  const wasVisible = useRef(visible);
  useEffect(() => {
    if (visible && !wasVisible.current) setCount((value) => value + 1);
    wasVisible.current = visible;
  }, [visible]);
  // 바깥 자리가 다시 보여도 안의 그래프가 다시 그려져야 한다. 두 번호를 함께 싣는다.
  return (
    <RevealContext.Provider value={`${parent}/${count}`}>{children}</RevealContext.Provider>
  );
}

/** 그래프에 달 열쇠. 다시 보일 때마다 바뀌어 그래프가 새로 서며 처음처럼 움직인다. */
export function useRevealKey(): string {
  return useContext(RevealContext);
}

/**
 * 그려질 때와 다시 보일 때 잠깐만 참. 끌어서 창을 옮기는 그래프(자산 추이·카드 사용액)는 값이
 * 바뀔 때마다 움직이면 끄는 손을 따라오지 못하므로, 나타날 때만 움직임을 켠다.
 */
export function useRevealAnimating(): boolean {
  const key = useRevealKey();
  const [animating, setAnimating] = useState(true);
  useEffect(() => {
    setAnimating(true);
    const timer = window.setTimeout(() => setAnimating(false), REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [key]);
  return animating;
}
