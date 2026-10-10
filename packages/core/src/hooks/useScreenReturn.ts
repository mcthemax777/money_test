import { useState } from 'react';

/**
 * 위에 덮어 연 화면을 닫고 앞 화면으로 돌아왔는가 (2026-10-10 사용자 요청, 웹·앱 같음).
 *
 * 덮은 동안 앞 화면은 그리지 않다가 닫히면 새로 그려진다. 그 첫 그림에 "제자리로 돌아오는"
 * 움직임을 붙이려고 쓴다 -- 처음 열 때는 false 라 아무 움직임도 없다. 한 번 true 가 되면 그대로다.
 * 움직임은 그려질 때 한 번만 돌므로 남아 있어도 다시 돌지 않는다.
 */
export function useScreenReturn(isCovered: boolean): boolean {
  const [wasCovered, setWasCovered] = useState(isCovered);
  const [hasReturned, setHasReturned] = useState(false);
  if (wasCovered !== isCovered) {
    setWasCovered(isCovered);
    if (!isCovered) setHasReturned(true);
  }
  return hasReturned;
}
