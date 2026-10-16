import { JwtService } from '@nestjs/jwt';
import { AuthService } from '@/modules/auth/auth.service';
import { runSmoke } from './smoke-harness';

const BASE = 'http://localhost:3999';

/** Redis 제거 후 인증 흐름이 유지되는지 확인 */
runSmoke('auth', async (ctx) => {
  const user = await ctx.createUser();
  const jwt = new JwtService({ secret: process.env.JWT_SECRET });

  const access = jwt.sign({ sub: user.id, type: 'access' }, { expiresIn: '15m' });
  const refresh = jwt.sign({ sub: user.id, type: 'refresh' }, { expiresIn: '7d' });

  const call = async (path: string, init?: RequestInit) => {
    const res = await fetch(`${BASE}${path}`, init);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const authed = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

  ctx.check('액세스 토큰으로 조회', (await call('/users/me', authed(access))).status, 200);

  // 리프레시
  const refreshed = await call('/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: refresh }),
  });
  ctx.check('리프레시 성공', refreshed.status, 200);
  ctx.check('새 액세스 토큰 발급', Boolean(refreshed.body?.accessToken), true);
  ctx.check('새 액세스 토큰 동작',
    (await call('/users/me', authed(refreshed.body.accessToken))).status, 200);

  // 액세스 토큰 만료 시간이 15분인지
  const decoded = jwt.decode(refreshed.body.accessToken) as { exp: number; iat: number };
  ctx.check('액세스 토큰 수명 (초)', decoded.exp - decoded.iat, 900);
  const decodedRefresh = jwt.decode(refreshed.body.refreshToken) as { exp: number; iat: number };
  ctx.check('리프레시 토큰 수명 (초)', decodedRefresh.exp - decodedRefresh.iat, 604800);

  // ── 갱신 토큰 교체·재사용 탐지·로그아웃 폐기 (2026-10-16) ──
  const refreshWith = (token: string) =>
    call('/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: token }),
    });
  const first = refreshed.body.refreshToken as string;
  ctx.check('새 갱신 토큰에 id(jti)', Boolean((jwt.decode(first) as { jti?: string }).jti), true);

  const second = await refreshWith(first);
  ctx.check('갱신 토큰으로 갱신', second.status, 200);
  // 웹 탭 둘이 함께 갱신하는 자리: 방금 교체된 토큰도 잠깐은 받아 준다.
  ctx.check('방금 교체된 토큰 (봐주는 동안)', (await refreshWith(first)).status, 200);

  const jtiOf = (token: string) => (jwt.decode(token) as { jti: string }).jti;
  const age = (token: string) =>
    ctx.prisma.refreshToken.update({
      where: { id: jtiOf(token) },
      data: { rotatedAt: new Date(Date.now() - 10 * 60_000) },
    });

  /*
   * 교체 응답을 잃은 기기 (2026-10-16). 오래전 교체된 토큰이지만 그 뒤에 나간 토큰이 한 번도 쓰이지
   * 않았다 -- 응답이 기기에 닿지 않은 것이다. 새 토큰을 주고, 쓰이지 않은 후계는 교체된 것으로 적는다.
   */
  await age(first);
  const adopted = await refreshWith(first);
  ctx.check('응답을 잃은 기기의 옛 토큰은 받아 준다', adopted.status, 200);
  ctx.check('받아 준 직후 같은 토큰은 유예 길로', (await refreshWith(first)).status, 200);

  // 후계를 정말 받은 쪽이 유예 뒤에 그것을 내면 재사용으로 잡혀 묶음이 끊긴다 -- 탐지는 늦을 뿐 남는다.
  await age(second.body.refreshToken);
  ctx.check('거둬진 후계 토큰을 유예 뒤에 내면 거부',
    (await refreshWith(second.body.refreshToken)).status, 401);
  ctx.check('재사용이 걸리면 같은 묶음의 최신 토큰도 끊긴다',
    (await refreshWith(adopted.body.refreshToken)).status, 401);

  // 후계가 이미 쓰인 뒤라면 옛 토큰은 훔친 것이다. 곧바로 묶음을 끊는다.
  const chain0 = (await refreshWith(refresh)).body.refreshToken as string; // 새 묶음
  const chain1 = (await refreshWith(chain0)).body.refreshToken as string;
  const chain2 = (await refreshWith(chain1)).body.refreshToken as string; // chain1 이 쓰였다
  await age(chain0);
  ctx.check('후계가 쓰인 뒤의 옛 토큰 재사용 거부', (await refreshWith(chain0)).status, 401);
  ctx.check('그 묶음의 최신 토큰도 끊긴다', (await refreshWith(chain2)).status, 401);

  // 로그아웃은 그 기기의 묶음만 끊는다. 다른 로그인(묶음)은 그대로다.
  const deviceA = (await refreshWith(refresh)).body.refreshToken as string; // 옛 토큰 → 새 묶음
  const deviceB = (await refreshWith(refresh)).body.refreshToken as string; // 또 다른 묶음
  const loggedOut = await call('/auth/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
    body: JSON.stringify({ refreshToken: deviceA }),
  });
  ctx.check('로그아웃 응답', loggedOut.status, 200);
  ctx.check('로그아웃한 기기의 갱신 토큰 거부', (await refreshWith(deviceA)).status, 401);
  ctx.check('다른 기기의 갱신 토큰은 그대로', (await refreshWith(deviceB)).status, 200);

  // 로그아웃은 갱신 토큰을 끊는다. 남은 액세스 토큰은 만료(짧은 수명) 전까지 동작한다.
  ctx.check('로그아웃 후 옛 토큰 (만료 전까지 동작)',
    (await call('/users/me', authed(access))).status, 200);

  // ── 웹의 쿠키 세션 (2026-10-16) ──
  // 웹은 X-Auth-Mode: cookie 로 묻고, 토큰은 HttpOnly 쿠키로만 받는다(본문은 빈 값).
  const cookieRefresh = await fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth-Mode': 'cookie' },
    body: JSON.stringify({ refreshToken: deviceB }),
  });
  ctx.check('쿠키 방식 갱신', cookieRefresh.status, 200);
  const setCookies = cookieRefresh.headers.getSetCookie();
  const cookieOf = (name: string) =>
    setCookies.find((line) => line.startsWith(`${name}=`))?.split(';')[0] ?? '';
  const cookieBody = (await cookieRefresh.json()) as { accessToken: string; refreshToken: string };
  ctx.check('쿠키 방식은 본문에 토큰이 없다', cookieBody.accessToken + cookieBody.refreshToken, '');
  ctx.check('액세스 쿠키는 HttpOnly',
    setCookies.some((line) => line.startsWith('bb_at=') && /HttpOnly/i.test(line)), true);
  ctx.check('갱신 쿠키는 HttpOnly',
    setCookies.some((line) => line.startsWith('bb_rt=') && /HttpOnly/i.test(line)), true);
  ctx.check('표시 쿠키는 스크립트가 읽는다',
    setCookies.some((line) => line.startsWith('bb_session=') && !/HttpOnly/i.test(line)), true);
  const jar = [cookieOf('bb_at'), cookieOf('bb_rt')].join('; ');
  ctx.check('쿠키로 조회', (await call('/users/me', { headers: { Cookie: jar } })).status, 200);

  // 쿠키로 인증한 쓰기는 X-Auth-Mode 머리글이 있어야 한다 (CSRF). 다른 사이트는 이 머리글을 붙이지 못한다.
  const noHeader = await call('/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: jar },
    body: '{}',
  });
  ctx.check('머리글 없는 쿠키 쓰기 거부 (CSRF)', noHeader.status, 403);
  const cookieOnly = await call('/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: jar, 'X-Auth-Mode': 'cookie' },
    body: '{}',
  });
  ctx.check('본문 없이 쿠키의 갱신 토큰으로 갱신', cookieOnly.status, 200);

  const cookieLogout = await fetch(`${BASE}/auth/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: jar, 'X-Auth-Mode': 'cookie' },
    body: '{}',
  });
  ctx.check('쿠키 방식 로그아웃', cookieLogout.status, 200);
  ctx.check('로그아웃이 쿠키를 지운다',
    cookieLogout.headers.getSetCookie().some((line) => line.startsWith('bb_rt=;')), true);

  // ── 만료된 갱신 토큰 행 정리 (하루 한 번 도는 작업) ──
  await ctx.prisma.refreshToken.createMany({
    data: [
      { id: `expired-${user.id}`, userId: user.id, familyId: 'f-old', expiresAt: new Date(Date.now() - 1000) },
      { id: `live-${user.id}`, userId: user.id, familyId: 'f-new', expiresAt: new Date(Date.now() + 60_000) },
    ],
  });
  // 정리는 DB 만 쓴다. 나머지 의존성은 쓰지 않으므로 비워 둔다.
  const auth = new AuthService(ctx.prisma as any, jwt, null as any, null as any, null as any);
  ctx.check('정리가 만료된 행을 지운다', (await auth.purgeExpiredRefreshTokens()) >= 1, true);
  ctx.check('만료된 행은 사라진다',
    await ctx.prisma.refreshToken.count({ where: { id: `expired-${user.id}` } }), 0);
  ctx.check('살아 있는 행은 남는다',
    await ctx.prisma.refreshToken.count({ where: { id: `live-${user.id}` } }), 1);

  // 만료된 토큰은 거부
  const expired = jwt.sign({ sub: user.id, type: 'access' }, { expiresIn: '-1s' });
  ctx.check('만료 토큰 거부', (await call('/users/me', authed(expired))).status, 401);

  // 타입이 다른 토큰은 거부
  ctx.check('refresh 토큰으로 API 호출 거부',
    (await call('/users/me', authed(refresh))).status, 401);
});
