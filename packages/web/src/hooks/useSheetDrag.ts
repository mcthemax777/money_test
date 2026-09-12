'use client';

import { useEffect, useRef } from 'react';

/** 768px 은 Tailwind 의 md 다. 창이 아래에 붙는 것도 그 아래 폭에서뿐이다. */
const NARROW = '(max-width: 767px)';

/** 뒤 막의 짙기(bg-black/50 과 같다). 끌어 내리는 동안 이 값에서 0 까지 옅어진다. */
const DIM = 0.5;

/** 이만큼(px) 내려가기 전에는 잡지 않는다. 머리글의 단추를 누른 손이 삼켜지지 않게 한다. */
const TOUCH_SLOP = 6;

/** 이만큼(px) 넘게 내렸으면 손을 떼는 순간 닫는다. 그 아래면 제자리로 돌아간다. */
const DISMISS_DISTANCE = 96;

/**
 * 짧게 튕겨도 닫는 속도(px/ms).
 *
 * 거리만 보면, 빠르게 아래로 쳐 낸 손(많이 내려가기 전에 떼는 손)이 닫히지 않는다.
 * 사람이 "내려 보냈다"고 느끼는 것은 거리가 아니라 마지막 속도다.
 */
const FLICK_VELOCITY = 0.6;

/** 손을 뗀 뒤 제자리로 돌아가거나 마저 내려가는 데 걸리는 시간(ms). */
const SETTLE_MS = 200;

/**
 * 손을 뗄 때의 속도를 재는 구간(ms).
 *
 * 끈 거리 전체로 속도를 내면, 천천히 끌다가 마지막에 튕긴 손이 느린 것으로 나온다
 * (useDragScroll 과 같은 까닭).
 */
const VELOCITY_WINDOW_MS = 100;

/** 오르내리는 곡선. 올라올 때(globals.css 의 sheet-up)와 같은 것을 쓴다. */
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

/**
 * 아래에 붙는 창을 잡아 내려서 닫는다.
 *
 * 좁은 화면의 팝업은 아래에서 올라온다. 올라온 것은 내려서 보내는 것이 손에 맞는데,
 * 닫는 길이 화면 위쪽 끝의 × 뿐이라 한 손으로는 멀었다. 창의 윗부분(손잡이 막대와
 * 머리글)을 아래로 끌면 창이 손끝을 따라 내려가고, 충분히 내렸거나 아래로 튕겼으면
 * 그대로 닫힌다. 조금만 내리고 놓으면 제자리로 돌아온다.
 *
 * 넓은 화면에서는 아무 일도 하지 않는다. 창이 가운데에 떠 있어 내려보낼 곳이 없다.
 *
 * `enabled` 는 창이 떠 있고 끌어 닫아도 되는 동안만 참이다 (예: 저장 중에는 닫히면 안 된다).
 *
 * 쓰는 쪽은 세 자리를 알려 준다 -- `backdropRef` 는 뒤 막(검은 칸), `sheetRef` 는
 * 흰 상자, `handleRef` 는 잡는 자리다. 잡는 자리에는 `touch-none md:touch-auto` 를
 * 함께 둔다. 브라우저가 그 자리의 세로 손짓을 스크롤로 먼저 가져가면 창은 한 픽셀도
 * 따라 내려가지 않는다.
 *
 * 값은 직접 넣는다(state 가 아니라 style). 손끝을 따라가는 것은 매 프레임 일어나는
 * 일이라, 그때마다 팝업 전체를 다시 그리면 긴 목록이 든 창에서 손이 뒤처진다.
 */
