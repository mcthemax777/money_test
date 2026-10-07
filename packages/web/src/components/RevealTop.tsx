'use client';

import type { ReactNode } from 'react';

import type { useTopReveal } from '@/hooks/useTopReveal';

/**
 * 굴리는 방향을 따라 숨었다 되돌아오는 위쪽 덩어리의 상자 (앱의 RevealTop 과 같은 짝).
 * 움직임은 `useTopReveal` 이 정하고 여기는 그 상자를 그린다. 거래·분석 화면이 함께 쓴다.
 *
 * 바탕은 페이지와 같은 회색이고 좌우 여백 바깥까지 늘린다(-mx-4). 그러지 않으면 아래를
 * 지나가는 줄이 양옆 여백으로 비쳐 보인다. 위쪽 여백은 페이지의 것을 그대로 먹어
 * (-mt-4 pt-4) 붙는 순간에 글자가 튀지 않게 한다.
 */
export default function RevealTop({
  reveal,
  children,
}: {
  reveal: ReturnType<typeof useTopReveal<HTMLDivElement>>;
  children: ReactNode;
}) {
  return (
    <div
      ref={reveal.ref}
      className="sticky top-0 z-30 -mx-4 -mt-4 space-y-4 bg-gray-50 px-4 pb-2 pt-4 transition-transform duration-200 ease-out motion-reduce:transition-none md:-mt-8 md:pt-8"
      style={{ transform: `translateY(${-reveal.offset}px)` }}
    >
      {children}
    </div>
  );
}
