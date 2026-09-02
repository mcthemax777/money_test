/**
 * 하이브리드 논리 시계 (HLC).
 *
 * 두 기기가 같은 전표를 각자 고쳤을 때 어느 쪽이 나중인지 정하는 값이다. 기기의
 * 벽시계만으로는 정할 수 없다 — 시계가 몇 분씩 틀리고, 같은 밀리초가 겹치며, 시각을
 * 뒤로 돌리는 일도 있다. 그렇다고 순수 논리 시계만 쓰면 사람이 보기에 "언제"인지를
 * 알 수 없어 충돌 목록에 보여 줄 것이 없다.
 *
 * HLC 는 둘을 겹친다. 벽시계를 쓰되 **뒤로 가지 않도록** 잡아 두고, 같은 밀리초 안에서는
 * 카운터로 순서를 매기고, 그래도 같으면 기기 id 로 가른다. 그래서 값이 대체로 실제
 * 시각이면서 전체 순서(total order)를 이룬다.
 *
 * 문자열로 담는 이유는 SQLite 와 Postgres 양쪽에서 정렬과 비교가 그대로 되기 때문이다.
 * 자릿수를 고정해 두어 사전순 비교가 곧 시간순 비교가 된다.
 */

/** 벽시계 자릿수. 13자리면 서기 2286년까지 담는다. */
const WALL_DIGITS = 13;
/** 같은 밀리초 안의 순번. 5자리면 1ms 에 10만 건까지 구별한다. */
const COUNTER_DIGITS = 5;

export interface Hlc {
  /** 유닉스 밀리초 */
  wall: number;
  /** 같은 밀리초 안의 순번 */
  counter: number;
  /** 만든 기기. 같은 (wall, counter) 를 가른다. */
  node: string;
}

/**
 * 다음 값을 만든다.
 *
 * 벽시계가 앞선 값보다 뒤로 갔거나 같으면 카운터만 올린다. 시계를 고치거나 시간대를
 * 옮겨도 순서가 뒤집히지 않게 하는 자리다.
 */
export function hlcNext(previous: Hlc | null, node: string, now = Date.now()): Hlc {
  if (!previous || now > previous.wall) return { wall: now, counter: 0, node };
  return { wall: previous.wall, counter: previous.counter + 1, node };
}

/**
 * 남의 값을 본 뒤의 다음 값.
 *
 * 받은 값보다 반드시 뒤가 되도록 만든다. 이렇게 해야 "그 편집을 보고 고쳤다"는 사실이
 * 순서에 남는다. 지금은 pull 로 받은 전표의 시계를 볼 때 쓴다.
 */
export function hlcReceive(local: Hlc | null, remote: Hlc, node: string, now = Date.now()): Hlc {
  const wall = Math.max(now, local?.wall ?? 0, remote.wall);

  if (wall === local?.wall && wall === remote.wall) {
    return { wall, counter: Math.max(local.counter, remote.counter) + 1, node };
  }
  if (wall === local?.wall) return { wall, counter: local.counter + 1, node };
  if (wall === remote.wall) return { wall, counter: remote.counter + 1, node };
  return { wall, counter: 0, node };
}

/**
 * 정렬 가능한 문자열로.
 *
 * 자릿수를 고정하므로 사전순 비교가 곧 (벽시계, 카운터, 기기) 순 비교다.
 */
export function encodeHlc(hlc: Hlc): string {
  const wall = String(Math.max(0, Math.trunc(hlc.wall))).padStart(WALL_DIGITS, '0');
  const counter = String(Math.max(0, Math.trunc(hlc.counter))).padStart(COUNTER_DIGITS, '0');
  return `${wall}:${counter}:${hlc.node}`;
}

/** 문자열을 되돌린다. 모양이 아니면 null. */
export function decodeHlc(value: string | null | undefined): Hlc | null {
  if (!value) return null;

  const parts = value.split(':');
  if (parts.length < 3) return null;

  const wall = Number(parts[0]);
  const counter = Number(parts[1]);
  if (!Number.isFinite(wall) || !Number.isFinite(counter)) return null;

  // 기기 id 에 콜론이 들어와도 잃지 않도록 나머지를 다시 붙인다.
  return { wall, counter, node: parts.slice(2).join(':') };
}

/**
 * 두 값을 견준다. a 가 나중이면 양수.
 *
 * 문자열 그대로 비교한다. 인코딩이 자릿수를 고정하므로 되돌릴 필요가 없고, 저장된 값을
 * 그대로 SQL 의 `>` 와도 같은 뜻으로 쓸 수 있다.
 */
export function compareHlc(a: string | null | undefined, b: string | null | undefined): number {
  // 시계가 없는 쪽이 언제나 이르다. 2단계 이전에 만들어진 전표가 그렇다.
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** a 가 b 보다 나중인가. 병합에서 "이 편집이 이긴다"를 뜻한다. */
export function isAfterHlc(a: string | null | undefined, b: string | null | undefined): boolean {
  return compareHlc(a, b) > 0;
}
