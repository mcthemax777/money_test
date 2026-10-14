import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * 그릴 때마다 바뀌지 않는 함수. 부르면 늘 최신 `fn` 을 부른다.
 *
 * `memo` 로 감싼 무거운 부품(분석 탭의 그래프 묶음)에 넘길 때 쓴다 -- 그릴 때마다 새 함수를 넘기면
 * 받은 값이 같아도 다시 그려져, 탭 하나를 눌렀는데 숨은 탭까지 다시 그린다 (2026-10-15).
 */
export function useStableCallback<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
): (...args: Args) => Result {
  const ref = useRef(fn);
  /*
   * 그려 낸 뒤에 바꾼다. 그리는 중에 바꾸면 startTransition 으로 버려진 그림의 함수(그리다 만
   * 상태를 본 것)가 남을 수 있다.
   */
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: Args) => ref.current(...args), []);
}
