'use client';

import { useEffect, useState } from 'react';

/**
 * 이 탭이 보이는가. 다른 탭으로 가거나 창을 내리면 false 다.
 *
 * 몇 초마다 새 글을 묻는 화면(문의하기, 관리 도구의 문의)이 이것을 보고 멈춘다. 보이지 않는
 * 탭이 계속 물으면 헛요청이 쌓이고, 사용자 쪽이면 서버가 "보고 있다"로 읽어 답장 푸시를
 * 보내지 않는다.
 */
export function useIsTabVisible(): boolean {
  const [isVisible, setIsVisible] = useState(true);
  useEffect(() => {
    const update = () => setIsVisible(document.visibilityState === 'visible');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return isVisible;
}
