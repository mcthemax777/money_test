/*
 * 누른 뒤에 무거운 것을 그리는 차례 (2026-10-15 사용자 요청 -- 버튼을 누르면 멈추는 느낌을 없앤다).
 *
 * 탭·화면·팝업을 열 때 누른 그림에서 그 안의 그래프·목록까지 다 그리면, 다 그릴 때까지 누른
 * 표시조차 바뀌지 않아 손끝에서 멈춘 것처럼 느껴진다. 그래서 틀(탭 표시, 밀려 드는 화면, 올라오는
 * 팝업)과 돌림 표시를 먼저 칠하고, **두 그림 뒤에** 내용을 그린다 -- 한 그림 뒤면 그 그림이 미처
 * 칠해지기 전에 바빠진다. 돌림 표시는 네이티브에서 돌아 그리는 동안에도 멈추지 않는다.
 */
import { createContext, useContext, useEffect, useState } from 'react';

/** `active` 가 참이 되고 두 그림이 지난 뒤부터 참. 거짓이 되면 곧바로 거짓이다. */
export function useAfterPaint(active = true): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!active) {
      setReady(false);
      return;
    }
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setReady(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);
  return active && ready;
}

/**
 * 이 화면이 지금 보이는가. 하단 탭 화면은 한 번 열면 지우지 않고 숨겨 두므로(App 의 `Screen`) 숨은
 * 화면도 살아 있다. 숨은 화면이 붙박이 단추를 세우거나 뒤로가기를 가로채면 안 된다 -- 그 둘이 이
 * 값을 본다.
 */
export const ScreenVisibleContext = createContext(true);

export function useScreenVisible(): boolean {
  return useContext(ScreenVisibleContext);
}
