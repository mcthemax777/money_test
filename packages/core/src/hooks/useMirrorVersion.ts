import { useEffect, useState } from 'react';

import { onMirrorChanged } from '../data/mirror-events';

/**
 * 사본이 바뀔 때마다 올라가는 번호.
 *
 * 조회 훅의 의존성에 넣어 두면 동기화가 사본을 채운 뒤 화면이 다시 읽는다.
 * 웹은 사본이 없어 이 값이 0에 머무르므로 아무 일도 일어나지 않는다.
 */
export function useMirrorVersion(): number {
  const [version, setVersion] = useState(0);

  useEffect(() => onMirrorChanged(() => setVersion((value) => value + 1)), []);

  return version;
}
