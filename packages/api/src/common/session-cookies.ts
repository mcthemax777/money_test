/**
 * 웹의 로그인 쿠키 (2026-10-16).
 *
 * 웹은 토큰을 스크립트가 읽을 수 없는 HttpOnly 쿠키로 든다. 예전에는 웹이 토큰을 스크립트로 읽는 쿠키에
 * 담아 Authorization 머리글에 실었는데, 같은 출처에서 도는 남의 스크립트(광고·통계)가 그것을 읽을 수 있었다.
 * 앱은 지금처럼 머리글 토큰을 쓴다 -- 쿠키는 웹이 `X-Auth-Mode: cookie` 머리글을 실어 올 때만 쓴다.
 *
 *   bb_at       액세스 토큰. HttpOnly.
 *   bb_rt       갱신 토큰. HttpOnly.
 *   bb_session  액세스 토큰이 끝나는 때(유닉스 초). 스크립트가 읽는다 -- 토큰이 아니라 시각뿐이라 새어도
 *               쓸 데가 없고, 웹은 이것으로 로그인했는지와 미리 갱신할 때를 안다.
 *
 * 쿠키로 인증한 쓰기 요청은 같은 머리글이 있어야 받는다(main.ts 의 CSRF 문). 다른 사이트는 이 머리글을
 * 붙여 보낼 수 없다(CORS 가 미리 묻기에서 막는다). 쿠키 자체도 SameSite=Lax 라 다른 사이트의 폼 전송에는
 * 실리지 않는다.
 */
import type { Request, Response, CookieOptions } from 'express';

export const ACCESS_COOKIE = 'bb_at';
export const REFRESH_COOKIE = 'bb_rt';
export const SESSION_COOKIE = 'bb_session';
/** 웹이 쿠키 방식으로 묻는다는 머리글. 값은 'cookie'. */
export const AUTH_MODE_HEADER = 'x-auth-mode';

/** 요청 머리글의 쿠키 하나. cookie-parser 를 들이지 않고 필요한 것만 읽는다. */
export function readCookie(req: Pick<Request, 'headers'>, name: string): string | undefined {
  const header = req.headers?.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(at + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** 웹이 쿠키 방식으로 물었는가. */
export function isCookieMode(req: Pick<Request, 'headers'>): boolean {
  return req.headers?.[AUTH_MODE_HEADER] === 'cookie';
}

/**
 * 쿠키에 Secure 를 붙이는가. 운영(NODE_ENV=production)에서는 늘 붙인다 -- 배포 서버의 nginx 가
 * X-Forwarded-Proto 를 넘기지 않아 요청만 보고는 https 인지 알 수 없었다(2026-10-16 배포에서 확인).
 * 운영은 https 로만 열리므로 붙여도 잃는 것이 없다. 개발(http)에서는 붙이면 브라우저가 쿠키를 받지
 * 않으므로 요청을 보고 정한다.
 */
function isSecure(req: Request): boolean {
  if (process.env.NODE_ENV === 'production') return true;
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

/** 토큰 몸통의 exp (유닉스 초). 서명은 방금 우리가 했다. */
function expOf(token: string): number | null {
  const body = token.split('.')[1];
  if (!body) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/** 토큰 쌍을 쿠키로 내린다. */
export function setSessionCookies(
  req: Request,
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
): void {
  const now = Math.floor(Date.now() / 1000);
  const accessExp = expOf(tokens.accessToken) ?? now;
  const refreshExp = expOf(tokens.refreshToken) ?? now;
  const base: CookieOptions = { secure: isSecure(req), sameSite: 'lax', path: '/' };
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base,
    httpOnly: true,
    maxAge: Math.max(accessExp - now, 0) * 1000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base,
    httpOnly: true,
    maxAge: Math.max(refreshExp - now, 0) * 1000,
  });
  // 갱신 토큰이 사는 동안 남는다. 액세스 토큰이 끝나도 "로그인한 상태(갱신하면 됨)"를 알아야 한다.
  res.cookie(SESSION_COOKIE, String(accessExp), {
    ...base,
    httpOnly: false,
    maxAge: Math.max(refreshExp - now, 0) * 1000,
  });
}

/** 로그인 쿠키를 지운다 (로그아웃, 갱신 실패). */
export function clearSessionCookies(req: Request, res: Response): void {
  const base: CookieOptions = { secure: isSecure(req), sameSite: 'lax', path: '/' };
  res.clearCookie(ACCESS_COOKIE, { ...base, httpOnly: true });
  res.clearCookie(REFRESH_COOKIE, { ...base, httpOnly: true });
  res.clearCookie(SESSION_COOKIE, base);
}

/**
 * 쿠키 방식이면 토큰을 쿠키로 내리고 본문에서는 뺀다 -- 스크립트가 토큰을 보지 못하게. 머리글 방식(앱)이면
 * 그대로 돌려준다.
 */
export function respondWithSession<T extends { accessToken: string; refreshToken: string }>(
  req: Request,
  res: Response,
  result: T,
): T {
  if (!isCookieMode(req)) return result;
  setSessionCookies(req, res, result);
  return { ...result, accessToken: '', refreshToken: '' };
}
