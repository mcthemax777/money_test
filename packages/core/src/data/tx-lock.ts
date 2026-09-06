/**
 * 트랜잭션을 한 줄로 세우는 자물쇠.
 *
 * SQLite 는 연결 하나에 트랜잭션을 겹쳐 열지 못한다. 그런데 동기화는 여러 갈래에서
 * 동시에 시작한다 -- 화면이 프로젝트를 고를 때, 서버가 알림을 보낼 때, 거래를 적자마자.
 * 두 갈래가 같은 연결에서 `BEGIN` 을 겹치면 뒤엣것이 앞 트랜잭션 **안에서** 돌고,
 * 앞이 되돌아갈 때 뒤가 적은 것까지 함께 사라진다. 커서만 남고 사본이 빈 채로 남는
 * 상태가 그렇게 만들어진다 -- 그러면 기기는 받지 못한 변경을 "이미 본 번호"로 여겨
 * 영영 다시 받지 않는다.
 *
 * 그래서 겹치면 그 안에서 돌게 두지 않고 **끝날 때까지 기다린다**. 자바스크립트는 한
 * 줄기로 도니까 앞엣것이 끝난 뒤에 이어 붙이면 그것으로 충분하다.
 *
 * 앞 트랜잭션이 실패해도 뒤엣것은 돈다. 실패는 그것을 부른 쪽의 일이고, 큐에 선 다른
 * 일까지 막을 이유가 없다.
 */
export type TxLock = <T>(task: () => Promise<T>) => Promise<T>;

export function createTxLock(): TxLock {
  let tail: Promise<unknown> = Promise.resolve();

  return <T>(task: () => Promise<T>): Promise<T> => {
    const started = tail.then(task, task);
    tail = started.catch(() => undefined);
    return started;
  };
}
