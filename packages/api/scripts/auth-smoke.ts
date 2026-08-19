import { JwtService } from '@nestjs/jwt';
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

  // 로그아웃
  ctx.check('로그아웃 응답',
    (await call('/auth/logout', { method: 'POST', ...authed(access) })).status, 200);

  // 서버는 토큰을 기억하지 않으므로 로그아웃 후에도 남은 액세스 토큰은 만료 전까지 동작한다.
  // 이것이 이 방식의 알려진 대가다. 클라이언트가 토큰을 지우는 것이 실질적 로그아웃이다.
  ctx.check('로그아웃 후 옛 토큰 (만료 전까지 동작)',
    (await call('/users/me', authed(access))).status, 200);

  // 만료된 토큰은 거부
  const expired = jwt.sign({ sub: user.id, type: 'access' }, { expiresIn: '-1s' });
  ctx.check('만료 토큰 거부', (await call('/users/me', authed(expired))).status, 401);

  // 타입이 다른 토큰은 거부
  ctx.check('refresh 토큰으로 API 호출 거부',
    (await call('/users/me', authed(refresh))).status, 401);
});
