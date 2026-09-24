'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * 굴리는 방향을 따라 숨었다 되돌아오는 머리글.
 *
 * 화면 위에 계속 붙여 두면 긴 목록에서 자리를 빼앗고, 그냥 흘려보내면 탭 하나를
 * 옮기려고 맨 위까지 되돌아가야 한다. 그래서 **내릴 때는 비켜 주고 올릴 때 돌아온다** --
 * 위로 조금만 올려도 제목·탭·검색 조건이 한 덩어리로 내려온다.
 *
 * 되돌아온 머리글 아래에는 그 달의 년월 줄이 붙는다. 그 줄이 설 자리를 알아야 하므로
 * 높이도 함께 내준다.
 */

/** 방향이 바뀌었다고 보기까지 굴러야 하는 거리(px). 손떨림으로 오르내리지 않게 한다. */
const TURN = 16;

export function useTopReveal<T extends HTMLElement>(): {
  ref: RefObject<T | null>;
  /** 머리글의 높이. 아래 붙박이 줄은 이만큼 내려온 자리에 선다. */
  height: number;
  /** 지금 비켜 나 있는가. */
  hidden: boolean;
} {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState(0);
  const [hidden, setHidden] = useState(false);

  /*
   * 높이는 재서 안다. 제목 줄이 두 줄이 되거나 검색 조건이 붙으면 그때마다 달라져
   * 미리 적어 둘 수 없다.
   */
  useEffect(() => {
    const box = ref.current;
    if (!box) return;

    const observer = new ResizeObserver(() => setHeight(box.offsetHeight));
    observer.observe(box);
    setHeight(box.offsetHeight);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let last = window.scrollY;
    /** 같은 방향으로 이어서 구른 거리. 방향이 바뀌면 버린다. */
    let turned = 0;

    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - last;
      last = y;
      if (delta === 0) return;

      /*
       * 머리글이 아직 제자리에 서 있는 동안(맨 위 언저리)에는 감추지 않는다. 감추면
       * 제자리에 있는 것을 위로 밀어내 그 위의 것까지 가린다.
       */
      if (y <= (ref.current?.offsetHeight ?? 0)) {
        turned = 0;
        setHidden(false);
        return;
      }

      if ((delta > 0) !== (turned > 0)) turned = 0;
      turned += delta;

      if (turned > TURN) setHidden(true);
      else if (turned < -TURN) setHidden(false);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return { ref, height, hidden };
}
