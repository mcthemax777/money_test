/**
 * 기기가 만드는 식별자.
 *
 * 왜 필요한가. 지금은 서버가 cuid 를 만든다(`@default(cuid())`). 오프라인에서는
 * 그것을 기다릴 수 없다. 방금 적은 거래를 곧바로 고치거나 지우려면 이름이 먼저
 * 있어야 하고, 명령을 다시 보내도 같은 행 하나로 남으려면(멱등) 그 이름이 기기에서
 * 정해져 있어야 한다.
 *
 * 왜 UUIDv7 인가. 앞 48비트가 밀리초 시각이라 만든 순서대로 정렬된다. 데이터베이스
 * 인덱스가 뒤쪽에만 쌓여 조각나지 않고, 목록을 id 로 이어 읽을 때도 시간 순서와
 * 어긋나지 않는다. 무작위 id(uuid4)는 그 두 이점이 없다.
 *
 * 난수는 밖에서 받는다. 웹은 브라우저의 WebCrypto 를 그대로 쓰고, 리액트 네이티브의
 * Hermes 에는 `crypto.getRandomValues` 가 없어(Expo 의 winter 런타임에도 없다) 앱이
 * 시작할 때 expo-crypto 를 꽂아 준다. 이 갈아 끼우는 방식은 저장소를 다루는 `persist-storage` 와 같다.
 */

/** 난수 바이트를 주는 함수. 요청한 길이의 배열을 채워 돌려준다. */
export type RandomBytes = (byteCount: number) => Uint8Array;

let randomBytes: RandomBytes | null = defaultRandomBytes();

/**
 * 이 패키지는 DOM 타입 없이 빌드되므로(lib: ES2020) WebCrypto 를 구조로만 본다.
 * 있으면 쓰고 없으면 null 이다.
 */
interface RandomSource {
  getRandomValues?: (array: Uint8Array) => Uint8Array;
}

function defaultRandomBytes(): RandomBytes | null {
  const webCrypto = (globalThis as { crypto?: RandomSource }).crypto;
  const fill = webCrypto?.getRandomValues;
  if (typeof fill !== 'function') return null;
  return (byteCount) => fill.call(webCrypto, new Uint8Array(byteCount));
}

/**
 * 난수원을 갈아 끼운다. 앱이 시작할 때 한 번 부른다.
 *
 * 부르기 전에도 웹에서는 브라우저의 WebCrypto 가 쓰인다. 난수원이 아예 없으면
 * `newId` 는 던지고, 부르는 쪽이 서버에 id 를 맡기도록 `hasRandomSource` 로 미리
 * 확인할 수 있다.
 */
export function setRandomBytes(next: RandomBytes | null): void {
  randomBytes = next;
}

/** 이 기기에서 id 를 만들 수 있는가. */
export function hasRandomSource(): boolean {
  return randomBytes !== null;
}

const HEX = '0123456789abcdef';

function toHex(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) {
    text += HEX[(byte >> 4) & 0x0f] + HEX[byte & 0x0f];
  }
  return text;
}

/**
 * 새 식별자 (UUIDv7).
 *
 * 앞 48비트에 유닉스 밀리초를 담고, 버전(7)과 변형(variant) 비트를 규격대로 박은
 * 뒤 남은 74비트를 난수로 채운다.
 *
 * 같은 밀리초에 여러 개를 만들어도 난수 74비트가 서로 다르므로 부딪히지 않는다.
 * 다만 같은 밀리초 안의 순서는 보장되지 않는다. 순서가 필요한 곳(아웃박스)은
 * id 가 아니라 따로 세는 번호를 쓴다.
 */
export function newId(now: number = Date.now()): string {
  if (!randomBytes) {
    throw new Error(
      '난수원이 없어 id를 만들 수 없습니다. setRandomBytes로 난수원을 넣어 주세요.',
    );
  }

  const bytes = new Uint8Array(16);

  // 앞 6바이트: 밀리초 시각 (big-endian)
  let timestamp = Math.floor(now);
  for (let i = 5; i >= 0; i -= 1) {
    bytes[i] = timestamp & 0xff;
    timestamp = Math.floor(timestamp / 256);
  }

  const random = randomBytes(10);
  for (let i = 0; i < 10; i += 1) bytes[6 + i] = random[i] ?? 0;

  // 버전 7 (상위 4비트) 과 변형 10 (상위 2비트)
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = toHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 기기가 보낸 id 로 받아들일 수 있는 값인가.
 *
 * UUID 형식만 받는다. 서버가 만드는 cuid 와 모양이 달라 "누가 만든 id 인지"가
 * 값만 보고도 갈린다. 형식을 좁혀 두면 아무 문자열이나 기본 키로 들어오는 길도 막힌다.
 */
export function isClientId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * 만드는 요청에 id 를 채워 준다.
 *
 * 이미 값이 있으면 그대로 둔다. 오프라인 아웃박스는 자기가 정한 id 를 넣어 보내고,
 * 같은 명령을 다시 보낼 때도 같은 값을 써야 행이 하나로 남는다.
 *
 * 난수원이 없는 기기에서는 아무것도 넣지 않는다. 서버가 만든 id 를 받게 되어
 * 오프라인 입력만 늦어질 뿐, 온라인 경로는 지금까지처럼 돈다. 약한 난수로
 * 대신하지 않는 것은 id 가 곧 기본 키이기 때문이다.
 */
export function withNewId<T extends object>(payload: T & { id?: string }): T & { id?: string } {
  if (payload.id || !hasRandomSource()) return payload;
  return { ...payload, id: newId() };
}

/** UUIDv7 에 담긴 생성 시각(ms). v7 이 아니면 null. */
export function idTimestamp(id: string): number | null {
  if (!isClientId(id) || id[14] !== '7') return null;

  const hex = id.replace(/-/g, '').slice(0, 12);
  return parseInt(hex, 16);
}
