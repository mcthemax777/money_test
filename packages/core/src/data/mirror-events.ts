/**
 * 사본이 바뀌었다는 알림.
 *
 * 왜 필요한가. 화면은 사본을 읽고, 동기화는 그 사본을 뒤에서 채운다. 둘을 잇는 것이
 * 없으면 앱을 처음 열었을 때 화면이 빈 사본을 읽은 채로 멈춘다(실제로 그랬다).
 *
 * 값을 실어 보내지 않는다. "바뀌었다"만 알리고 무엇을 다시 읽을지는 화면이 정한다.
 * 실시간 채널이 버전 번호만 보내는 것과 같은 이유다(설계 문서의 D9).
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** 동기화가 사본에 무언가를 적은 뒤 부른다. */
export function notifyMirrorChanged(): void {
  // 복사해서 돈다. 알림 중에 구독을 끊는 화면이 있어도 순회가 깨지지 않는다.
  for (const listener of [...listeners]) listener();
}

/** 구독한다. 돌려주는 함수를 부르면 끊긴다. */
export function onMirrorChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
