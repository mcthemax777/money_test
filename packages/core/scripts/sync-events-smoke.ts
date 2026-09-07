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
 *   4. **깨우기.** 기다리는 중에 `wake` 를 부르면 간격을 다 채우지 않고 지금 붙는다.
 *      앱이 앞으로 돌아오는 자리에서 부른다.
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

/**
 * 브라우저의 fetch 를 흉내 낸다.
 *
 * window 의 함수라 this 가 window(또는 없는 것)여야 하고, 아니면 TypeError 를 던진다.
 * 노드의 fetch 는 이것을 따지지 않아서, 옵션 객체를 통해 부르는 잘못이 노드에서는
 * 아무 일도 아닌 것처럼 지나간다. 그 차이를 여기서 대신 만든다.
 */
const strictFetch = function (
  this: unknown,
  url: string,
  init: Parameters<StreamingFetch>[1],
) {
  if (this !== undefined && this !== globalThis) {
    throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
  }
  return fetch(url, init as RequestInit);
} as unknown as StreamingFetch;

/** 붙은 연결이 받은 헤더와, 그 연결로 글자를 흘려보내는 방법. */
interface Connection {
  authorization?: string;
  write(chunk: string): void;
  end(): void;
}

/**
 * 켜 두면 서버가 연결을 거절한다. 클라이언트가 간격을 두고 기다리게 만드는 손잡이다.
 *
 * 잠든 기기가 깨어났을 때의 상태를 흉내 낸다 -- 그 사이 연결이 끊겼고, 다시 붙기까지
 * 기다리는 중이다.
 */
let refuse = false;

/**
 * 서버가 받은 요청 수. 거절한 것까지 센다.
 *
 * 이 값이 있어야 **다시 붙기를 시도한 횟수**를 밖에서 알 수 있다. 연결 수만 세면 거절
 * 당한 시도가 보이지 않아, 지금 간격이 얼마나 벌어져 있는지 가늠할 길이 없다.
 */
let requests = 0;

function startServer(onConnect: (connection: Connection) => void): Promise<Server> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    requests += 1;

    if (refuse) {
      res.writeHead(503).end();
      return;
    }

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
  const listener = openSyncEvents({
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

    /*
     * ── 6. 깨울 때 곧바로 다시 붙는다 ──
     *
     * 서버를 막아 연결이 거듭 실패하게 두면 간격이 곱절로 벌어진다(1초 → 2 → 4 → 8).
     * 그 상태가 잠든 기기가 깨어났을 때의 모습이고, `wake` 가 그 기다림을 앞당기는지 본다.
     *
     * **간격이 충분히 벌어질 때까지 기다리는 것이 이 검사의 요점이다.** 막자마자 깨우면
     * 간격이 아직 1초 언저리라, wake 가 아무 일도 하지 않아도 그 사이에 저절로 붙는다.
     * 실제로 처음엔 그렇게 짜서 `wake` 를 무력화해도 통과했다.
     */
    refuse = true;
    connections[1].end();

    // 네 번 더 시도할 때까지 기다린다. 그때 다음 간격은 최소 2초다.
    const deadline = Date.now() + 20_000;
    const startedAt = requests;
    while (Date.now() < deadline && requests < startedAt + 4) await sleep(50);
    eq('막아 두면 간격을 두고 다시 시도한다', requests >= startedAt + 4, true);

    refuse = false;
    const attempts = requests;
    listener.wake();

    // 800ms 는 지금 간격(최소 2초)보다 한참 짧다. 그 안에 오면 wake 가 한 일이다.
    const woke = Date.now() + 800;
    while (Date.now() < woke && requests === attempts) await sleep(20);
    eq('깨우면 기다리지 않고 다시 붙는다', requests > attempts, true);
    eq('그 시도로 연결이 선다', (await waitForConnection(connections.length + 1, 2_000)) > 0, true);

    // ── 7. 닫으면 멈춘다 ──
    listener.close();
    await sleep(300);
    const afterClose = connections.length;
    connections[connections.length - 1].end();
    await sleep(1_500);
    eq('닫으면 다시 붙지 않는다', connections.length, afterClose);

    /*
     * ── 8. 브라우저의 fetch 처럼 this 를 따지는 것도 받는다 ──
     *
     * 웹은 window.fetch 를 옵션에 그대로 넣는다. core 가 그것을 `options.fetchFn(...)`
     * 으로 부르면 this 가 옵션 객체가 되어 브라우저가 거부한다("Illegal invocation").
     * 그때 웹은 알림을 한 줄도 받지 못하는데, 노드의 fetch 는 this 를 따지지 않으므로
     * **이 검사가 없으면 스모크는 그동안에도 초록이었다.** 실제로 그랬다.
     */
    const strictVersions: number[] = [];
    const strictErrors: unknown[] = [];
    const before = connections.length;

    const strict = openSyncEvents({
      baseUrl: `http://127.0.0.1:${port}`,
      projectId: 'p-1',
      getToken: () => 'token-2',
      fetchFn: strictFetch,
      onVersion: (version) => strictVersions.push(version),
      onError: (error) => strictErrors.push(error),
    });

    try {
      eq('this 를 따지는 fetch 로도 연결이 열린다', await waitForConnection(before + 1), before + 1);
      connections[before]?.write('event: sync\ndata: {"version":30}\n\n');

      const gotVersion = Date.now() + 3_000;
      while (Date.now() < gotVersion && strictVersions.length === 0) await sleep(20);
      eq('그 연결로 번호가 온다', strictVersions[0], 30);
      eq('오류 없이 붙는다', strictErrors.length, 0);
    } finally {
      strict.close();
    }
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
