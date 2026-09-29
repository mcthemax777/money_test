'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** 처음에 세울 줄 수와, 바닥이 가까워질 때마다 더 세울 만큼. 앱과 같은 값이다. */
const FIRST_ROWS = 12;
const MORE_ROWS = 24;

/** 더 세우기 시작하는 거리(px). 세운 줄의 끝까지 화면 하나쯤 남았을 때다. */
const LOOKAHEAD = 800;

/**
 * 긴 목록을 **내려가 볼 때만** 세운다. 앱의 `useRenderBudget`(shell/scroll)과 같은 규칙이다.
 *
 * 한 달을 펴거나 검색으로 여러 기간을 펴면 거래가 수백 건이 된다. 다 세우면 보지도 않을
 * 줄을 그리느라 누른 뒤 첫 화면이 늦다. 그래서 첫 화면을 채울 만큼만 세우고, 세운 줄의
 * 아래 끝(`sentinel` 을 붙인 요소의 아래 변)이 화면 아래에 가까워지면 그만큼 더 세운다.
 *
 * 쓰는 법: 그릴 때 줄 묶음마다 `take(개수)` 를 불러, 돌려받은 수만큼만 앞에서부터 세운다.
 * 몫이 남지 않았어도 **부르기는 한다** -- 세지 않으면 남은 것이 없다고 보고 몫이 더 늘지
 * 않는다. `sentinel` 은 세운 줄을 담은 상자나, 목록 바로 뒤의 빈 칸에 붙인다.
 *
 * `resetKey` 가 바뀌면 처음 몫으로 돌아간다. 앞 목록에서 늘려 둔 몫이 그대로 남으면 새
 * 목록을 한 번에 다 세운다.
 */
export function useRenderBudget(resetKey: string) {
  const [state, setState] = useState({ key: resetKey, budget: FIRST_ROWS });
  // 열쇠가 바뀐 그 그림에서 바로 처음 몫을 쓴다. 효과로 되돌리면 한 번은 다 세운다.
  const budget = state.key === resetKey ? state.budget : FIRST_ROWS;

  const latestKey = useRef(resetKey);
  latestKey.current = resetKey;
  const latestBudget = useRef(budget);
  latestBudget.current = budget;

  /** 이번 그림에서 세우려던 줄의 수. 그릴 때마다 처음부터 센다. */
  const wanted = useRef(0);
  wanted.current = 0;

  const sentinel = useRef<HTMLDivElement>(null);

  const take = (count: number) => {
    const taken = wanted.current;
    wanted.current = taken + count;
    return Math.max(0, Math.min(count, budget - taken));
  };

  const grow = useCallback((room: (current: number) => number) => {
    setState((previous) => {
      const current = previous.key === latestKey.current ? previous.budget : FIRST_ROWS;
      return { key: latestKey.current, budget: room(current) };
    });
  }, []);

  /** 남은 줄이 있고 세운 끝이 화면 아래에 가까우면 늘린다. */
  const check = useCallback(() => {
    if (wanted.current <= latestBudget.current || !sentinel.current) return;
    if (sentinel.current.getBoundingClientRect().bottom > window.innerHeight + LOOKAHEAD) return;
    grow((current) => current + MORE_ROWS);
  }, [grow]);

  /*
   * 그릴 때마다 한 번 잰다. 늘린 줄이 아직 화면을 못 채웠으면 스크롤 없이도 이어야 하고,
   * 스크롤 사건만 들으면 그 자리에서 멈춘다. 남은 줄이 없으면 재지 않고 돌아간다.
   */
  useEffect(check);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        check();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [check]);

  /**
   * 몫을 **지금 세워 둔 만큼**에 첫 몫을 더한 것으로 되돌린다. 펴고 접을 때 부른다.
   *
   * 되돌리지 않으면 큰 달을 폈다 접은 뒤 다른 달을 펼 때 늘어난 몫으로 한 번에 다 세운다.
   * 첫 몫으로 깎으면 세워 둔 줄이 줄어 문서가 짧아지고, 아래쪽을 보던 화면이 위로 튄다.
   */
  const restart = useCallback(
    () => grow((current) => Math.min(wanted.current, current) + FIRST_ROWS),
    [grow],
  );

  return { take, restart, sentinel };
}
