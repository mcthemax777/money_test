import Cookie from 'js-cookie';

/**
 * 인증 토큰 쿠키를 다루는 유일한 경로.
 *
 * HttpOnly는 걸 수 없다. axios 인터셉터가 토큰을 읽어 Authorization 헤더에
 * 실어야 해서 JS가 접근할 수 있어야 한다. HttpOnly가 필요하면 서버가
 * Set-Cookie로 내려주고 인증 방식을 쿠키 기반으로 바꾸는 별도 작업이 필요하다.
 * 그래서 XSS가 나면 토큰이 함께 새는 구조라는 점은 그대로다.
 *
 * 지금 걸 수 있는 것은 두 가지다.
 *   - secure  : https에서만 실어 보낸다. 평문 구간에서 토큰이 새지 않는다.
 *               http로 여는 개발 환경에서 켜면 저장 자체가 되지 않으므로
 *               현재 프로토콜을 보고 정한다.
 *   - sameSite: 'lax'. 다른 사이트가 시작한 요청에는 쿠키가 실리지 않는다.
 *
 * 만료도 여기서 한 번만 정한다. 예전에는 로그인은 7일/30일로 저장하고 토큰
 * 갱신은 옵션 없이 덮어써서, 한 번 갱신되고 나면 세션 쿠키가 되어 브라우저를
 * 닫는 순간 로그아웃됐다.
 */

const ACCESS_TOKEN_DAYS = 7;
const REFRESH_TOKEN_DAYS = 30;

/** js-cookie는 옵션 타입을 네임스페이스 안에 두어 직접 import할 수 없다. */
type CookieOptions = Parameters<typeof Cookie.set>[2];

function cookieOptions(days: number): CookieOptions {
  return {
    expires: days,
    sameSite: 'lax',
    secure: typeof window !== 'undefined' && window.location.protocol === 'https:',
  };
}

export function getAccessToken(): string | undefined {
  return Cookie.get('accessToken');
}

export function getRefreshToken(): string | undefined {
  return Cookie.get('refreshToken');
}

export function saveAuthTokens(accessToken: string, refreshToken: string): void {
  Cookie.set('accessToken', accessToken, cookieOptions(ACCESS_TOKEN_DAYS));
  Cookie.set('refreshToken', refreshToken, cookieOptions(REFRESH_TOKEN_DAYS));
}

export function clearAuthTokens(): void {
  Cookie.remove('accessToken');
  Cookie.remove('refreshToken');
}
