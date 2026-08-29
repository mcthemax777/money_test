'use client';

import { useEffect, useRef } from 'react';

import { flickTarget, itemStarts } from '@/lib/carousel';

/** 이만큼 넘게 끌었으면 "넘긴 것"으로 본다. 손이 조금 흔들린 것까지 세면 클릭이 삼켜진다. */
const DRAG_THRESHOLD = 5;

/**
 * 손을 뗀 뒤 칸에 붙는 움직임이 끝나기를 기다리는 시간(ms).
 *
 * scrollend를 아직 보내지 않는 브라우저가 있어 시간으로도 받아 둔다. 둘 중
 * 먼저 오는 쪽에서 맞춤을 되켠다.
 */
const SETTLE_TIMEOUT_MS = 700;

/**
 * 손을 뗄 때의 속도를 재는 구간(ms).
 *
 * 끈 거리 전체로 속도를 내면, 천천히 끌다가 마지막에 튕긴 손이 느린 것으로 나온다.
 * 사람이 "얼마나 세게 던졌나"로 느끼는 것은 놓기 직전의 짧은 순간이다.
 */
const VELOCITY_WINDOW_MS = 100;

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
    /** 놓기 직전의 손 위치들. 여기서 속도를 낸다. */
    let samples: Array<{ x: number; t: number }> = [];

    const canScroll = () => el.scrollWidth > el.clientWidth;

    /** 손을 뗀 뒤 칸에 붙는 중인지. 다시 잡으면 그만둔다. */
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    /** 맞춤을 되켠다. 이미 칸에 서 있을 때 켜야 튀지 않는다. */
    const restoreSnap = () => {
      cancelSettle();
      el.style.scrollSnapType = '';
    };

    /** 칸에 붙기를 기다리던 것을 거둔다. */
    const cancelSettle = () => {
      if (settleTimer !== null) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
      el.removeEventListener('scrollend', restoreSnap);
    };

    /*
     * 손을 뗀 뒤 칸으로 부드럽게 붙인다.
     *
     * 붙을 칸은 끈 방향과 손을 뗄 때의 속도로 정한다(lib/carousel의 flickTarget).
     * 살짝 밀어도 다음 칸으로 넘어가고, 세게 튕기면 그만큼 여러 칸을 건너뛴다.
     *
     * 브라우저의 맞춤(scroll-snap)에 맡기지 않는 까닭이 둘이다. 맞춤은 가장 가까운
     * 칸을 고르므로 반 넘게 끌어야 넘어가고, 켜는 순간 애니메이션 없이 순간이동한다.
     * 우리가 먼저 부드럽게 옮기고, 다 옮겨 칸에 선 뒤에 맞춤을 되켠다. 켜는 순간
     * 이미 칸에 서 있으므로 브라우저가 더 옮길 것이 없다.
     */
    const settle = (velocity: number) => {
      const target = flickTarget({
        starts: itemStarts(el),
        from: startScrollLeft,
        current: el.scrollLeft,
        velocity,
        maxScroll: el.scrollWidth - el.clientWidth,
      });

      if (Math.abs(target - el.scrollLeft) <= 1) {
        restoreSnap();
        return;
      }

      el.scrollTo({ left: target, behavior: 'smooth' });
      el.addEventListener('scrollend', restoreSnap, { once: true });
      settleTimer = setTimeout(restoreSnap, SETTLE_TIMEOUT_MS);
    };

    /**
     * 손을 뗄 때의 스크롤 속도(px/ms). 오른쪽으로 넘기는 중이면 양수다.
     *
     * 손이 왼쪽으로 가면 그림은 오른쪽으로 넘어가므로 부호를 뒤집는다.
     * 끌다가 멈춘 뒤 손을 떼면 최근 표본이 없어 0이 되고, 그때는 미끄러지지 않는다.
     */
    const scrollVelocity = (releasedAt: number): number => {
      const recent = samples.filter((sample) => releasedAt - sample.t <= VELOCITY_WINDOW_MS);
      if (recent.length < 2) return 0;

      const first = recent[0];
      const last = recent[recent.length - 1];
      if (last.t <= first.t) return 0;

      return -(last.x - first.x) / (last.t - first.t);
    };

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
      samples = [{ x: event.clientX, t: event.timeStamp }];
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
      /*
       * 칸에 붙는 중이었다면 그 기다림을 거둔다.
       *
       * 누르기만 한 것으로는 거두지 않는다. 그러면 잡았다가 그냥 놓은 자리에서
       * 맞춤이 꺼진 채로 남는다. 실제로 끌기 시작한 지금은 아래에서 다시 끄고,
       * 손을 뗄 때 settle이 다시 켠다.
       */
      cancelSettle();
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

      samples.push({ x: event.clientX, t: event.timeStamp });
      // 오래된 표본은 버린다. 손을 뗄 때 남아 있어야 하는 것은 마지막 순간뿐이다.
      samples = samples.filter((sample) => event.timeStamp - sample.t <= VELOCITY_WINDOW_MS);
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
        settle(scrollVelocity(event.timeStamp));
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
      cancelSettle();
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
