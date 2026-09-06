/**
 * 분수 색인 (`types/src/rank.ts`). 서버도 데이터베이스도 필요 없다.
 *
 * 실행: cd packages/api && npx ts-node --transpile-only scripts/rank-smoke.ts
 *
 * 이 값은 눈으로 읽어서는 맞는지 알기 어렵다. 지켜야 하는 것 넷을 못 박는다.
 *
 *   1. **사이에 들어간다.** `rankBetween(a, b)` 는 언제나 a 보다 뒤, b 보다 앞이다.
 *   2. **몇 번을 끼워 넣어도 그렇다.** 같은 자리에 계속 끼워 넣으면 값이 길어질 뿐
 *      순서는 무너지지 않는다. 정수 순번이었다면 여기서 자리가 떨어진다.
 *   3. **사전순이 곧 목록 순서다.** SQL 의 ORDER BY 와 자바스크립트의 비교가 같은 답을
 *      내야 저장소를 바꿔도 순서가 같다.
 *   4. **0 으로 끝나지 않는다.** `a` 와 `a0` 은 같은 수라 사이에 아무것도 끼울 수 없다.
 */
import { FIRST_RANK, compareRank, initialRanks, rankAfter, rankBefore, rankBetween } from '@money/types';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

/** 200번짜리 반복에서는 줄마다 찍지 않고 세기만 한다. */
let silentFails = 0;
const countIfBroken = (ok: boolean) => {
  if (!ok) silentFails += 1;
};

// ── 1. 사이에 들어간다 ──
const first = rankBetween(null, null);
eq('처음 값은 가운데', first, FIRST_RANK);
eq('뒤에 붙이면 더 크다', rankAfter(first) > first, true);
eq('앞에 붙이면 더 작다', rankBefore(first) < first, true);

const a = rankAfter(null);
const b = rankAfter(a);
const between = rankBetween(a, b);
eq('앞보다 뒤', between > a, true);
eq('뒤보다 앞', between < b, true);
eq('뒤집힌 순서는 거절한다', (() => {
  try {
    rankBetween(b, a);
    return '거절하지 않음';
  } catch {
    return '거절';
  }
})(), '거절');

// ── 2. 몇 번을 끼워 넣어도 ──
//
// 같은 자리에 200번 끼워 넣는다. 정수 순번이라면 두 번째에 이미 자리가 없다.
let low = a;
const high = b;
const inserted: string[] = [];
for (let i = 0; i < 200; i += 1) {
  const next = rankBetween(low, high);
  inserted.push(next);
  countIfBroken(next > low && next < high);
  low = next;
}
eq('200번 끼워 넣어도 순서가 무너지지 않는다', silentFails, 0);
eq('값이 모두 다르다', new Set(inserted).size, inserted.length);
/*
 * 같은 자리에 계속 끼워 넣는 것이 이 방식의 최악이다. 값은 자라지만 **삽입마다 한 글자씩
 * 자라지는 않는다** (예순두 갈래라 대여섯 번에 한 글자꼴이다). 정수 순번이라면 두 번째
 * 삽입에서 이미 자리가 없다.
 */
eq('최악에서도 삽입 수보다 훨씬 짧다',
  inserted[inserted.length - 1].length < inserted.length / 4, true);

// 실제로 쓰는 모양은 이쪽이다. 여기저기 끼워 넣으면 값이 거의 자라지 않는다.
const shuffled: string[] = [];
for (let i = 0; i < 500; i += 1) {
  const at = Math.floor(Math.random() * (shuffled.length + 1));
  shuffled.splice(at, 0, rankBetween(shuffled[at - 1] ?? null, shuffled[at] ?? null));
}
eq('무작위로 500번 끼워 넣어도 순서가 유지된다',
  [...shuffled].sort().join(',') === shuffled.join(','), true);
eq('그때 값은 여전히 짧다', Math.max(...shuffled.map((rank) => rank.length)) <= 8, true);

// ── 3. 사전순이 목록 순서 ──
const ranks = initialRanks(10);
eq('열 개를 매긴다', ranks.length, 10);
eq('오름차순이다', [...ranks].sort().join(',') === ranks.join(','), true);
eq('값이 모두 다르다 (초기 배치)', new Set(ranks).size, 10);
eq('많아도 오름차순이다 (100개)', (() => {
  const many = initialRanks(100);
  return [...many].sort().join(',') === many.join(',');
})(), true);

// 목록 한가운데를 다른 자리로 옮기는 실제 상황
const [r1, r2, r3] = initialRanks(3);
const movedToFront = rankBefore(r1);
eq('맨 앞으로 옮기기', movedToFront < r1, true);
const movedToEnd = rankAfter(r3);
eq('맨 뒤로 옮기기', movedToEnd > r3, true);
const movedMiddle = rankBetween(r2, r3);
eq('둘 사이로 옮기기', movedMiddle > r2 && movedMiddle < r3, true);

eq('빈 값은 뒤로 보낸다', compareRank(null, r1) > 0, true);
eq('둘 다 없으면 같다', compareRank(null, null), 0);

// ── 4. 0 으로 끝나지 않는다 ──
let tail = rankBefore(null);
let endsWithZero = false;
for (let i = 0; i < 100; i += 1) {
  tail = rankBefore(tail);
  if (tail.endsWith('0')) endsWithZero = true;
}
eq('앞으로 100번 밀어도 0 으로 끝나지 않는다', endsWithZero, false);

console.log(fail === 0 ? '\n전체 통과' : `\n실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
