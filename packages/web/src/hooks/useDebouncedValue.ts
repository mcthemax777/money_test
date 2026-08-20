import { useEffect, useState } from 'react';

/**
 * 값이 잠시 잠잠해질 때까지 기다린다.
 *
 * 필터 체크박스를 연달아 누르면 누를 때마다 서버 조회가 나간다.
 * 마지막 조작만 조회하도록 지연시킨다.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
