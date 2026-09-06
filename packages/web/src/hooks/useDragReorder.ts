import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

/** 이만큼 누르고 있어야 끌 수 있다. 앱의 `DragList` 와 같은 값이다. */
const HOLD_MS = 220;

/** 자리를 내주는 줄이 미끄러지는 시간. */
const SHIFT_MS = 160;

/**
 * 창 위아래 이만큼 안에 마우스가 들어오면 화면이 따라 굴러간다.
 *
 * 브라우저도 드래그 중에 스스로 굴려 주지만 창의 **맨 끝**에 닿아야 시작한다. 그래서 맨
 * 위의 줄을 맨 아래로 옮기려면 마우스를 화면 끝까지 밀어붙여야 했다. 앱과 같은 폭으로
 * 띠를 두어 그 안에 들어오기만 하면 굴러가게 한다.
 */
const EDGE = 120;

/** 띠의 맨 끝에서의 속도(픽셀/프레임). 안쪽으로 갈수록 0 에 가까워진다. */
const SCROLL_MAX = 16;

/**
 * 목록 드래그 정렬.
 *
 * 라이브러리 없이 HTML5 드래그 이벤트만 쓴다. 드래그하는 동안은 로컬 순서만 바꿔
 * 화면을 즉시 갱신하고, 손을 뗄 때 한 번만 서버에 저장한다.
 *
 * 두 가지를 더 한다.
 *
 *   - **조금 길게 눌러야 잡힌다.** 누르자마자 끌리면 글자를 고르려던 손짓이 드래그가
 *     되어, 목록을 훑기만 해도 자리가 바뀐다. `draggable` 을 처음부터 켜 두지 않고
 *     누르고 있는 동안에만 켠다.
 *   - **자리를 내주는 줄이 미끄러진다.** 순서만 바꾸면 줄들이 순간이동해서 무엇이 어디로
 *     갔는지 눈이 따라가지 못한다. 바뀌기 직전의 자리를 재 두었다가 그 차이만큼 되돌려
 *     놓고 풀어 준다(FLIP). 끌고 있는 줄은 브라우저가 그리는 그림이 따로 있어 건드리지 않는다.
 */
