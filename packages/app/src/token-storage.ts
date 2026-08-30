/*
 * 토큰 보관. 기기 저장소(SecureStore)에 넣고, 읽기는 메모리에서 한다.
 *
 * core 의 토큰 읽기는 동기다(요청 인터셉터가 매 요청마다 부른다). 기기 저장소는
 * 비동기라 그 자리에서 기다릴 수 없으므로, 앱이 시작할 때 한 번 읽어 메모리에
 * 올려 두고(hydrateTokens) 이후 쓰기만 뒤로 흘려보낸다.
 */
import * as SecureStore from 'expo-secure-store';
import type { TokenStorage } from '@money/core/lib/auth-tokens';

type TokenName = 'accessToken' | 'refreshToken';

const NAMES: TokenName[] = ['accessToken', 'refreshToken'];

const memory = new Map<TokenName, string>();

/** 앱이 시작할 때 한 번. 이 뒤로 동기 읽기가 맞는 값을 준다. */
export async function hydrateTokens(): Promise<void> {
  for (const name of NAMES) {
    try {
      const value = await SecureStore.getItemAsync(name);
      if (value) memory.set(name, value);
    } catch {
      // 저장소를 못 읽어도 앱은 떠야 한다. 로그인 화면에서 다시 넣으면 된다.
    }
  }
}

export const secureTokenStorage: TokenStorage = {
  get: (name) => memory.get(name),

  set: (name, value) => {
    memory.set(name, value);
    // 기기에 남기는 것은 실패해도 이번 실행에는 지장이 없다. 다음 실행에서 다시 로그인한다.
    SecureStore.setItemAsync(name, value).catch(() => {});
  },

  remove: (name) => {
    memory.delete(name);
    SecureStore.deleteItemAsync(name).catch(() => {});
  },
};
