/**
 * 목록 순서를 담는 값 (분수 색인).
 *
 * 정수 순번의 문제는 **한 항목을 옮기면 뒤가 전부 밀린다**는 것이다. 그러면 순서를 바꿀
 * 때마다 목록 전체를 다시 써야 하고, 오프라인에서 두 사람이 각자 순서를 바꾸면 나중에
 * 도착한 쪽이 상대의 이동까지 통째로 덮는다. 필드별 병합으로도 구할 수 없다 -- 한 사람의
 * 이동이 여러 행을 건드리기 때문이다 (설계 문서의 D5).
 *
 * 그래서 순서를 **이웃 사이에 값을 끼워 넣을 수 있는 문자열**로 담는다. `a0` 과 `a1`
 * 사이로 옮기면 `a0V` 를 만들어 그 한 줄만 고친다. 1과 2 사이에 1.5를 만드는 것과 같아
 * "분수" 색인이고, 정수 대신 문자열을 쓰는 이유는 자릿수 한계가 없어서다.
 *
 * 글자는 `0-9A-Za-z` 예순둘이다. 이 순서가 곧 아스키 순서라, 사전순 비교(SQL 의 ORDER BY,
 * 자바스크립트의 `<`)가 그대로 목록 순서가 된다. 어느 저장소에서도 같은 뜻이 되는 것이
 * 이 표를 고른 이유다.
 *
 * **그래서 SQL 쪽 비교도 바이트 순서여야 한다.** Postgres 의 `ORDER BY` 와 `MAX()` 는
 * 컬럼의 정렬 규칙을 따르는데, `en_US.UTF-8`(RDS 의 기본값)은 대소문자를 섞어 놓아
 * `a e K O S W` 로 정렬한다. 그러면 같은 값이 서버와 기기 사본(SQLite, 바이트 순서)에서
 * 다른 차례가 되고, `rankAfter(MAX(...))` 도 엉뚱한 값 뒤를 계산한다. `sortRank` 컬럼에
 * `COLLATE "C"` 를 박아 그 자리를 못박았다 (마이그레이션 20260907100000).
 *
 * 값은 "0." 뒤의 소수부라고 보면 된다. 그래서 **끝이 `0` 인 값은 만들지 않는다** --
 * `a` 와 `a0` 은 같은 수라 사이에 아무것도 끼울 수 없다.
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;

/** 목록에 처음 놓는 값. 가운데를 잡아 앞뒤로 끼울 자리를 남긴다. */
export const FIRST_RANK = DIGITS[Math.floor(BASE / 2)];

/** 이 글자가 순서 값에 쓸 수 있는 것인가. */
function digitOf(char: string): number {
  const index = DIGITS.indexOf(char);
  if (index < 0) throw new Error(`순서 값에 쓸 수 없는 글자입니다: ${char}`);
  return index;
}

/**
 * 두 값 사이의 값 하나.
 *
 * `before` 가 없으면 맨 앞, `after` 가 없으면 맨 뒤에 놓는다. 둘 다 없으면 첫 값이다.
 * 돌려주는 값은 언제나 `before < 결과 < after` 를 지킨다.
 */
export function rankBetween(before: string | null, after: string | null): string {
  if (!before && !after) return FIRST_RANK;
  if (before && after && before >= after) {
    throw new Error(`순서가 뒤집혔습니다: ${before} >= ${after}`);
  }
  return midpoint(before ?? '', after ?? null);
}

/** 목록 맨 뒤에 붙일 값. 새로 만든 항목이 여기로 간다. */
export function rankAfter(last: string | null): string {
  return rankBetween(last, null);
}

/** 목록 맨 앞에 붙일 값. */
export function rankBefore(first: string | null): string {
  return rankBetween(null, first);
}

/**
 * 목록 하나에 처음 순서를 매긴다.
 *
 * 사이를 고르게 벌려 둔다. 나중에 어디에 끼워 넣어도 값이 길어지지 않는다. 항목이 예순을
 * 넘으면 한 자리로는 벌릴 수 없어 뒤에 이어 붙이는 방식으로 넘어간다.
 */
export function initialRanks(count: number): string[] {
  if (count <= 0) return [];

  if (count < BASE - 1) {
    const step = Math.floor(BASE / (count + 1));
    return Array.from({ length: count }, (_, index) => DIGITS[(index + 1) * step]);
  }

  const ranks: string[] = [];
  let last: string | null = null;
  for (let index = 0; index < count; index += 1) {
    last = rankAfter(last);
    ranks.push(last);
  }
  return ranks;
}

/** 사전순으로 놓는다. 값이 없는(옛) 행은 뒤로 보낸다. */
export function compareRank(a: string | null | undefined, b: string | null | undefined): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 소수부 두 개의 가운데.
 *
 * 앞자리가 같으면 그만큼 떼어 두고 나머지에서 다시 찾는다. 두 자리 사이가 붙어 있으면
 * (예: `a` 와 `b`) 앞 값의 자리를 그대로 두고 **한 자리 더 내려가** 그 아래에서 가운데를
 * 잡는다. 그래서 값이 필요한 만큼만 길어진다.
 */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`순서가 뒤집혔습니다: ${a} >= ${b}`);
  if (a.endsWith('0') || (b !== null && b.endsWith('0'))) {
    // "0" 으로 끝나는 값은 바로 앞 값과 같은 수라 사이가 없다. 만들지도 받지도 않는다.
    throw new Error('순서 값은 0 으로 끝날 수 없습니다.');
  }

  if (b !== null) {
    // 같은 앞자리는 떼어 두고 나머지에서 찾는다.
    let shared = 0;
    while ((a[shared] ?? '0') === b[shared]) shared += 1;
    if (shared > 0) return b.slice(0, shared) + midpoint(a.slice(shared), b.slice(shared));
  }

  const low = a ? digitOf(a[0]) : 0;
  const high = b !== null && b.length > 0 ? digitOf(b[0]) : BASE;

  if (high - low > 1) return DIGITS[Math.round((low + high) / 2)];

  // 자리가 붙어 있다. 위쪽 값이 더 길면 그 첫 자리를 빌려 그 아래에서 찾는다.
  if (b !== null && b.length > 1) return b.slice(0, 1);

  return DIGITS[low] + midpoint(a.slice(1), null);
}