export function useDragReorder<T extends { id: string }>(
  source: T[],
  onCommit: (ids: string[]) => void,
) {
  const [ids, setIds] = useState<string[]>(() => source.map((item) => item.id));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  /** 길게 눌러 잡힌 줄. 이 줄만 draggable 이 켜진다. */
  const [armedId, setArmedId] = useState<string | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 줄의 DOM. 자리를 재고 되돌려 놓는 데 쓴다. */
  const nodes = useRef(new Map<string, HTMLElement>());
  /** 순서가 바뀌기 직전에 잰 자리. */
  const prevTops = useRef(new Map<string, number>());
  // dragEnd 시점에 최신 순서를 읽기 위한 거울. 핸들러가 오래된 값을 붙잡는 것을 막는다.
  const idsRef = useRef(ids);
  idsRef.current = ids;

  // 목록 자체가 바뀌면(추가·삭제·서버 재조회) 로컬 순서를 다시 맞춘다.
  // 의존성에 배열을 그대로 넣으면 매 렌더마다 새 배열이라 무한 루프가 된다.
  const sourceKey = source.map((item) => item.id).join(',');
  useEffect(() => {
    setIds(source.map((item) => item.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  const items = useMemo(() => {
    const byId = new Map(source.map((item) => [item.id, item]));
    const ordered = ids.map((id) => byId.get(id)).filter((item): item is T => Boolean(item));
    // 아직 로컬 순서에 없는 새 항목은 뒤에 붙인다.
    const seen = new Set(ids);
    return [...ordered, ...source.filter((item) => !seen.has(item.id))];
  }, [ids, source]);

  const clearHold = useCallback(() => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }, []);

  useEffect(() => clearHold, [clearHold]);

  /*
   * 자리가 바뀐 만큼 되돌려 놓고 풀어 준다.
   *
   * 순서를 바꾼 렌더 **직후**, 브라우저가 그리기 전에 해야 한다(useLayoutEffect). 그리고
   * 나서 풀면 옮겨 간 자리까지 미끄러진다.
   */
  useLayoutEffect(() => {
    const before = prevTops.current;
    if (before.size === 0) return;
    prevTops.current = new Map();

    for (const [id, node] of nodes.current) {
      const from = before.get(id);
      if (from === undefined || id === draggingId) continue;

      const delta = from - node.getBoundingClientRect().top;
      if (Math.abs(delta) < 1) continue;

      node.style.transition = 'none';
      node.style.transform = `translateY(${delta}px)`;
      // 다음 프레임에 풀어 준다. 같은 프레임에 풀면 브라우저가 한 번에 그려 버린다.
      requestAnimationFrame(() => {
        node.style.transition = `transform ${SHIFT_MS}ms ease-out`;
        node.style.transform = '';
      });
    }
  }, [ids, draggingId]);

  /*
   * 끄는 동안 가장자리에서 화면을 굴린다.
   *
   * 마우스 자리는 `dragover` 로 안다 -- 드래그 중에는 마우스 이벤트가 오지 않는다. 손이
   * 멈춰 있어도 굴러가야 하므로 굴리는 일은 프레임마다 따로 돈다.
   */
  useEffect(() => {
    if (!draggingId) return;

    let speed = 0;
    let frame = 0;

    const onDragOver = (event: DragEvent) => {
      const height = window.innerHeight;
      const fromTop = event.clientY;
      const fromBottom = height - event.clientY;

      speed =
        fromTop < EDGE
          ? -SCROLL_MAX * Math.min(1, (EDGE - fromTop) / EDGE)
          : fromBottom < EDGE
            ? SCROLL_MAX * Math.min(1, (EDGE - fromBottom) / EDGE)
            : 0;
    };

    const tick = () => {
      if (speed !== 0) window.scrollBy(0, speed);
      frame = requestAnimationFrame(tick);
    };

    document.addEventListener('dragover', onDragOver);
    frame = requestAnimationFrame(tick);

    return () => {
      document.removeEventListener('dragover', onDragOver);
      cancelAnimationFrame(frame);
    };
  }, [draggingId]);

  const moveBefore = (dragged: string, target: string) => {
    // 바뀌기 직전의 자리를 재 둔다. 위의 useLayoutEffect 가 이 값을 쓴다.
    prevTops.current = new Map(
      [...nodes.current].map(([id, node]) => [id, node.getBoundingClientRect().top]),
    );

    setIds((prev) => {
      const from = prev.indexOf(dragged);
      const to = prev.indexOf(target);
      if (from < 0 || to < 0 || from === to) return prev;

      const next = [...prev];
      next.splice(from, 1);
      next.splice(to, 0, dragged);
      return next;
    });
  };

  /**
   * 각 행에 펼쳐 주는 드래그 핸들러.
   *
   * 중첩 목록(대분류 안의 소분류)에서 안쪽 드래그가 바깥 목록까지 흔들지 않도록
   * 이벤트 전파를 여기서 끊는다.
   */
  const dragProps = (id: string) => ({
    ref: (node: HTMLElement | null) => {
      if (node) nodes.current.set(id, node);
      else nodes.current.delete(id);
    },
    // 잡히기 전에는 끌 수 없다. 그래야 목록을 훑는 손짓이 드래그가 되지 않는다.
    draggable: armedId === id,
    onPointerDown: (event: React.PointerEvent) => {
      event.stopPropagation();
      clearHold();
      holdTimer.current = setTimeout(() => setArmedId(id), HOLD_MS);
    },
    /*
     * 손을 뗄 때만 푼다.
     *
     * 줄 밖으로 나갔다고 푸는 것은 위험하다. 드래그는 누른 채 밖으로 나가면서 시작되는데,
     * 그 순간 `draggable` 을 꺼 버리면 브라우저가 드래그를 시작하지 못한다.
     */
    onPointerUp: () => {
      clearHold();
      setArmedId(null);
    },
    onPointerCancel: () => {
      clearHold();
      setArmedId(null);
    },
    onDragStart: (event: React.DragEvent) => {
      event.stopPropagation();
      setDraggingId(id);
    },
    // preventDefault가 없으면 브라우저가 드롭을 허용하지 않는다.
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
    },
    onDragEnter: (event: React.DragEvent) => {
      event.stopPropagation();
      if (!draggingId || draggingId === id) return;
      moveBefore(draggingId, id);
    },
    onDragEnd: (event: React.DragEvent) => {
      event.stopPropagation();
      setDraggingId(null);
      setArmedId(null);
      clearHold();
      // 순서가 그대로면 저장하지 않는다.
      const original = source.map((item) => item.id).join(',');
      if (idsRef.current.join(',') !== original) onCommit(idsRef.current);
    },
  });

  return { items, dragProps, draggingId };
}
