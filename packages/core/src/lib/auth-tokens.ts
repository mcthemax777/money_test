import Cookie from 'js-cookie';

/**
 * 인증 토큰을 다루는 유일한 경로.
 *
 * **웹은 쿠키 세션이다** (2026-10-16, `cookieSession`). 서버가 토큰을 HttpOnly 쿠키로 내려
 * 스크립트는 토큰을 보지 못한다 -- 같은 출처의 남의 스크립트(광고·통계)가 토큰을 읽던 길이 닫힌다. 그때
 * 이 파일의 get 은 비고, 로그인했는지와 만료 시각은 서버가 함께 내리는 표시 쿠키(`bb_session`, 값은
 * 액세스 토큰의 exp)로 안다. 앱은 지금처럼 기기 저장소의 토큰을 머리글에 싣는다(아래 저장소들).
 *
 * 아래는 쿠키 세션 이전(그리고 앱)의 저장 규칙이다.
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

type TokenName = 'accessToken' | 'refreshToken';

/**
 * 토큰을 어디에 담을지. 웹은 쿠키, 앱은 기기 저장소다.
 *
 * 읽기가 동기인 이유는 요청 인터셉터가 매 요청마다 부르기 때문이다. 기기 저장소는
 * 비동기라, 앱은 시작할 때 한 번 읽어 메모리에 올려 두고 쓰기만 뒤로 흘려보낸다.
 */
export interface TokenStorage {
  get(name: TokenName): string | undefined;
  set(name: TokenName, value: string, days: number): void;
  remove(name: TokenName): void;
}

/** js-cookie는 옵션 타입을 네임스페이스 안에 두어 직접 import할 수 없다. */
type CookieOptions = Parameters<typeof Cookie.set>[2];

function cookieOptions(days: number): CookieOptions {
  return {
    expires: days,
    sameSite: 'lax',
    secure: typeof window !== 'undefined' && window.location.protocol === 'https:',
  };
}

/** 웹의 기본 저장소. 브라우저가 아닌 곳에서는 앱이 갈아 끼운다. */
const cookieStorage: TokenStorage = {
  get: (name) => Cookie.get(name),
  set: (name, value, days) => Cookie.set(name, value, cookieOptions(days)),
  remove: (name) => Cookie.remove(name),
};

let storage: TokenStorage = cookieStorage;

/**
 * 웹의 쿠키 세션인가. 브라우저(document 가 있는 곳)에서는 처음부터 켜져 있다 -- 웹의 어느 모듈이 먼저
 * 요청을 보내도 머리글 방식으로 새지 않게. 앱은 시작할 때 기기 저장소를 끼우며(`setTokenStorage`) 끈다.
 */
let cookieSession = typeof document !== 'undefined';
/** 서버가 내리는 표시 쿠키. 값은 액세스 토큰이 끝나는 때(유닉스 초). 토큰이 아니다. */
const SESSION_MARKER = 'bb_session';

export function isCookieSession(): boolean {
  return cookieSession;
}

/** 로그인한 상태인가. 쿠키 세션이면 표시 쿠키로, 아니면 토큰이 있는지로 본다. */
export function hasSession(): boolean {
  if (cookieSession) return Boolean(Cookie.get(SESSION_MARKER));
  return Boolean(storage.get('accessToken'));
}

/** 쿠키 세션의 액세스 토큰이 끝나는 때(ms). 모르면 null. 미리 갱신할 때를 정하는 데 쓴다. */
export function cookieSessionExpiry(): number | null {
  if (!cookieSession) return null;
  const seconds = Number(Cookie.get(SESSION_MARKER));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

/**
 * 쿠키 세션 이전에 스크립트 쿠키에 담아 둔 갱신 토큰. 웹이 한 번 그것으로 갱신해 HttpOnly 쿠키로 옮긴다 --
 * 배포했다고 모두가 다시 로그인하지 않게. 옮기는 도중에 새로고침해도 잃지 않게, 옮긴 뒤에 지운다
 * (`clearLegacyTokens`).
 */
export function readLegacyRefreshToken(): string | undefined {
  return Cookie.get('refreshToken');
}

/** 쿠키 세션 이전의 스크립트 쿠키를 지운다. */
export function clearLegacyTokens(): void {
  Cookie.remove('accessToken');
  Cookie.remove('refreshToken');
}

/** 앱이 시작할 때 한 번 부른다. 이후 아래 함수들이 그 저장소를 쓴다. */
export function setTokenStorage(next: TokenStorage): void {
  storage = next;
  cookieSession = false;
}

/** 액세스 토큰. 쿠키 세션이면 스크립트가 볼 수 없어 늘 없다(브라우저가 쿠키로 싣는다). */
export function getAccessToken(): string | undefined {
  return cookieSession ? undefined : storage.get('accessToken');
}

/** 갱신 토큰. 쿠키 세션이면 늘 없다. */
export function getRefreshToken(): string | undefined {
  return cookieSession ? undefined : storage.get('refreshToken');
}

/**
 * 세션이 바뀐 횟수. 담거나 지울 때마다 하나씩 오른다 (2026-10-16).
 *
 * 갱신 요청이 나가 있는 동안 로그아웃하거나 다른 계정으로 로그인하면, 늦게 돌아온 갱신 응답이
 * 지운 토큰(또는 앞 사람의 토큰)을 다시 담는다. 갱신은 나갈 때의 값을 들고 있다가 그대로일 때만 담는다.
 */
let epoch = 0;

export function authEpoch(): number {
  return epoch;
}

/** 받은 토큰을 담는다. 쿠키 세션이면 서버가 이미 쿠키로 내렸으므로 할 일이 없다. */
export function saveAuthTokens(accessToken: string, refreshToken: string): void {
  epoch += 1;
  if (cookieSession) return;
  storage.set('accessToken', accessToken, ACCESS_TOKEN_DAYS);
  storage.set('refreshToken', refreshToken, REFRESH_TOKEN_DAYS);
}

/**
 * 세션을 지운다. 쿠키 세션의 HttpOnly 쿠키는 서버가 지우고(로그아웃·갱신 실패), 여기서는 스크립트가 지울 수
 * 있는 표시 쿠키를 지워 곧바로 로그아웃한 상태로 읽히게 한다.
 */
export function clearAuthTokens(): void {
  epoch += 1;
  if (cookieSession) {
    Cookie.remove(SESSION_MARKER);
    return;
  }
  storage.remove('accessToken');
  storage.remove('refreshToken');
}
