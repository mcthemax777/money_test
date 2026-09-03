/**
 * 알림 연결 클라이언트 검사. 서버도 데이터베이스도 필요 없다.
 *
 * 실행: cd packages/core && node -r ../api/node_modules/ts-node/register/transpile-only \
 *       scripts/sync-events-smoke.ts
 *
 * 작은 HTTP 서버를 띄워 SSE 프레임을 손으로 흘려보낸다. 여기서 보려는 것은 눈으로
 * 읽어서는 알 수 없는 셋이다.
 *
 *   1. **경계.** 한 번에 읽은 덩어리가 프레임 가운데를 자를 수 있다. 이어 붙이기를
 *      빠뜨리면 긴 프레임만 가끔 깨져서 재현하기 어려운 버그가 된다.
 *   2. **거르기.** ping 과 모르는 프레임은 조용히 버려야 한다. 그것으로 동기화를
 *      돌리면 25초마다 서버를 두드린다.
 *   3. **다시 붙기.** 연결이 끊기는 것은 정상이다(프록시, 잠든 기기, 서버 재시작).
 *      끊기면 스스로 다시 붙어야 하고, 닫으면 멈춰야 한다.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

import { openSyncEvents, type StreamingFetch } from '../src/data/sync-events';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 붙은 연결이 받은 헤더와, 그 연결로 글자를 흘려보내는 방법. */
interface Connection {
  authorization?: string;
  write(chunk: string): void;
  end(): void;
}

function startServer(onConnect: (connection: Connection) => void): Promise<Server> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    onConnect({
      authorization: req.headers.authorization,
      write: (chunk) => res.write(chunk),
      end: () => res.end(),
    });
  });

  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
  const connections: Connection[] = [];
  const server = await startServer((connection) => connections.push(connection));
  const port = (server.address() as AddressInfo).port;

  const versions: number[] = [];
  const close = openSyncEvents({
    baseUrl: `http://127.0.0.1:${port}`,
    projectId: 'p-1',
    getToken: () => 'token-1',
    fetchFn: fetch as unknown as StreamingFetch,
    onVersion: (version) => versions.push(version),
  });

  const waitFor = async (count: number, timeoutMs = 3_000) => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until && versions.length < count) await sleep(20);
    return versions.length;
  };

  const waitForConnection = async (count: number, timeoutMs = 5_000) => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until && connections.length < count) await sleep(20);
    return connections.length;
  };

  try {
    eq('연결이 열린다', await waitForConnection(1), 1);
    eq('토큰을 헤더로 보낸다', connections[0].authorization, 'Bearer token-1');

    // ── 1. 온전한 프레임 ──
    connections[0].write('event: sync\ndata: {"version":10}\n\n');
    await waitFor(1);
    eq('번호를 읽는다', versions[0], 10);

    // ── 2. 프레임 가운데가 잘려도 이어 붙인다 ──
    connections[0].write('event: sync\ndata: {"ver');
    await sleep(100);
    eq('반쪽 프레임으로는 아무 일도 없다', versions.length, 1);
    connections[0].write('sion":11}\n\n');
    await waitFor(2);
    eq('나머지가 오면 읽는다', versions[1], 11);

    // ── 3. 한 덩어리에 두 프레임이 실려 와도 둘 다 읽는다 ──
    connections[0].write('event: sync\ndata: {"version":12}\n\nevent: sync\ndata: {"version":13}\n\n');
    await waitFor(4);
    eq('한 덩어리에 둘이 와도 둘 다 읽는다', versions.slice(2).join(','), '12,13');

    // ── 4. ping 과 주석과 모르는 프레임은 버린다 ──
    connections[0].write('event: ping\ndata: \n\n: keep-alive\n\nevent: 무엇\ndata: {"version":99}\n\n');
    await sleep(200);
    eq('ping 과 모르는 프레임은 버린다', versions.length, 4);

    // ── 5. 끊기면 다시 붙는다 ──
    connections[0].end();
    eq('끊기면 다시 붙는다', await waitForConnection(2), 2);
    connections[1].write('event: sync\ndata: {"version":20}\n\n');
    await waitFor(5);
    eq('새 연결로도 번호가 온다', versions[4], 20);

    // ── 6. 닫으면 멈춘다 ──
    close();
    await sleep(300);
    const afterClose = connections.length;
    connections[1].end();
    await sleep(1_500);
    eq('닫으면 다시 붙지 않는다', connections.length, afterClose);
  } finally {
    connections.forEach((connection) => connection.end());
    server.close();
  }
}

main()
  .catch((error) => {
    console.error('실행 중 오류', error);
    fail += 1;
  })
  .finally(() => {
    console.log(fail === 0 ? '\n전체 통과' : `\n실패 ${fail}건`);
    process.exit(fail === 0 ? 0 : 1);
  });
