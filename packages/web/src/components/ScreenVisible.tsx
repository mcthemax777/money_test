'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * 이 화면이 지금 보이는가 (앱 shell/after-paint 의 같은 이름과 같은 구실).
 *
 * 위에 다른 화면을 덮을 때 아래 화면을 지우지 않고 숨겨 두므로(`hidden`) 숨은 화면도 살아 있다.
 * 숨은 화면이 창의 스크롤을 듣고 줄을 더 세우거나 다음 쪽을 받으면, 보이는 화면을 내릴 때마다
 * 안 보이는 목록이 끝까지 받아 버린다 (2026-10-16). 스크롤에 기대는 훅이 이 값을 본다.
 */
const ScreenVisibleContext = createContext(true);

export function useScreenVisible(): boolean {
  return useContext(ScreenVisibleContext);
}

/** 숨겨 둘 수 있는 화면 덩어리. 바깥이 숨었으면 안도 숨은 것이다. */
export function ScreenVisibility({ visible, children }: { visible: boolean; children: ReactNode }) {
  const parent = useContext(ScreenVisibleContext);
  return (
    <ScreenVisibleContext.Provider value={parent && visible}>{children}</ScreenVisibleContext.Provider>
  );
}
