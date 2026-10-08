'use client';

import { useEffect, useRef } from 'react';

import {
  PERIOD_SWIPE_FOLLOW,
  PERIOD_SWIPE_MS,
  PERIOD_SWIPE_SLIDE,
  claimsPeriodSwipe,
  periodSwipeStep,
} from '@money/core/lib/period-swipe';

/** 손을 뗄 때의 속도를 재는 구간(ms). useDragScroll 과 같은 까닭으로 놓기 직전만 본다. */
const VELOCITY_WINDOW_MS = 100;

/** 들어오고 돌아가는 곡선. 앱(PeriodSwipe)의 Easing.out(cubic) 과 같다. */
const EASE = 'cubic-bezier(0.33, 1, 0.68, 1)';

/**
 * 감싼 자리를 가로로 끌면 기간을 앞뒤로 넘긴다. 날짜 줄의 ‹ › 단추와 같은 일을 한다.
 * 앱의 PeriodSwipe 와 같은 판정(core 의 period-swipe)을 쓴다.
 *
 * 손가락·펜·마우스 모두 받는다. 손가락의 세로 손짓은 브라우저에 남긴다(touch-action: pan-y) --
 * 그래야 이 자리 위에서도 화면이 위아래로 굴러간다. 가로가 세로보다 확실히 클 때만
 * 손을 가져오고, 그 전에 세로로 먼저 움직였으면 이번 손은 보내 준다.
 *
 * 끄는 동안 내용이 손을 조금 따라오고, 넘기면 새 기간이 끈 쪽 반대편에서 미끄러져 들어온다.
 * 값은 style 에 직접 넣는다(useSheetDrag 와 같은 까닭: 매 프레임 화면 전체를 다시 그리지 않게).
 * 움직임 줄이기를 켠 사람에게는 따라오기·미끄러짐 없이 넘기기만 한다.
 */
export function usePeriodSwipe<T extends HTMLElement = HTMLDivElement>(
  /** 옮길 칸 수. 왼쪽으로 밀면 1(다음), 오른쪽으로 밀면 -1(지난)이다. */
  onShift: (delta: 1 | -1) => void,
) {
  const ref = useRef<T>(null);
  /* 효과는 한 번만 건다. 그때그때의 onShift 는 ref 로 들여보낸다. */
  const latest = useRef(onShift);
  latest.current = onShift;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    el.style.touchAction = 'pan-y pinch-zoom';

    /** 누르고 있는 포인터. 아직 가로로 가져온 것은 아니다. */
    let pointerId: number | null = null;
    /** 가로 끌기로 가져왔는지. 여기서부터 포인터를 붙잡고 내용을 움직인다. */
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let samples: Array<{ x: number; t: number }> = [];
    /** 이번 손으로 넘기기를 했는지. 손을 뗀 뒤 따라오는 클릭을 삼킬지 정한다. */
    let swallowClick = false;
    /** 애니메이션이 끝난 뒤 transform 을 걷어 내는 시계. */
    let clearTimer: ReturnType<typeof setTimeout> | null = null;

    const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /*
     * 쉬는 동안에는 transform·opacity 를 비운다. transform 이 남아 있으면 안쪽의 fixed 요소가
     * 화면이 아니라 이 상자에 붙는다.
     */
    const clearStyle = () => {
      if (clearTimer !== null) {
        clearTimeout(clearTimer);
        clearTimer = null;
      }
      el.style.transition = '';
      el.style.transform = '';
      el.style.opacity = '';
    };

    /** 지금 자리에서 제자리(0, 불투명)로 움직이고, 다 가면 style 을 비운다. */
    const settle = () => {
      el.style.transition = `transform ${PERIOD_SWIPE_MS}ms ${EASE}, opacity ${PERIOD_SWIPE_MS}ms ${EASE}`;
      el.style.transform = 'translateX(0px)';
      el.style.opacity = '1';
      clearTimer = setTimeout(clearStyle, PERIOD_SWIPE_MS);
    };

    /** 손을 뗄 때의 가로 속도(px/ms). 오른쪽으로 가는 중이면 양수다. */
    const velocity = (releasedAt: number): number => {
      const recent = samples.filter((sample) => releasedAt - sample.t <= VELOCITY_WINDOW_MS);
      if (recent.length < 2) return 0;
      const first = recent[0];
      const last = recent[recent.length - 1];
      if (last.t <= first.t) return 0;
      return (last.x - first.x) / (last.t - first.t);
    };

    const onPointerDown = (event: PointerEvent) => {
      swallowClick = false;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      pointerId = event.pointerId;
      dragging = false;
      startX = event.clientX;
      startY = event.clientY;
      samples = [{ x: event.clientX, t: event.timeStamp }];
    };

    const onPointerMove = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;

      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      samples.push({ x: event.clientX, t: event.timeStamp });
      samples = samples.filter((sample) => event.timeStamp - sample.t <= VELOCITY_WINDOW_MS);

      if (!dragging) {
        if (claimsPeriodSwipe(dx, dy)) {
          dragging = true;
          clearStyle();
          // 상자 밖으로 나가도 계속 따라오게 한다. 누르자마자 붙잡지 않는 까닭은 useDragScroll 과 같다.
          el.setPointerCapture(event.pointerId);
          // 끄는 동안 글자가 파랗게 잡히면 넘기는 것인지 고르는 것인지 알 수 없다.
          el.style.userSelect = 'none';
        } else {
          // 세로로 먼저 움직인 손이다(가로 판정을 뒤집어 본다). 화면을 훑는 중이니 이번 손은 보내 준다.
          if (claimsPeriodSwipe(dy, dx)) pointerId = null;
          return;
        }
      }

      if (!reducedMotion()) el.style.transform = `translateX(${dx * PERIOD_SWIPE_FOLLOW}px)`;
    };

    const stop = (event: PointerEvent, cancelled: boolean) => {
      if (pointerId !== event.pointerId) return;
      pointerId = null;
      if (!dragging) return;
      dragging = false;

      if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
      el.style.userSelect = '';
      // 끌었으면 넘기든 아니든 손을 뗀 자리의 클릭은 삼킨다(줄을 잡아 끌었을 뿐인데 상세가 열리면 안 된다).
      swallowClick = true;

      const step = cancelled ? 0 : periodSwipeStep(event.clientX - startX, velocity(event.timeStamp));
      if (step !== 0) latest.current(step);

      if (reducedMotion()) {
        clearStyle();
        return;
      }
      if (step !== 0) {
        /*
         * 새 기간을 끈 쪽 반대편에 투명하게 세웠다가 미끄러져 들어오게 한다.
         * 세운 자리가 먼저 그려져야 transition 이 걸리므로 한 번 읽어 배치를 확정한다.
         */
        el.style.transition = 'none';
        el.style.transform = `translateX(${step === 1 ? PERIOD_SWIPE_SLIDE : -PERIOD_SWIPE_SLIDE}px)`;
        el.style.opacity = '0';
        void el.offsetWidth;
      }
      settle();
    };

    const onPointerUp = (event: PointerEvent) => stop(event, false);
    const onPointerCancel = (event: PointerEvent) => stop(event, true);

    /* 끌고 난 뒤의 클릭은 안쪽 단추에 닿기 전에(캡처 단계) 삼킨다. */
    const onClickCapture = (event: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.stopPropagation();
      event.preventDefault();
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerCancel);
    el.addEventListener('click', onClickCapture, true);

    return () => {
      clearStyle();
      el.style.touchAction = '';
      el.style.userSelect = '';
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerCancel);
      el.removeEventListener('click', onClickCapture, true);
    };
  }, []);

  return ref;
}
