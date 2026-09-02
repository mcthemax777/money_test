/**
 * 세션이 끝나고 시작할 때 기기 사본을 어떻게 다루는지 검사.
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/session-mirror-smoke.ts
 *
 * 왜 이것을 검사하는가. 사본을 버리는 판단은 눈으로 읽어서는 맞는지 알기 어렵고,
 * 틀려도 화면에 아무 표시가 나지 않는다. 두 방향으로 조용히 틀린다.
 *
 *   - 덜 버리면 남의 기기에 앞 사람의 가계부가 남는다.
 *   - 더 버리면 일주일 만에 앱을 연 사람이 자기가 오프라인에서 적은 것을 잃는다.
 *     (설계 문서 D10. 리프레시 토큰이 7일이라 401 은 드문 일이 아니다.)
 *
 * 그래서 세 갈래를 하나씩 본다. 로그아웃은 버리고, 401 은 두고, 주인이 바뀌면 버린다.
 */
import { setMirrorTeardown } from '../src/data/mirror-teardown';
import { apiClient } from '../src/lib/api-client';
import { saveAuthTokens, setTokenStorage, type TokenStorage } from '../src/lib/auth-tokens';
import { useAuth } from '../src/store/auth';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

/** 쿠키 대신 쓸 저장소. 노드에는 document 가 없다. */
function memoryTokenStorage(): TokenStorage {
  const box = new Map<string, string>();
  return {
    get: (name) => box.get(name),
    set: (name, value) => void box.set(name, value),
    remove: (name) => void box.delete(name),
  };
}

/** 사본을 지웠는지 세는 자리표. 실제 앱에서는 SQLite 파일을 지운다. */
let cleared = 0;
function installTeardown(behavior: 'ok' | 'throw' = 'ok') {
  cleared = 0;
  setMirrorTeardown(async () => {
    cleared += 1;
    if (behavior === 'throw') throw new Error('파일을 지우지 못했다');
  });
}

/**
 * 로그인한 상태로 만든다. 서버에 닿지 않고 스토어와 토큰만 그 모양으로 둔다.
 *
 * 토큰까지 넣어야 하는 이유가 있다. loadUser 는 토큰이 없으면 서버를 부르기도 전에
 * "로그인하지 않았다"로 끝낸다. 그래서 토큰 없이 부르면 401 검사도 오프라인 검사도
 * 그 이른 반환을 보고 통과해 버린다 (실제로 한 번 그렇게 거짓 통과했다).
 */
function signedInAs(userId: string) {
  saveAuthTokens('access-token', 'refresh-token');
  useAuth.setState({
    user: { id: userId, email: `${userId}@example.com`, name: userId, avatar: null },
    isAuthenticated: true,
    isInitializing: false,
  });
}

type ApiStub = Partial<Record<'signInWithGoogle' | 'getProfile' | 'logout', unknown>>;
function stubApi(stub: ApiStub) {
  Object.assign(apiClient, stub);
}

/** 서버가 준 것처럼 보이는 응답. auth 스토어가 보는 필드만 담는다. */
function loginResponse(userId: string) {
  return {
    accessToken: 'access',
    refreshToken: 'refresh',
    user: { id: userId, email: `${userId}@example.com`, name: userId, avatar: null },
    defaultProjectData: null,
  };
}

/** 서버가 거절한 경우. 인터셉터를 거친 뒤 스토어가 보는 모양과 같다. */
function unauthorizedError() {
  return Object.assign(new Error('Unauthorized'), { response: { status: 401 } });
}

/** 서버에 닿지 못한 경우. isOfflineError 가 이것을 오프라인으로 읽어야 한다. */
function networkError() {
  return Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
}

(async () => {
  setTokenStorage(memoryTokenStorage());

  // 1. 로그아웃은 사본을 버린다.
  installTeardown();
  stubApi({ logout: async () => undefined });
  signedInAs('user-a');
  await useAuth.getState().logout();
  eq('로그아웃하면 사본을 버린다', cleared, 1);
  eq('로그아웃하면 세션도 끝난다', useAuth.getState().isAuthenticated, false);

  // 2. 사본을 지우다 실패해도 세션 정리는 끝까지 간다.
  installTeardown('throw');
  signedInAs('user-a');
  await useAuth.getState().logout();
  eq('지우기가 실패해도 던지지 않는다', cleared, 1);
  eq('세션은 그래도 정리된다', useAuth.getState().isAuthenticated, false);

  // 3. 401 은 세션만 끊고 사본은 둔다. (D10)
  installTeardown();
  stubApi({ getProfile: async () => Promise.reject(unauthorizedError()) });
  signedInAs('user-a');
  await useAuth.getState().loadUser();
  eq('401 이면 사본을 두고', cleared, 0);
  eq('세션만 끊는다', useAuth.getState().isAuthenticated, false);

  // 4. 오프라인이면 세션도 사본도 그대로다.
  installTeardown();
  stubApi({ getProfile: async () => Promise.reject(networkError()) });
  signedInAs('user-a');
  await useAuth.getState().loadUser();
  eq('오프라인이면 사본을 두고', cleared, 0);
  eq('세션도 지킨다', useAuth.getState().isAuthenticated, true);

  // 5. 다른 사용자가 들어오면 버린다. 401 로 세션만 끊긴 뒤의 길이다.
  installTeardown();
  stubApi({ signInWithGoogle: async () => loginResponse('user-b') });
  signedInAs('user-a');
  useAuth.setState({ isAuthenticated: false });
  await useAuth.getState().signInWithGoogle('id-token');
  eq('주인이 바뀌면 사본을 버린다', cleared, 1);
  eq('새 사용자로 들어간다', useAuth.getState().user?.id, 'user-b');

  // 6. 같은 사용자가 다시 들어오면 버리지 않는다. 적어 둔 것이 남아야 한다.
  installTeardown();
  stubApi({ signInWithGoogle: async () => loginResponse('user-a') });
  signedInAs('user-a');
  useAuth.setState({ isAuthenticated: false });
  await useAuth.getState().signInWithGoogle('id-token');
  eq('같은 사람이면 사본을 둔다', cleared, 0);

  // 7. 처음 로그인(앞 사용자가 없다)에도 버릴 것이 없다.
  installTeardown();
  stubApi({ signInWithGoogle: async () => loginResponse('user-a') });
  useAuth.setState({ user: null, isAuthenticated: false });
  await useAuth.getState().signInWithGoogle('id-token');
  eq('첫 로그인은 버릴 것이 없다', cleared, 0);

  // 8. 웹처럼 등록이 없으면 조용히 지나간다.
  setMirrorTeardown(null);
  stubApi({ logout: async () => undefined });
  signedInAs('user-a');
  await useAuth.getState().logout();
  eq('사본이 없는 곳(웹)에서도 로그아웃이 끝난다', useAuth.getState().isAuthenticated, false);

  console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`);
  process.exit(fail === 0 ? 0 : 1);
})();
