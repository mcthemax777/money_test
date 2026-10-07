'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * 굴리는 방향을 따라 숨었다 되돌아오는 머리글.
 *
 * 화면 위에 계속 붙여 두면 긴 목록에서 자리를 빼앗고, 그냥 흘려보내면 탭 하나를
 * 옮기려고 맨 위까지 되돌아가야 한다. 그래서 **내릴 때는 비켜 주고 올릴 때 돌아온다** --
 * 위로 조금만 올려도 제목·탭·검색 조건이 한 덩어리로 내려온다.
 *
 * 되돌아온 머리글 아래에는 그 달의 년월 줄이 붙는다. 그 줄이 설 자리를 알아야 하므로
 * 높이도 함께 내준다.
 *
 * **걸어 둔 조건은 비켜서지 않는다**(2026-10-07 사용자 요청). `keepRef` 를 건 상자(탭과 그
 * 아래 조건 알약 줄)부터 아래는 화면 위에 남고 그 위(제목 줄)만 비켜선다 -- 무엇으로 거른
 * 목록인지는 내려가는 내내 보여야 한다. 상자가 없으면(조건이 없으면) 예전처럼 통째로 비켜선다.
 */

/** 남겨 둔 상자 위에 남기는 틈(px). 붙어 있는 동안 알약이 화면 끝에 닿지 않게 한다. */
const KEEP_GAP = 8;

/** 방향이 바뀌었다고 보기까지 굴러야 하는 거리(px). 손떨림으로 오르내리지 않게 한다. */
const TURN = 16;

export function useTopReveal<T extends HTMLElement>(): {
  /**
   * 머리글 상자에 걸 자리.
   *
   * `RefObject<T | null>` 이라 적지 않는다. 그 이름이 가리키는 모양이 @types/react
   * 18 과 19 에서 다르다 -- 18 은 `{ readonly current: T | null }`, 19 는
   * `{ current: T }` 다. 이 저장소에는 둘 다 있고(웹 18, 앱 19) 설치 배치에 따라
   * 한 컴파일 안에서 섞이면 `ref=` 가 받지 못하는 짝이 나온다 -- 2026-09-26 배포
   * 서버의 next build 가 그렇게 깨졌다(로컬에서는 18 로만 풀려 통과했다).
   * 모양을 그대로 적으면 어느 쪽으로 풀려도 들어맞는다.
   */
  ref: { current: T | null };
  /** 비켜설 때도 남길 상자(탭과 조건 알약 줄)에 걸 자리. 모양을 그대로 적는 까닭은 위와 같다. */
  keepRef: { current: HTMLDivElement | null };
  /** 지금 위로 비켜난 거리. 머리글 상자를 이만큼 끌어올린다. */
  offset: number;
  /** 지금 화면에 내려와 있는 높이. 아래 붙박이 줄은 이만큼 내려온 자리에 선다. */
  inset: number;
} {
  const ref = useRef<T>(null);
  const keepRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  /** 비켜설 때 올라갈 거리. 남길 상자가 있으면 그 위까지, 없으면 제 높이 전부다. */
  const [hideBy, setHideBy] = useState(0);
  const [hidden, setHidden] = useState(false);

  /*
   * 높이는 재서 안다. 제목 줄이 두 줄이 되거나 검색 조건이 붙으면 그때마다 달라져
   * 미리 적어 둘 수 없다.
   */
  useEffect(() => {
    const box = ref.current;
    if (!box) return;

    /*
     * 남길 상자의 자리는 머리글 상자 안에서 잰다(머리글이 sticky 라 offsetTop 의 기준이다).
     * 조건 알약이 붙거나 빠지면 머리글 높이가 바뀌어 여기가 다시 불린다.
     */
    const measure = () => {
      setHeight(box.offsetHeight);
      const keep = keepRef.current;
      setHideBy(keep ? Math.max(0, keep.offsetTop - KEEP_GAP) : box.offsetHeight);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    measure();
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

  const offset = hidden ? hideBy : 0;
  return { ref, keepRef, offset, inset: height - offset };
}
