/**
 * 서버가 "이 프로젝트가 바뀌었다"고 알려 오는 연결.
 *
 * 받는 것은 번호 하나뿐이다. 데이터는 지금까지처럼 /sync/pull 이 커서로 받아 간다.
 * 그래서 이 연결이 끊겨 있어도 값이 어긋나지 않는다 -- 늦게 따라붙을 뿐이다.
 * 이 파일이 하는 일은 그래서 셋으로 끝난다: 붙고, 프레임을 나누고, 끊기면 다시 붙는다.
 *
 * axios 를 쓰지 않는 이유는 응답을 끝까지 기다리지 않고 조금씩 읽어야 하기 때문이다.
 * 브라우저의 EventSource 도 쓰지 않는다 -- 헤더를 붙일 수 없어 토큰을 주소에 실어야
 * 하고(접근 로그에 남는다), 앱에는 아예 없다. 대신 스트리밍을 지원하는 fetch 를 밖에서
 * 받는다. 웹은 브라우저의 fetch 를, 앱은 expo/fetch 를 넣는다.
 */

import { isOfflineError } from '../lib/offline-error';

/** 스트리밍을 지원하는 fetch. 웹의 것과 expo/fetch 가 이 모양을 함께 만족한다. */
export type StreamingFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array> | null;
}>;

export interface SyncEventsOptions {
  baseUrl: string;
  projectId: string;
  /** 붙을 때마다 부른다. 토큰이 갱신되었으면 새 값이 나온다. */
  getToken: () => string | undefined | Promise<string | undefined>;
  fetchFn: StreamingFetch;
  /** 서버가 알려 온 번호. 이것을 받으면 동기화를 한 번 돌린다. */
  onVersion: (version: number) => void;
  /** 진단용. 넣지 않으면 조용히 다시 붙는다. */
  onError?: (error: unknown) => void;
}

/** 다시 붙기까지 기다리는 시간. 곱절로 늘리되 이 값에서 멈춘다. */
const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;

/**
 * 알림 연결을 연다. 돌려주는 함수를 부르면 닫는다.
 *
 * 끊기는 것은 정상이다. 프록시가 조용한 연결을 끊고, 기기는 잠들고, 네트워크는 바뀐다.
 * 그래서 실패를 오류로 다루지 않고 기다렸다 다시 붙는다. 간격에 흔들림(jitter)을 주는
 * 이유는 서버가 재시작할 때 모든 기기가 같은 순간에 몰려드는 것을 막기 위해서다.
 */
export function openSyncEvents(options: SyncEventsOptions): () => void {
  let closed = false;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let backoff = BACKOFF_START_MS;

  const url = `${options.baseUrl.replace(/\/$/, '')}/sync/events?projectId=${encodeURIComponent(
    options.projectId,
  )}`;

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    });

  const loop = async () => {
    while (!closed) {
      try {
        await connect();
        // 정상적으로 끝난 연결이다(서버 재시작 등). 곧바로 다시 붙는다.
        backoff = BACKOFF_START_MS;
      } catch (error) {
        if (closed) return;

        /*
         * 오프라인은 오류가 아니다. 조용히 기다린다.
         *
         * 그 밖의 오류는 알려 준다. 권한이 사라졌거나 서버가 500 을 내는 상황은
         * 사람이 알아야 하고, 그때도 연결은 계속 시도한다(권한은 돌아올 수 있다).
         */
        if (!isOfflineError(error)) options.onError?.(error);
      }

      if (closed) return;
      await wait(backoff * (0.5 + Math.random()));
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    }
  };

  const connect = async () => {
    const token = await options.getToken();
    controller = new AbortController();

    const response = await options.fetchFn(url, {
      headers: {
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`알림 연결이 거절되었습니다 (${response.status})`);
    if (!response.body) throw new Error('알림 연결에 본문이 없습니다.');

    // 한 번이라도 붙었으면 간격을 되돌린다. 오래 붙어 있다 끊긴 연결은 처음처럼 다룬다.
    backoff = BACKOFF_START_MS;

    await readStream(response.body, (frame) => {
      const version = versionOf(frame);
      if (version !== null) options.onVersion(version);
    });
  };

  void loop();

  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    controller?.abort();
  };
}

/** SSE 프레임 하나. 서버가 보내는 것은 type 과 data 뿐이다. */
interface SseFrame {
  event: string;
  data: string;
}

/**
 * 바이트를 프레임으로 나눈다.
 *
 * 경계는 빈 줄이다. 한 번에 읽은 덩어리가 프레임 가운데를 자를 수 있으므로 남는 것을
 * 버퍼에 들고 다음 덩어리와 이어 붙인다. 이 이어 붙이기를 빠뜨리면 긴 프레임이
 * 가끔씩만 깨져서, 재현하기 어려운 버그가 된다.
 */
async function readStream(
  body: ReadableStream<Uint8Array>,
  onFrame: (frame: SseFrame) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = makeDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (!value) continue;

      buffer += decoder(value);

      // \r\n 으로 오는 서버도 있어서 둘 다 경계로 본다.
      buffer = buffer.replace(/\r\n/g, '\n');

      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const frame = parseFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (frame) onFrame(frame);
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock?.();
  }
}

function parseFrame(raw: string): SseFrame | null {
  let event = 'message';
  const dataLines: string[] = [];

  for (const line of raw.split('\n')) {
    // 주석(: 로 시작하는 줄)은 살아 있음을 알리는 신호다. 버린다.
    if (!line || line.startsWith(':')) continue;

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');

    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
  }

  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}

/** sync 프레임에서 번호를 꺼낸다. ping 과 알 수 없는 프레임은 null. */
function versionOf(frame: SseFrame): number | null {
  if (frame.event !== 'sync') return null;

  try {
    const parsed = JSON.parse(frame.data) as { version?: unknown };
    return typeof parsed.version === 'number' ? parsed.version : null;
  } catch {
    return null;
  }
}

/**
 * 바이트를 글자로.
 *
 * TextDecoder 가 있으면 그것을 쓴다(조각난 다중 바이트 글자를 이어 준다). Hermes 처럼
 * 없는 런타임을 위해 UTF-8 을 직접 푸는 길을 함께 둔다. 서버가 보내는 오류 문구가
 * 한국어라서 ASCII 로만 읽으면 글자가 깨진다.
 */
function makeDecoder(): (chunk: Uint8Array) => string {
  const Decoder = (globalThis as { TextDecoder?: new (label?: string) => { decode: (input: Uint8Array, options?: { stream: boolean }) => string } }).TextDecoder;

  if (Decoder) {
    const decoder = new Decoder('utf-8');
    return (chunk) => decoder.decode(chunk, { stream: true });
  }

  return (chunk) => {
    let out = '';
    for (let i = 0; i < chunk.length; ) {
      const byte = chunk[i];

      if (byte < 0x80) {
        out += String.fromCharCode(byte);
        i += 1;
        continue;
      }

      const extra = byte >= 0xf0 ? 3 : byte >= 0xe0 ? 2 : 1;
      let code = byte & (0x3f >> extra);
      for (let n = 1; n <= extra; n += 1) code = (code << 6) | (chunk[i + n] & 0x3f);
      i += extra + 1;

      if (code > 0xffff) {
        code -= 0x10000;
        out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
      } else {
        out += String.fromCharCode(code);
      }
    }
    return out;
  };
}
