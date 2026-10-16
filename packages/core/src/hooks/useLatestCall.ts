import { useMemo, useRef } from 'react';

/**
 * 이 받기가 아직 마지막 것인가 (2026-10-16).
 *
 * 가계부·달을 바꾸거나 신호가 겹쳐 다시 받으면 앞 요청이 나중에 끝날 수 있다. 그 답을 그대로 그리면 앞
 * 가계부의 목록(분류·태그·반복·보관함)이 지금 가계부 화면에 서고, 보관함은 그 수를 지금 가계부의 배지로
 * 적었다. 받기를 시작할 때 `begin` 을 부르고, 답을 쓰기 전에 돌려받은 함수로 아직 마지막인지 본다.
 */
export function useLatestCall(): { begin: () => () => boolean } {
  const ref = useRef(0);
  // 늘 같은 객체를 돌려준다. useCallback·useEffect 의 의존성에 넣어도 다시 돌지 않는다.
  return useMemo(
    () => ({
      begin: () => {
        ref.current += 1;
        const mine = ref.current;
        return () => ref.current === mine;
      },
    }),
    [],
  );
}
