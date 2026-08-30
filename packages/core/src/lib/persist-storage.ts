import type { StateStorage } from 'zustand/middleware';

/**
 * 스토어를 어디에 남길지.
 *
 * 웹은 브라우저의 localStorage, 앱은 AsyncStorage 다. 스토어들이 만들어지는 시점은
 * import 시점이라 그때는 아직 앱이 저장소를 정하지 못한다. 그래서 스토어에는 이
 * 껍데기를 주고, 실제 대상은 읽고 쓸 때마다 본다.
 *
 * 껍데기 없이 저장소를 곧바로 넘기면, 저장소가 없는 곳(앱)에서 zustand 가 persist
 * 기능 자체를 붙이지 않는다. 그러면 나중에 갈아 끼울 자리도 사라진다.
 */
let adapter: StateStorage | null = defaultStorage();

function defaultStorage(): StateStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage ?? null;
  } catch {
    // 브라우저가 사이트 데이터를 막아 둔 경우. 남기지 않을 뿐 화면은 돈다.
    return null;
  }
}

/** 앱이 시작할 때 부른다. 부르기 전까지는 아무것도 남지 않는다. */
export function setPersistStorage(next: StateStorage | null): void {
  adapter = next;
}

/** 스토어들이 쓰는 저장소. 대상이 없으면 "저장된 것이 없다"로 답한다. */
export const persistStorage: StateStorage = {
  getItem: (name) => adapter?.getItem(name) ?? null,
  setItem: (name, value) => adapter?.setItem(name, value),
  removeItem: (name) => adapter?.removeItem(name),
};
