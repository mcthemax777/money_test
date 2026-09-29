'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * 아이콘 오른쪽 위에 얹는 빨간 건수 배지.
 *
 * 다른 서비스들이 "볼 것이 있다"를 알리는 모양을 그대로 쓴다 -- 파란 글자는 옆 단추들
 * 사이에 묻혀 눈에 들어오지 않았다. 부르는 쪽이 아이콘을 `relative` 인 자리에 두고
 * 이것을 그 안에 넣는다. 0 이하면 그리지 않는다. 글 옆에 나란히 둘 때는 `inline` 을 준다
 * (앱의 CountBadge 와 같은 짝).
 *
 * 나타날 때 튀어 오른다(`globals.css` 의 `badge-pop`). 화면에 들어와 처음 그릴 때와
 * 건수가 늘 때마다 같은 움직임이다. 늘 때는 `key` 를 바꿔 키프레임을 다시 돌린다.
 */
export default function CountBadge({ count, inline }: { count: number; inline?: boolean }) {
  const prevRef = useRef(0);
  const [popKey, setPopKey] = useState(0);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = count;
    // 줄어들 때는 움직이지 않는다. 처리해서 줄어든 것을 다시 알릴 까닭이 없다.
    if (prev > 0 && count > prev) setPopKey((key) => key + 1);
  }, [count]);

  if (count <= 0) return null;

  return (
    <span
      key={popKey}
      aria-hidden
      className={`badge-pop pointer-events-none ${inline ? 'inline-flex' : 'absolute -right-2 -top-1.5 flex'} h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
