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
 *
 * 마지막 갈래는 실제 앱의 401 을 그대로 흉내 내야 한다. 앱의 `setupApi` 는 401 을 받으면
 * `user` 까지 null 로 만든다. 세션만 끊는 시늉(`isAuthenticated: false`)으로 검사하면
 * 스토어에 남은 앞 사람 id 를 보고 통과해 버려, 정작 앱에서는 사본이 남는다.
 */
import { setMirrorOwnership, setMirrorTeardown } from '../src/data/mirror-teardown';
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
 * 사본에 적힌 주인. 앱에서는 SecureStore 고, 여기서는 변수 하나다.
 *
 * 스토어와 따로 두는 것이 요점이라, 이 자리표도 스토어를 보지 않는다.
 */
let owner: string | null = null;
setMirrorOwnership({
  get: async () => owner,
  claim: async (userId) => void (owner = userId),
});

/**
 * 로그인한 상태로 만든다. 서버에 닿지 않고 스토어와 토큰만 그 모양으로 둔다.
 *
 * 토큰까지 넣어야 하는 이유가 있다. loadUser 는 토큰이 없으면 서버를 부르기도 전에
 * "로그인하지 않았다"로 끝낸다. 그래서 토큰 없이 부르면 401 검사도 오프라인 검사도
 * 그 이른 반환을 보고 통과해 버린다 (실제로 한 번 그렇게 거짓 통과했다).
 */
function signedInAs(userId: string) {
  saveAuthTokens('access-token', 'refresh-token');
  owner = userId;
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

/**
 * 앱이 401 을 받았을 때의 상태. `packages/app/App.tsx` 의 setupApi 와 같은 모양이다.
 *
 * 사본은 그대로 두고(D10) 세션만 끊는다 -- **사용자까지 비운다**. 이 한 줄이 주인을
 * 스토어 밖에 적어 두어야 하는 이유다.
 */
function sessionExpired() {
  useAuth.setState({ user: null, isAuthenticated: false });
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
  sessionExpired();
  await useAuth.getState().signInWithGoogle('id-token');
  eq('주인이 바뀌면 사본을 버린다', cleared, 1);
  eq('새 사용자로 들어간다', useAuth.getState().user?.id, 'user-b');
  eq('사본의 주인도 새 사람이 된다', owner, 'user-b');

  // 6. 같은 사용자가 다시 들어오면 버리지 않는다. 적어 둔 것이 남아야 한다.
  installTeardown();
  stubApi({ signInWithGoogle: async () => loginResponse('user-a') });
  signedInAs('user-a');
  sessionExpired();
  await useAuth.getState().signInWithGoogle('id-token');
  eq('같은 사람이면 사본을 둔다', cleared, 0);

  // 7. 처음 로그인(앞 사용자가 없다)에도 버릴 것이 없다.
  installTeardown();
  stubApi({ signInWithGoogle: async () => loginResponse('user-a') });
  owner = null;
  useAuth.setState({ user: null, isAuthenticated: false });
  await useAuth.getState().signInWithGoogle('id-token');
  eq('첫 로그인은 버릴 것이 없다', cleared, 0);
  eq('그래도 주인은 적어 둔다', owner, 'user-a');

  /*
   * 8. 세션을 이어 여는 길에서도 주인을 적는다.
   *
   * 앱을 껐다 켜면 signInWithGoogle 을 거치지 않고 loadUser 로 들어온다. 그때 주인을
   * 적지 않으면, 이 기기를 처음 쓰기 시작한 사람이 SecureStore 에 남지 않아 다음에
   * 다른 계정이 들어와도 사본이 남는다.
   */
  installTeardown();
  owner = null;
  stubApi({ getProfile: async () => ({ id: 'user-a', email: 'a@example.com', name: 'a', avatar: null }) });
  signedInAs('user-a');
  owner = null;
  await useAuth.getState().loadUser();
  eq('세션을 이어 열어도 주인을 적는다', owner, 'user-a');

  // 9. 웹처럼 등록이 없으면 조용히 지나간다.
  setMirrorTeardown(null);
  stubApi({ logout: async () => undefined });
  signedInAs('user-a');
  await useAuth.getState().logout();
  eq('사본이 없는 곳(웹)에서도 로그아웃이 끝난다', useAuth.getState().isAuthenticated, false);

  console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`);
  process.exit(fail === 0 ? 0 : 1);
})();
