/**
 * 화면이 받아 둔 값. 화면이 사라져도 남는다.
 *
 * 하단 탭을 옮기면 화면이 통째로 새로 서고, 그 화면의 훅도 빈 값에서 다시 시작해 "불러오는 중"을
 * 띄웠다 (2026-10-15 사용자 요청 -- 팝업처럼 로딩 없이). 훅은 받은 값을 조건 열쇠와 함께 여기 적고,
 * 다시 설 때 같은 열쇠의 값이 있으면 그것으로 곧바로 그린 뒤 뒤에서 조용히 새로 받는다
 * (`useLoadedKey` 의 "같은 조건이면 가리지 않는다"와 같은 규칙이다).
 *
 * 열쇠에 가계부·사람·기간·검색이 다 들어 있어야 한다 -- 다른 조건의 값을 이 조건의 것으로 그리면
 * 남의 숫자가 잠깐 보인다. 열쇠가 다르면 없는 것으로 본다.
 *
 * 메모리에만 둔다. 앱을 다시 켜면 비어 있고, 로그아웃하면 비운다(`clearScreenCache`).
 */

/** 이만큼만 든다. 오래 쓰지 않은 것부터 버린다 -- 조건을 이리저리 바꿔도 메모리가 늘지 않는다. */
const LIMIT = 60;

const store = new Map<string, unknown>();

const entryKey = (slot: string, key: string) => `${slot}\u0000${key}`;

/** 그 훅(slot)이 이 조건(key)으로 받아 둔 값. 없으면 undefined. */
export function readScreenCache<T>(slot: string, key: string): T | undefined {
  const at = entryKey(slot, key);
  if (!store.has(at)) return undefined;
  const value = store.get(at) as T;
  // 막 쓴 것을 맨 뒤로 -- 버릴 때 앞에서부터 버린다.
  store.delete(at);
  store.set(at, value);
  return value;
}

/** 받은 값을 적는다. 같은 조건의 옛 값을 덮는다. */
export function writeScreenCache<T>(slot: string, key: string, value: T): void {
  const at = entryKey(slot, key);
  store.delete(at);
  store.set(at, value);
  while (store.size > LIMIT) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/** 다 비운다. 다른 사람이 같은 기기로 들어왔을 때 앞사람의 값이 그려지지 않게. */
export function clearScreenCache(): void {
  store.clear();
}
