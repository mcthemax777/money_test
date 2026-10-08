'use client';

import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';

/** 이만큼(ms) 누르고 있으면 길게 누른 것이다. 안드로이드의 길게 누름과 비슷한 값이다. */
const LONG_PRESS_MS = 500;
/** 누른 채 이만큼(px) 넘게 움직이면 끌거나 훑는 손이다. 길게 누름으로 보지 않는다. */
const MOVE_TOLERANCE = 10;

/**
 * 길게 누름. 손가락·펜·마우스 모두 받는다 (2026-10-09 사용자 요청 -- 거래 목록을 길게 누르면
 * 삭제할 거래 고르기로 들어선다). 앱의 Pressable onLongPress 와 같은 일을 한다.
 *
 * 길게 누른 뒤 따라오는 클릭은 삼킨다. 그대로 두면 고르기로 들어서자마자 줄이 펴지거나 상세가
 * 열린다. 휴대폰 브라우저가 띄우는 길게 누름 메뉴도 막는다.
 *
 * 받은 함수가 없으면 아무 일도 하지 않는다 -- 훅은 늘 부르고 쓸지만 고른다.
 */
export function useLongPress(onLongPress?: () => void) {
  const latest = useRef(onLongPress);
  latest.current = onLongPress;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef({ x: 0, y: 0 });
  /** 이번 누름이 길게 누름으로 끝났는지. 따라오는 클릭을 삼킬지 정한다. */
  const fired = useRef(false);

  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);

  return {
    onPointerDown: (event: PointerEvent) => {
      fired.current = false;
      if (!latest.current) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      start.current = { x: event.clientX, y: event.clientY };
      clear();
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        latest.current?.();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event: PointerEvent) => {
      if (timer.current === null) return;
      const dx = event.clientX - start.current.x;
      const dy = event.clientY - start.current.y;
      if (Math.hypot(dx, dy) > MOVE_TOLERANCE) clear();
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onClickCapture: (event: MouseEvent) => {
      if (!fired.current) return;
      fired.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    onContextMenu: (event: MouseEvent) => {
      if (latest.current && (fired.current || timer.current !== null)) event.preventDefault();
    },
  };
}
