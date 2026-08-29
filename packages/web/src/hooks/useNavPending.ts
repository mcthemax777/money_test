'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * 눌러 둔 메뉴 표시.
 *
 * 다음 화면이 뜨기까지는 시간이 걸린다(그 화면의 코드를 받고, 붙자마자 서버에서
 * 값을 받아 온다). 그 동안 화면이 그대로 있으면 눌린 것인지 멈춘 것인지 알 수
 * 없어 같은 자리를 다시 누르게 된다.
 *
 * 그래서 누르는 즉시 그 메뉴를 켜 둔다. 새 화면이 떠서 경로가 바뀌면 표시를 끈다.
 * 사이드바와 하단 탭이 함께 쓴다.
 */
export function useNavPending() {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  return {
    pendingHref,
    /**
     * 이미 그 화면이면 표시하지 않는다. 경로가 바뀌지 않아 꺼 줄 일이 없어,
     * 표시가 그대로 남는다.
     */
    start: (href: string) => setPendingHref(href === pathname ? null : href),
  };
}
