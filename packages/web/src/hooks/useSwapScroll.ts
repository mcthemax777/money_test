'use client';

import { useLayoutEffect, useRef } from 'react';

/**
 * 화면을 제자리에서 다른 보기로 바꿔 그릴 때의 스크롤. 펴면 맨 위로, 돌아오면 떠날 때 보던 자리로.
 *
 * 자리는 여는 손짓에서 적는다(돌려주는 `remember`) -- 바꿔 그린 뒤에는 문서가 짧아져 이미
 * 끌어올려져 있다. 거래 화면의 분석, 예산 화면의 분석이 쓴다.
 */
export function useSwapScroll(isOpen: boolean): () => void {
  const savedY = useRef(0);
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (isOpen === wasOpen.current) return;
    wasOpen.current = isOpen;
    const top = isOpen ? 0 : savedY.current;
    window.scrollTo({ top });
    if (isOpen) return;
    /*
     * 닫을 때는 브라우저가 히스토리 칸에 적힌 스크롤(펼 때의 0)을 되살려 위의 자리를
     * 덮는다. 크롬은 그것을 popstate 를 보낸 **뒤에** 한다(실측). 그래서 그다음 프레임에 한 번 더
     * 맞춘다 -- 브라우저 뒤로가기면 이 그림이 그 popstate 안에서 그려졌으니 지금 미루면 되고,
     * ← 면 뒤로가기용으로 쌓아 둔 칸을 이 뒤에 되돌리므로(`useCloseOnBack`) 그 popstate 를
     * 기다린다. 오지 않을 popstate 는 오래 기다리지 않는다.
     */
    const again = () => window.requestAnimationFrame(() => window.scrollTo({ top }));
    again();
    window.addEventListener('popstate', again, { once: true });
    const timer = window.setTimeout(() => window.removeEventListener('popstate', again), 500);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('popstate', again);
    };
  }, [isOpen]);
  return () => {
    savedY.current = window.scrollY;
  };
}
