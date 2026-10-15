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

  // 오래전에 교체된 토큰이 다시 오면 훔친 것으로 보고 그 로그인(묶음)을 통째로 끊는다.
  const firstJti = (jwt.decode(first) as { jti: string }).jti;
  await ctx.prisma.refreshToken.update({
    where: { id: firstJti },
    data: { rotatedAt: new Date(Date.now() - 10 * 60_000) },
  });
  ctx.check('오래전 교체된 토큰 재사용 거부', (await refreshWith(first)).status, 401);
  ctx.check('재사용이 걸리면 같은 묶음의 최신 토큰도 끊긴다',
    (await refreshWith(second.body.refreshToken)).status, 401);

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
