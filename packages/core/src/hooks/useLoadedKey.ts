import { useMemo, useRef } from 'react';

/**
 * 지금 그려 둔 값이 어떤 조건으로 받은 것인가.
 *
 * 다시 받는 까닭이 둘로 갈린다. 조건(프로젝트·기간·검색)이 바뀌면 그려 둔 값은 남의 것이라
 * "불러오는 중"으로 가린다. 같은 조건을 신호(mirrorVersion)나 내 편집으로 다시 받을 때는
 * 그려 둔 값을 둔 채 바꾸기만 하고, 실패해도 그 값을 지우지 않는다 -- 여전히 이 조건의 값이다.
 *
 * 그때도 가리면 본문이 통째로 빠져 페이지가 짧아지고 스크롤이 맨 위로 튄다. 남이 무엇을
 * 고칠 때마다, 탭으로 돌아올 때마다 보던 화면이 새로고침된 것처럼 보였다(분석 탭·보관함).
 *
 * 받아서 그린 뒤에 `mark` 한다. 요청할 때 적으면 조건을 바꾼 직후 받기가 끝나기 전에 온
 * 신호를 같은 조건으로 잘못 보고, 그 받기가 실패하면 앞 조건의 값이 남는다.
 */
export function useLoadedKey(): {
  /** 이 조건의 값을 이미 그려 두었는가. */
  has: (key: string) => boolean;
  /** 이 조건의 값을 받아서 그렸다. 닫히거나 비울 때는 null. */
  mark: (key: string | null) => void;
} {
  const ref = useRef<string | null>(null);
  // 늘 같은 객체를 돌려준다. useCallback·useEffect 의 의존성에 넣어도 다시 돌지 않는다.
  return useMemo(
    () => ({
      has: (key: string) => ref.current === key,
      mark: (key: string | null) => {
        ref.current = key;
      },
    }),
    [],
  );
}
