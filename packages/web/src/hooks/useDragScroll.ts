'use client';

import { useEffect, useRef } from 'react';

/** 이만큼 넘게 끌었으면 "넘긴 것"으로 본다. 손이 조금 흔들린 것까지 세면 클릭이 삼켜진다. */
const DRAG_THRESHOLD = 5;

/**
 * 마우스로 끌어서 옆으로 넘기기.
 *
 * 가로로 늘어놓은 칸(홈의 그래프, 실적 구간 카드)은 손가락으로는 밀어서 넘기고
 * 트랙패드로는 두 손가락으로 넘긴다. 그런데 휠만 있는 마우스에는 가로로 굴릴 것이
 * 없어서, 누르고 옆으로 끌어도 아무 일도 일어나지 않았다.
 *
 * 손가락과 펜은 건드리지 않는다. 브라우저가 이미 끌어서 넘겨 주고, 여기서 가로채면
 * 위아래로 넘기던 것까지 함께 잡아 화면이 세로로 움직이지 않게 된다.
 */
export function useDragScroll<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    /** 누르고 있는 포인터. 아직 끌기 시작한 것은 아니다. */
    let pointerId: number | null = null;
    /** 문턱을 넘어 실제로 끌고 있는지. 여기서부터 포인터를 붙잡는다. */
    let dragging = false;
    let startX = 0;
    let startScrollLeft = 0;
    /** 이번에 끈 거리. 끌고 난 뒤의 클릭을 삼킬지 정한다. */
    let moved = 0;

    const canScroll = () => el.scrollWidth > el.clientWidth;

    /** 넘길 것이 있을 때만 "끌 수 있다"고 알린다. */
    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      el.style.cursor = canScroll() ? 'grab' : '';
    };

    const onPointerDown = (event: PointerEvent) => {
      // 손가락으로 누른 뒤의 클릭까지 삼키지 않도록 여기서 먼저 지운다.
      moved = 0;
      if (event.pointerType !== 'mouse' || event.button !== 0 || !canScroll()) return;

      pointerId = event.pointerId;
      dragging = false;
      startX = event.clientX;
      startScrollLeft = el.scrollLeft;
    };

    /*
     * 문턱을 넘은 뒤에야 붙잡는다.
     *
     * 누르자마자 setPointerCapture를 걸면 뒤따르는 mouseup이 이 칸으로 옮겨져,
     * 카드 위에서 눌렀는데도 click이 카드가 아니라 이 칸에서 일어난다. 그러면
     * 카드를 눌러도 아무 일도 일어나지 않는다. 그냥 누른 것과 끌기 시작한 것을
     * 갈라 두면 클릭은 예전 그대로 지나간다.
     */
    const beginDrag = () => {
      if (pointerId === null) return;
      dragging = true;
      // 칸 밖으로 나가도 계속 따라오게 한다. 넘기다 보면 손이 그림 밖으로 나간다.
      el.setPointerCapture(pointerId);
      el.style.cursor = 'grabbing';
      // 끄는 동안 글자가 파랗게 잡히면 넘기는 것인지 고르는 것인지 알 수 없다.
      el.style.userSelect = 'none';
      /*
       * 끄는 동안에는 칸 맞춤(scroll-snap)을 끈다.
       *
       * mandatory 맞춤은 scrollLeft를 넣을 때마다 가장 가까운 칸으로 되돌려서,
       * 끌고 있는 손을 그림이 따라오지 못하고 튄다. 손을 떼면 다시 켜므로
       * 넘긴 뒤에는 여전히 칸에 맞춰 선다.
       */
      el.style.scrollSnapType = 'none';
    };

    const onPointerMove = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;

      const dx = event.clientX - startX;
      moved = Math.max(moved, Math.abs(dx));
      if (!dragging) {
        if (moved <= DRAG_THRESHOLD) return;
        beginDrag();
      }
      el.scrollLeft = startScrollLeft - dx;
    };

    const stop = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;

      if (dragging) {
        if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
        el.style.cursor = canScroll() ? 'grab' : '';
        el.style.userSelect = '';
        el.style.scrollSnapType = '';
      }
      pointerId = null;
      dragging = false;
    };

    /*
     * 끌고 난 뒤의 클릭은 삼킨다.
     *
     * 카드를 잡아 옆으로 넘겼을 뿐인데 손을 떼는 순간 그 카드의 팝업이 열리면
     * 안 된다. 안쪽 버튼에 닿기 전에 잡아야 하므로 캡처 단계에서 본다.
     */
    const onClickCapture = (event: MouseEvent) => {
      if (moved <= DRAG_THRESHOLD) return;
      event.stopPropagation();
      event.preventDefault();
      moved = 0;
    };

    el.addEventListener('pointerover', onPointerOver);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
    el.addEventListener('click', onClickCapture, true);

    return () => {
      el.removeEventListener('pointerover', onPointerOver);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', stop);
      el.removeEventListener('pointercancel', stop);
      el.removeEventListener('click', onClickCapture, true);
    };
  }, []);

  return ref;
}
