import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * 목록 드래그 정렬.
 *
 * 라이브러리 없이 HTML5 드래그 이벤트만 쓴다. 드래그하는 동안은 로컬 순서만 바꿔
 * 화면을 즉시 갱신하고, 손을 뗄 때 한 번만 서버에 저장한다.
 *
 * 반환한 `items`를 렌더링에 쓰고, 각 행에 `dragProps(id)`를 펼쳐 준다.
 */
export function useDragReorder<T extends { id: string }>(
  source: T[],
  onCommit: (ids: string[]) => void,
) {
  const [ids, setIds] = useState<string[]>(() => source.map((item) => item.id));
  const [draggingId, setDraggingId] = useState<string | null>(null);
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

  const moveBefore = (dragged: string, target: string) => {
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
    draggable: true,
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
      // 순서가 그대로면 저장하지 않는다.
      const original = source.map((item) => item.id).join(',');
      if (idsRef.current.join(',') !== original) onCommit(idsRef.current);
    },
  });

  return { items, dragProps, draggingId };
}
