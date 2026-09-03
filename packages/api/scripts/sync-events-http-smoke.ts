/**
 * 실시간 알림을 실제 HTTP 경로로 확인한다.
 *
 * 실행: 서버를 띄운 뒤 (PORT=3999 node dist/main.js)
 *       cd packages/api && npx ts-node --transpile-only -r <별칭 훅> scripts/sync-events-http-smoke.ts
 *
 * 서비스를 직접 부르는 검사로는 잡히지 않는 것이 여기 있다. 신호를 보내는 자리가
 * 미들웨어와 권한 확인에 걸쳐 있어서, 배선이 하나라도 어긋나면 아무 오류 없이
 * "실시간만 안 되는" 서버가 된다.
 *
 *   1. 붙자마자 지금 번호를 받는다 (끊겨 있던 동안의 변경을 그때 받아 간다).
 *   2. 쓰기가 성공하면 번호가 올라온다. **전표 id 만 들고 오는 경로도 마찬가지다** --
 *      projectId 를 요청에서 못 찾아도 권한 확인이 그것을 알고 있다.
 *   3. 읽기와 실패한 쓰기는 신호를 내지 않는다.
 */
import { JwtService } from '@nestjs/jwt';

import { runSmoke } from './smoke-harness';

const BASE = 'http://localhost:3999';

/** 신호를 모아 두는 통. 검사는 여기에 쌓인 번호를 본다. */
interface EventTap {
  versions: number[];
  /** 지금보다 큰 번호가 올 때까지 기다린다. 오지 않으면 null. */
  waitForNext(after: number, timeoutMs?: number): Promise<number | null>;
  close(): void;
}

async function openTap(url: string, token: string): Promise<EventTap> {
  const controller = new AbortController();
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
    signal: controller.signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`알림 연결 실패 (${response.status})`);
  }

  const versions: number[] = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // 백그라운드로 읽는다. 검사는 versions 가 차오르는 것을 본다.
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;

        buffer += decoder.decode(value, { stream: true });

        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);

          if (/(^|\n)event: ?sync(\n|$)/.test(frame)) {
            const data = /(^|\n)data: ?(.*)/.exec(frame)?.[2];
            const version = data ? (JSON.parse(data) as { version?: number }).version : undefined;
            if (typeof version === 'number') versions.push(version);
          }
          boundary = buffer.indexOf('\n\n');
        }
      }
    } catch {
      // 닫으면 여기로 온다. 검사가 끝났다는 뜻이라 넘어간다.
    }
  })();

  return {
    versions,
    async waitForNext(after: number, timeoutMs = 5_000): Promise<number | null> {
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        const found = versions.find((version) => version > after);
        if (found !== undefined) return found;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return null;
    },
    close: () => controller.abort(),
  };
}

runSmoke('sync-events-http', async (ctx) => {
  const user = await ctx.createUser();
  const project = await ctx.createProject();
  await ctx.prisma.projectMember.create({
    data: { projectId: project.id, userId: user.id, role: 'owner' },
  });

  const jwtService = new JwtService({ secret: process.env.JWT_SECRET });
  const token = jwtService.sign(
    { sub: user.id, email: user.email, type: 'access' },
    { expiresIn: '1h' },
  );

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  const q = `?projectId=${project.id}`;
  const tap = await openTap(`${BASE}/sync/events${q}`, token);

  try {
    // ── 1. 붙자마자 지금 번호를 받는다 ──
    const first = await tap.waitForNext(-1);
    ctx.check('붙으면 지금 번호가 온다', typeof first === 'number', true);
    const start = first ?? 0;

    // ── 2. 쓰기가 성공하면 번호가 올라온다 ──
    const person = await call('POST', `/people${q}`, { name: '김철수' });
    ctx.check('사람 생성', person.status, 201);
    const afterCreate = await tap.waitForNext(start);
    ctx.check('쓰기가 신호를 낸다', (afterCreate ?? 0) > start, true);

    /*
     * ── 3. projectId 를 들고 오지 않는 경로도 신호를 낸다 ──
     *
     * PATCH /people/:id 에는 프로젝트가 없다. 요청만 보고 신호를 만들었다면 여기서
     * 조용히 빠진다 -- 웹에서 고친 것이 앱에 닿지 않는 그 경우다.
     */
    const beforePatch = afterCreate ?? start;
    const renamed = await call('PATCH', `/people/${person.body.id}`, { name: '김영희' });
    ctx.check('이름 수정', renamed.status, 200);
    const afterPatch = await tap.waitForNext(beforePatch);
    ctx.check('전표 id 만 들고 오는 경로도 신호를 낸다', (afterPatch ?? 0) > beforePatch, true);

    // ── 4. 읽기는 신호를 내지 않는다 ──
    const beforeRead = afterPatch ?? beforePatch;
    await call('GET', `/people${q}`);
    const afterRead = await tap.waitForNext(beforeRead, 1_000);
    ctx.check('읽기는 신호를 내지 않는다', afterRead, null);

    // ── 5. 실패한 쓰기도 신호를 내지 않는다 ──
    const rejected = await call('POST', `/accounts${q}`, { name: '유형 없음' });
    ctx.check('잘못된 쓰기는 거부된다', rejected.status >= 400, true);
    const afterReject = await tap.waitForNext(beforeRead, 1_000);
    ctx.check('실패한 쓰기는 신호를 내지 않는다', afterReject, null);
  } finally {
    tap.close();
  }

  /*
   * ── 6. 인스턴스가 둘일 때 ──
   *
   * SECOND_BASE 에 두 번째 서버 주소를 주면 돈다. 화면은 B 에 붙어 있고 쓰기는 A 로
   * 들어가는 상황이다. **레디스를 두는 이유가 이 검사 하나에 들어 있다** -- 없으면
   * A 의 신호가 A 안에서만 돌고 B 의 화면은 다음 동기화까지 모른다.
   */
  const secondBase = process.env.SECOND_BASE?.trim();
  if (!secondBase) {
    console.log('\nSECOND_BASE 가 없어 인스턴스 사이 검사는 건너뜁니다.');
    console.log('돌리려면 두 서버 모두 REDIS_URL 을 주고 띄운 뒤 SECOND_BASE 를 넘긴다:');
    console.log('  REDIS_URL=redis://localhost:6379 PORT=3999 node dist/main.js');
    console.log('  REDIS_URL=redis://localhost:6379 PORT=3998 node dist/main.js');
    console.log('  SECOND_BASE=http://localhost:3998 npx ts-node ... scripts/sync-events-http-smoke.ts');
    return;
  }

  /*
   * 여기서 실패한다면 먼저 REDIS_URL 을 확인한다.
   *
   * 두 서버 중 한쪽이라도 레디스 없이 떠 있으면 이 검사는 반드시 실패한다. 회귀가
   * 아니라 그것이 이 검사의 뜻이다 -- 실제로 레디스를 빼고 돌려 실패하는 것을 확인했다.
   */

  const remoteTap = await openTap(`${secondBase}/sync/events${q}`, token);
  try {
    const base = (await remoteTap.waitForNext(-1)) ?? 0;
    ctx.check('다른 인스턴스에도 붙는다', base > 0, true);

    const created = await call('POST', `/people${q}`, { name: '박민수' });
    ctx.check('A 로 들어간 쓰기', created.status, 201);

    const heard = await remoteTap.waitForNext(base);
    ctx.check('A 의 쓰기가 B 에 붙은 화면까지 닿는다', (heard ?? 0) > base, true);
  } finally {
    remoteTap.close();
  }
});
