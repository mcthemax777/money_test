'use client';

import { useEffect, useRef } from 'react';

/**
 * 우리가 쌓은 칸이라는 표시.
 *
 * 화면에서 닫을 때 그 칸을 되돌려야 하는데, 다른 곳으로 이동한 뒤라면 되돌리면 안 된다.
 * 지금 칸이 우리 것인지를 이 표시로 가른다.
 */
const MARK = '__modalOpen';

/** 열려 있는 팝업들. 뒤로가기는 맨 위 하나만 닫는다 (팝업 위에 팝업이 열릴 수 있다). */
const openModals: Array<() => void> = [];

/**
 * 우리가 스스로 되돌린 칸 수.
 *
 * 화면에서 닫을 때 부르는 history.back()도 popstate를 일으킨다. 그것을 사용자가
 * 누른 것으로 세면 팝업 하나를 닫았는데 그 아래 팝업까지 함께 닫힌다.
 */
let selfBackCount = 0;
let listening = false;

function handlePopState() {
  if (selfBackCount > 0) {
    selfBackCount -= 1;
    return;
  }

  openModals[openModals.length - 1]?.();
}

/**
 * 듣는 자리는 하나만 둔다.
 *
 * 팝업마다 붙였다 떼면, 우리가 부른 back()의 popstate가 도착하기 전에 그 팝업이
 * 사라져 아무도 그것을 받지 못한다. 그러면 다음에 진짜로 누른 뒤로가기가
 * 우리 것으로 잘못 세어진다.
 */
function startListening() {
  if (listening) return;

  window.addEventListener('popstate', handlePopState);
  listening = true;
}

/**
 * 안드로이드의 뒤로가기로 팝업을 닫는다.
 *
 * 휴대폰에서 팝업이 떠 있을 때 뒤로가기를 누르면 앞 화면으로 나가 버렸다. 사용자가
 * 기대하는 것은 "지금 떠 있는 것 하나를 닫는 것"이다.
 *
 * 방법은 히스토리에 칸을 하나 쌓아 두는 것이다. 뒤로가기가 그 칸을 지우면서 알려
 * 주면 팝업을 닫는다. 주소는 그대로 두므로 화면이 옮겨 가지 않는다.
 *
 * 쌓는 값에 지금 칸의 값을 펼쳐 넣는 까닭은 Next가 그 안에 자기 정보를 담아 두기
 * 때문이다. 없이 쌓으면 뒤로가기 때 Next가 "우리가 만든 칸이 아니다"라고 보고
 * 페이지를 통째로 새로 읽는다(app-router의 onPopState).
 */
export function useCloseOnBack(isOpen: boolean, onClose: () => void) {
  /*
   * 닫는 함수는 ref로 들고 있는다.
   *
   * 부르는 쪽이 `onClose={() => setOpen(false)}`처럼 넘기면 그릴 때마다 새 함수라,
   * 의존성에 넣으면 그릴 때마다 칸을 새로 쌓는다.
   */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    startListening();

    /** 뒤로가기로 닫혔는지. 그때는 브라우저가 이미 칸을 지웠으니 되돌릴 것이 없다. */
    let closedByBack = false;
    const close = () => {
      closedByBack = true;
      closeRef.current();
    };

    openModals.push(close);
    window.history.pushState({ ...window.history.state, [MARK]: true }, '');

    return () => {
      const index = openModals.lastIndexOf(close);
      if (index >= 0) openModals.splice(index, 1);

      /*
       * 화면에서 닫았으면(닫기 버튼, 저장, 취소) 우리가 쌓은 칸을 되돌린다.
       * 남겨 두면 팝업을 닫은 뒤의 뒤로가기가 그 칸을 지우는 데 쓰여 아무 일도
       * 일어나지 않는다.
       *
       * 지금 칸이 우리 것이 아니면 건드리지 않는다. 팝업 안에서 다른 화면으로
       * 옮겨 간 경우이고, 그때 되돌리면 사용자가 방금 연 화면에서 튕겨 나간다.
       */
      if (!closedByBack && window.history.state?.[MARK]) {
        selfBackCount += 1;
        window.history.back();
      }
    };
  }, [isOpen]);
}
