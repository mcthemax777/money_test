/**
 * 요청 상한을 인스턴스 사이에서 함께 세는가.
 *
 * 실행: REDIS_URL 을 준 서버를 띄운 뒤 (REDIS_URL=... PORT=3999 node dist/main.js)
 *       cd packages/api && npx ts-node --transpile-only -r <별칭 훅> scripts/throttle-http-smoke.ts
 *       인스턴스 사이 검사까지 보려면 두 번째 서버를 띄우고 SECOND_BASE 를 넘긴다.
 *
 * 이 검사가 없으면 알아채기 어려운 종류의 회귀가 있다. 저장소를 잘못 꽂아도 서버는
 * 정상으로 뜨고, 인스턴스가 하나인 개발 기계에서는 상한도 제대로 걸린다. **틀린 것이
 * 드러나는 자리는 인스턴스를 늘린 운영뿐이고, 그때 드러나는 모습은 "상한이 N배로
 * 느슨해졌다"는 조용한 변화다.**
 *
 * 로그인 경로로 본다 (분당 10회). 전역 상한(300)으로 보려면 요청을 300번 보내야 한다.
 * 본문이 틀려 인증은 실패하지만 상한은 가드가 먼저 세므로 세는 데는 지장이 없다.
 */
import { Redis } from 'ioredis';

import { runSmoke } from './smoke-harness';

const BASE = process.env.BASE?.trim() || 'http://localhost:3999';

/** 로그인 경로의 상한. auth.controller 의 SIGN_IN_LIMIT 과 같아야 한다. */
const SIGN_IN_LIMIT = 10;

/** 이 검사가 지우는 키. 저장소가 붙이는 접두사와 같아야 한다. */
const KEY_PREFIX = 'money:throttle:*';

/** 로그인 시도 하나. 인증은 실패해도 되고, 우리가 보는 것은 상태 코드뿐이다. */
async function attempt(base: string): Promise<number> {
  const response = await fetch(`${base}/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: 'not-a-real-token' }),
  });
  return response.status;
}

/**
 * 세던 것을 지운다.
 *
 * 창이 1분이라 지우지 않으면 **두 번째 실행이 첫 번째의 횟수 위에서 시작한다.** 그러면
 * 첫 요청부터 429 가 나서, 고장이 아닌데 실패한 것처럼 보인다.
 */
async function clearCounters(redis: Redis): Promise<void> {
  const keys = await redis.keys(KEY_PREFIX);
  if (keys.length > 0) await redis.del(...keys);
}

runSmoke('throttle-http', async (ctx) => {
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    console.log('\nREDIS_URL 이 없어 건너뜁니다.');
    console.log('레디스가 없으면 상한은 프로세스 안에서만 세어지고, 그것이 기본 동작이다.');
    console.log('  REDIS_URL=redis://localhost:6379 PORT=3999 node dist/main.js');
    return;
  }

  const redis = new Redis(url, { maxRetriesPerRequest: 1 });

  try {
    await clearCounters(redis);

    // ── 1. 한 인스턴스 안에서 상한이 걸린다 ──
    const first: number[] = [];
    for (let i = 0; i < SIGN_IN_LIMIT; i += 1) first.push(await attempt(BASE));
    ctx.check(
      `상한까지는 막지 않는다 (${SIGN_IN_LIMIT}회)`,
      first.every((status) => status !== 429),
      true,
    );
    ctx.check('상한을 넘기면 막는다', await attempt(BASE), 429);

    // 레디스에 실제로 쌓였는가. 메모리로 세고 있으면 키가 없다.
    ctx.check('레디스에서 센다', (await redis.keys(KEY_PREFIX)).length > 0, true);

    /*
     * ── 2. 인스턴스가 둘일 때 ──
     *
     * A 에서 상한을 다 쓰고 B 로 한 번 더 보낸다. 따로 세고 있다면 B 는 통과시킨다 --
     * 그것이 이 장치를 바꾸기 전의 모습이고, 여기서 잡으려는 것이다.
     */
    const secondBase = process.env.SECOND_BASE?.trim();
    if (!secondBase) {
      console.log('\nSECOND_BASE 가 없어 인스턴스 사이 검사는 건너뜁니다.');
      console.log('돌리려면 두 서버 모두 REDIS_URL 을 주고 띄운 뒤 넘긴다:');
      console.log('  REDIS_URL=redis://localhost:6379 PORT=3998 node dist/main.js');
      console.log('  SECOND_BASE=http://localhost:3998 npx ts-node ... scripts/throttle-http-smoke.ts');
      return;
    }

    await clearCounters(redis);

    const spent: number[] = [];
    for (let i = 0; i < SIGN_IN_LIMIT; i += 1) spent.push(await attempt(BASE));
    ctx.check('A 에서 상한까지 쓴다', spent.every((status) => status !== 429), true);
    ctx.check('B 도 그 횟수를 알고 있다', await attempt(secondBase), 429);
  } finally {
    // 다음 실행이 이 횟수 위에서 시작하지 않도록 치운다.
    await clearCounters(redis).catch(() => undefined);
    redis.disconnect();
  }
});