export function useSheetDrag(enabled: boolean, onClose: () => void) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);

  /* 닫는 함수는 ref 로 들고 있는다. 그릴 때마다 새 함수라도 붙인 것을 다시 달지 않는다. */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!enabled) return;

    const sheet = sheetRef.current;
    const handle = handleRef.current;
    if (!sheet || !handle) return;

    /** 누르고 있는 포인터. 아직 끌기 시작한 것은 아니다. */
    let pointerId: number | null = null;
    /** 문턱을 넘어 실제로 끌고 있는지. 여기서부터 포인터를 붙잡는다. */
    let dragging = false;
    let startY = 0;
    /** 놓기 직전의 손 위치들. 여기서 속도를 낸다. */
    let samples: Array<{ y: number; t: number }> = [];
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    /** 내려간 만큼 창을 옮기고 뒤 막을 옅게 한다. */
    const paint = (dy: number) => {
      sheet.style.transform = dy > 0 ? `translateY(${dy}px)` : '';

      const backdrop = backdropRef.current;
      if (!backdrop) return;

      const gone = Math.min(1, dy / Math.max(1, sheet.offsetHeight));
      backdrop.style.backgroundColor = `rgba(0, 0, 0, ${DIM * (1 - gone)})`;
    };

    /** 끌던 자국을 지운다. 클래스가 정한 본래 모습으로 돌아간다. */
    const clearPaint = () => {
      sheet.style.transform = '';
      sheet.style.transition = '';
      const backdrop = backdropRef.current;
      if (backdrop) {
        backdrop.style.backgroundColor = '';
        backdrop.style.transition = '';
      }
    };

    /**
     * 손을 뗀 뒤 갈 자리까지 부드럽게 옮긴다.
     *
     * 움직임을 줄여 달라고 한 사람에게는 옮기는 그림 없이 결과만 준다.
     */
    const settle = (to: number, done?: () => void) => {
      if (settleTimer !== null) clearTimeout(settleTimer);

      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        if (done) done();
        else clearPaint();
        return;
      }

      sheet.style.transition = `transform ${SETTLE_MS}ms ${EASE}`;
      const backdrop = backdropRef.current;
      if (backdrop) backdrop.style.transition = `background-color ${SETTLE_MS}ms linear`;
      paint(to);

      settleTimer = setTimeout(() => {
        settleTimer = null;
        // 닫을 때는 자국을 지우지 않는다. 창은 곧 사라지고, 지우면 마지막에 한 번 튄다.
        if (done) done();
        else clearPaint();
      }, SETTLE_MS);
    };

    /** 손을 뗄 때의 속도(px/ms). 아래로 내려가는 중이면 양수다. */
    const dragVelocity = (releasedAt: number): number => {
      const recent = samples.filter((sample) => releasedAt - sample.t <= VELOCITY_WINDOW_MS);
      if (recent.length < 2) return 0;

      const first = recent[0];
      const last = recent[recent.length - 1];
      if (last.t <= first.t) return 0;

      return (last.y - first.y) / (last.t - first.t);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      /* 단추 위에서 시작한 손은 그 단추의 것이다 (닫기, 머리글 단추). */
      if ((event.target as HTMLElement).closest('button, a, input, select, textarea')) return;

      pointerId = event.pointerId;
      dragging = false;
      startY = event.clientY;
      samples = [{ y: event.clientY, t: event.timeStamp }];
    };

    const onPointerMove = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;

      const dy = event.clientY - startY;
      samples.push({ y: event.clientY, t: event.timeStamp });
      // 오래된 표본은 버린다. 손을 뗄 때 남아 있어야 하는 것은 마지막 순간뿐이다.
      samples = samples.filter((sample) => event.timeStamp - sample.t <= VELOCITY_WINDOW_MS);

      if (!dragging) {
        // 위로 가는 손은 잡지 않는다. 올릴 자리가 없는 창이라 따라 올리면 위가 뜬다.
        if (dy <= TOUCH_SLOP) return;

        dragging = true;
        // 창 밖으로 나가도 계속 따라오게 한다. 내리다 보면 손이 화면 끝까지 간다.
        handle.setPointerCapture(event.pointerId);
        /*
         * 올라오는 애니메이션을 끊는다. 그것이 도는 동안에는 transform 을 넣어도
         * 애니메이션이 정한 자리가 이겨서, 막 연 창은 손을 따라오지 않는다.
         */
        sheet.style.animation = 'none';
        sheet.style.transition = '';
        sheet.style.userSelect = 'none';
      }

      paint(Math.max(0, dy));
    };

    const stop = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;

      const wasDragging = dragging;
      const dy = event.clientY - startY;
      const velocity = dragVelocity(event.timeStamp);
      pointerId = null;
      dragging = false;

      if (!wasDragging) return;

      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      sheet.style.userSelect = '';

      if (dy > DISMISS_DISTANCE || velocity > FLICK_VELOCITY) {
        settle(sheet.offsetHeight, () => closeRef.current());
        return;
      }
      settle(0);
    };

    /** 붙였다 떼는 자리. 넓은 화면에서는 붙이지 않는다. */
    let attached = false;

    const attach = () => {
      if (attached) return;
      attached = true;
      handle.addEventListener('pointerdown', onPointerDown);
      handle.addEventListener('pointermove', onPointerMove);
      handle.addEventListener('pointerup', stop);
      handle.addEventListener('pointercancel', stop);
    };

    const detach = () => {
      if (!attached) return;
      attached = false;
      handle.removeEventListener('pointerdown', onPointerDown);
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);

      if (settleTimer !== null) clearTimeout(settleTimer);
      settleTimer = null;
      pointerId = null;
      dragging = false;
      sheet.style.userSelect = '';
      clearPaint();
    };

    /*
     * 창이 떠 있는 동안 화면이 넓어질 수 있다 (태블릿을 돌리거나 창을 늘렸다).
     * 그때 창은 가운데로 가므로 내려보내는 손도 함께 거둔다.
     */
    const narrow = window.matchMedia(NARROW);
    const sync = () => (narrow.matches ? attach() : detach());
    sync();
    narrow.addEventListener('change', sync);

    return () => {
      narrow.removeEventListener('change', sync);
      detach();
    };
  }, [enabled]);

  return { backdropRef, sheetRef, handleRef };
}
