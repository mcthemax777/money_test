/**
 * 세션이 언제 끝나야 하고 언제 끝나면 안 되는지 검사.
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/session-expiry-smoke.ts
 *
 * 왜 이것을 검사하는가. 오프라인의 실제 상한은 갱신 토큰의 수명(7일)이고, 그 상한에
 * 닿았는지 판단하는 자리가 api-client 의 401 경로다. 그 판단이 한 칸만 틀려도 결과가
 * 크다 -- **연결이 잠깐 끊긴 것을 "토큰이 죽었다"로 읽으면**, 비행기에 타는 순간
 * 로그인 화면으로 밀려나 그다음부터는 오프라인에서 아무것도 적지 못한다.
 *
 * 세 갈래를 본다. 서버가 갱신을 거절하면 끝내고, 갱신이 서버에 닿지 못했으면 지키고,
 * 갱신이 되면 원래 요청을 새 토큰으로 다시 보낸다.
 */
import type { AxiosRequestConfig } from 'axios';

import { apiClient } from '../src/lib/api-client';
import {
  getAccessToken,
  saveAuthTokens,
  setTokenStorage,
  type TokenStorage,
} from '../src/lib/auth-tokens';

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

/**
 * 아직 살아 있는 액세스 토큰.
 *
 * 만료가 코앞이면 요청을 보내기도 전에 갱신이 돌아(REFRESH_LEEWAY_MS) 검사하려는
 * 401 경로에 들어가지 못한다. 그래서 한 시간 뒤로 넉넉히 둔다. 서명은 보지 않는다 --
 * 클라이언트는 만료 시각만 읽는다.
 */
function accessToken(secondsFromNow = 3600): string {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secondsFromNow }))
    .toString('base64url');
  return `header.${payload}.signature`;
}

/** 서버가 거절한 응답. axios 가 인터셉터에 넘기는 모양과 같다. */
function rejected(status: number, config: AxiosRequestConfig) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    config,
    response: { status, data: {}, headers: {}, config },
  });
}

/** 서버에 닿지 못한 경우. `response` 가 없는 것이 오프라인의 표식이다. */
function unreachable(config: AxiosRequestConfig) {
  return Object.assign(new Error('Network Error'), { config, code: 'ERR_NETWORK' });
}

/**
 * 가짜 서버를 axios 밑에 끼운다.
 *
 * 실제 서버를 띄우지 않는 이유는 검사하려는 것이 서버의 대답이 아니라 **그 대답을
 * 받은 뒤 클라이언트가 무엇을 하는가**이기 때문이다. 어댑터가 그 경계다.
 */
function serveWith(handler: (url: string, config: AxiosRequestConfig) => Promise<unknown>) {
  (apiClient as unknown as { client: { defaults: { adapter: unknown } } }).client.defaults.adapter =
    async (config: AxiosRequestConfig) => {
      const url = String(config.url ?? '');
      const data = await handler(url, config);
      return { data, status: 200, statusText: 'OK', headers: {}, config };
    };
}

/**
 * 세션이 끊겼는지 보는 자리표. 앱에서는 로그인 화면으로 되돌아간다.
 *
 * 몇 번 불렸는지는 보지 않는다. 갱신 요청 자체가 401 인 경우에는 정리가 두 자리에서
 * 겹쳐 일어나는데(요청별 처리와 갱신 실패 처리), 두 번 지워도 결과는 같다. 여기서
 * 알고 싶은 것은 "끊겼는가"뿐이다.
 */
let cleared = false;
apiClient.setUnauthorizedHandler(() => {
  cleared = true;
});

(async () => {
  setTokenStorage(memoryTokenStorage());

  // 1. 서버가 갱신 토큰을 거절하면 세션이 끝난다. 7일이 지난 경우다.
  cleared = false;
  saveAuthTokens(accessToken(), 'refresh-token');
  serveWith(async (url, config) => {
    throw rejected(401, config);
  });
  await apiClient.getProfile().catch(() => undefined);
  eq('갱신이 거절되면 세션을 끝낸다', cleared, true);
  eq('토큰도 지운다', getAccessToken() ?? 'none', 'none');

  /*
   * 2. 갱신이 서버에 닿지 못하면 세션을 지킨다.
   *
   * 401 을 받은 직후에 연결이 끊긴 자리다. 토큰이 죽었는지 아직 모르므로 끊지 않는다.
   * 잘못 지켜도 잃는 것은 없다 -- 다음 요청이 401 을 받으면 그때 1번 길로 간다.
   */
  cleared = false;
  saveAuthTokens(accessToken(), 'refresh-token');
  serveWith(async (url, config) => {
    if (url.includes('/auth/refresh')) throw unreachable(config);
    throw rejected(401, config);
  });
  await apiClient.getProfile().catch(() => undefined);
  eq('갱신이 닿지 못하면 세션을 지킨다', cleared, false);
  eq('토큰도 남긴다', getAccessToken() ? 'kept' : 'none', 'kept');

  // 3. 갱신이 되면 원래 요청을 새 토큰으로 다시 보낸다.
  cleared = false;
  saveAuthTokens(accessToken(), 'refresh-token');
  let attempts = 0;
  serveWith(async (url, config) => {
    if (url.includes('/auth/refresh')) {
      return { accessToken: accessToken(), refreshToken: 'refresh-2' };
    }
    attempts += 1;
    if (attempts === 1) throw rejected(401, config);
    return { id: 'user-a', email: 'a@example.com', name: 'a', avatar: null };
  });
  const profile = await apiClient.getProfile();
  eq('갱신 뒤 원래 요청을 다시 보낸다', attempts, 2);
  eq('그 결과를 돌려준다', (profile as { id?: string })?.id, 'user-a');
  eq('세션은 그대로다', cleared, false);

  console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`);
  process.exit(fail === 0 ? 0 : 1);
})();
