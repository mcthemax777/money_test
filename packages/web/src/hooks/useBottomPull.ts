'use client';

import { useEffect, useRef, useState } from 'react';

/** 다음 쪽을 부르기까지 바닥에서 더 당겨야 하는 거리(px) */
const PULL_THRESHOLD = 72;

/** 당김 표시가 늘어나는 최대 거리. 이보다 더 당겨도 표시는 여기서 멈춘다. */
const PULL_MAX = 96;

/** 당기던 손을 멈추면 표시를 되감기까지 기다리는 시간(ms) */
const PULL_RESET_DELAY = 350;

/**
 * 바닥에서 한 번 더 당기면 다음 쪽을 부른다. 끊어 받는 목록이 함께 쓴다.
 *
 * 닿자마자 이어 붙이지 않는 것이 요점이다. 그러면 목록이 끝나는 자리를 못 만나 스크롤이
 * 끝나지 않고, 사용자가 부른 적 없는 요청이 계속 나간다. 당긴 만큼 바닥이 밀렸다가
 * 제자리로 튕겨 돌아오면서 "여기가 끝, 더 볼 수 있음"이 손끝으로 전해진다.
 *
 * 휠과 손가락을 함께 받는다. 맥의 고무줄 스크롤에만 기대면 그 동작이 없는 브라우저에서는
 * 더 볼 방법이 사라진다.
 *
 * 돌려주는 값은 지금 밀린 거리(px)다. 부르는 쪽이 바닥 표시를 그만큼 내려 그린다.
 */
export function useBottomPull({
  hasMore,
  isLoading,
  count,
  loadMore,
}: {
  hasMore: boolean;
  isLoading: boolean;
  /** 지금 화면에 있는 줄 수. 첫 쪽이 화면을 못 채웠는지 보는 데 쓴다. */
  count: number;
  loadMore: () => void;
}): number {
  const [pull, setPull] = useState(0);
  const pullRef = useRef(0);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
   * 첫 쪽이 화면을 다 못 채우면 스크롤이 없어 당길 수도 없다.
   * 스크롤이 생길 때까지만 스스로 잇는다.
   */
  useEffect(() => {
    if (!hasMore || isLoading || count === 0) return;
    if (document.documentElement.scrollHeight <= window.innerHeight + 8) {
      loadMore();
    }
  }, [count, hasMore, isLoading, loadMore]);

  useEffect(() => {
    if (!hasMore) return;

    const atBottom = () =>
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;

    const settle = () => {
      pullRef.current = 0;
      setPull(0);
    };

    const scheduleSettle = () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(settle, PULL_RESET_DELAY);
    };

    /** 아래로 민 거리를 더한다. 문턱을 넘으면 다음 쪽을 부르고 표시를 되감는다. */
    const addPull = (delta: number) => {
      if (isLoading || delta <= 0 || !atBottom()) {
        if (delta < 0) settle();
        return;
      }
      pullRef.current += delta;
      setPull(Math.min(pullRef.current, PULL_MAX));
      if (pullRef.current >= PULL_THRESHOLD) {
        settle();
        loadMore();
        return;
      }
      scheduleSettle();
    };

    const onWheel = (event: WheelEvent) => addPull(event.deltaY);

    let touchY: number | null = null;
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY;
      if (y === undefined || touchY === null) return;
      // 손가락을 위로 끌면 목록은 아래로 간다. 그 방향만 당김으로 센다.
      addPull(touchY - y);
      touchY = y;
    };
    const onTouchEnd = () => {
      touchY = null;
      settle();
    };

    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, [hasMore, isLoading, loadMore]);

  return pull;
}
