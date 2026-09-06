/**
 * 수렴과 불변식. 서버도 데이터베이스도 필요 없다.
 *
 * 실행: cd packages/api && npx ts-node --transpile-only scripts/convergence-smoke.ts
 *
 * 다른 스모크와 목적이 다르다. 저쪽은 "이 입력에 이 답이 나오는가"를 손으로 적어 본다.
 * 여기서는 **입력을 무작위로 만들어** 어떤 순서로 와도 성립해야 하는 성질을 본다. 동기화의
 * 버그는 대개 특정 값이 아니라 특정 **순서**에서만 드러나기 때문이다. 두 기기가 서로
 * 다른 순서로 같은 명령들을 받고도 같은 곳에 닿아야 한다는 것이 이 갈래의 약속이다.
 *
 * 못 박는 것 다섯.
 *
 *   1. **필드별 병합은 순서를 타지 않는다.** 같은 편집 묶음을 아무 순서로 적용해도 값도
 *      시계도 같은 자리에 닿는다 (설계 문서의 D5).
 *   2. **진 편집은 조용히 사라지지 않는다.** 보낸 필드는 반드시 적용되거나 밀린 것으로
 *      보고된다. 어느 쪽도 아닌 필드가 있으면 사용자가 고친 값이 말없이 없어진다 (D6).
 *   3. **삭제는 언제나 이긴다.** 지움과 고침을 아무 순서로 섞어도 지워진 채로 끝난다.
 *      되살아나면 그 금액이 두 번 세어진다.
 *   4. **순서 값은 전순서를 유지한다.** 무작위로 옮겨도 값이 겹치지 않고, 사전순 정렬이
 *      화면의 차례와 언제나 같다. 두 기기가 서로 다른 줄을 옮기면 둘 다 남는다.
 *   5. **태그는 순서를 타지 않는다 (겹치지 않는 한).** 서로 다른 태그를 건드리는 두
 *      명령은 뒤바꿔도 결과가 같고, 같은 명령을 두 번 재생해도 결과가 그대로다.
 *
 * 무작위이지만 씨앗은 고정한다. 실패한 검사를 다시 돌렸을 때 같은 값이 나와야 고칠 수 있다.
 */
import {
  type FieldClocks,
  applyTagChange,
  compareRank,
  encodeHlc,
  initialRanks,
  isAfterHlc,
  mergeFields,
  rankForMove,
} from '@money/types';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

/** 반복 안에서는 줄마다 찍지 않고 어긋난 횟수만 센다. */
let broken = 0;
const countIfBroken = (ok: boolean, note?: string) => {
  if (ok) return;
  broken += 1;
  if (note && broken <= 3) console.log(`      ↳ ${note}`);
};

/**
 * 씨앗을 고정한 난수.
 *
 * `Math.random` 을 쓰면 어제 잡힌 실패를 오늘 다시 볼 수 없다. 값의 질은 중요하지 않고
 * 고르게 흩어지기만 하면 된다.
 */
let seed = 20260906;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = <T>(rows: readonly T[]): T => rows[Math.floor(random() * rows.length)];
const shuffled = <T>(rows: readonly T[]): T[] => {
  const copy = [...rows];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

/*
 * 시계는 **모두 다르게** 만든다.
 *
 * 두 편집이 같은 시계를 달면 어느 쪽이 이길지는 도착 순서가 정하고, 그때는 수렴이 성립
 * 하지 않는다. 실제로도 그런 일은 없다 -- 시계에 기기 이름이 들어가고, 한 기기 안에서는
 * 순번이 1씩 오른다. 여기서 그 조건을 흉내 낸다.
 */
const NODES = ['device-a', 'device-b', 'device-c'];
let tick = 0;
const nextHlc = (node: string) => encodeHlc({ wall: 1756000000000 + (tick += 1), counter: 0, node });

// ── 1·2. 설정 엔티티: 필드별 병합 ──
//
// 구성원·통장·카드·분류·태그가 모두 이 규칙 위에 있다. 세 기기가 아무 필드나 고친 편집
// 묶음을 만들어, 그것을 스무 가지 순서로 적용해 본다.

interface Edit {
  patch: Record<string, string>;
  hlc: string;
}

interface Replica {
  row: Record<string, string>;
  clocks: FieldClocks;
}

/** 한 편집을 적용한다. 서버가 재생하는 자리와 같은 함수를 쓴다. */
function applyEdit(state: Replica, edit: Edit): { next: Replica; lost: string[] } {
  const merged = mergeFields(edit.patch, edit.hlc, state.clocks);
  const row = { ...state.row };
  for (const [field, value] of Object.entries(merged.apply)) {
    if (typeof value === 'string') row[field] = value;
  }
  return { next: { row, clocks: merged.clocks }, lost: merged.lost };
}

const FIELDS = ['name', 'color', 'sortRank', 'icon'];
const EMPTY: Replica = { row: {}, clocks: {} };

/**
 * 두 사본이 같은 곳에 닿았는지 견주는 글자.
 *
 * 키를 정렬해서 적는다. 객체의 키 순서는 **어느 필드가 먼저 들어왔는가**로 정해지므로,
 * 그대로 `JSON.stringify` 하면 값이 같아도 순서가 달라 다른 글자가 나온다. 그것은 사본이
 * 갈렸다는 뜻이 아니다.
 */
const stable = (state: Replica): string =>
  JSON.stringify(
    [state.row, state.clocks].map((map) =>
      Object.keys(map)
        .sort()
        .map((key) => [key, (map as Record<string, string>)[key]]),
    ),
  );

let silentLoss = 0;
for (let round = 0; round < 200; round += 1) {
  const edits: Edit[] = [];
  const count = 2 + Math.floor(random() * 5);
  for (let i = 0; i < count; i += 1) {
    const patch: Record<string, string> = {};
    // 한 편집이 건드리는 필드는 한둘이다. 화면이 보내는 모양이 그렇다.
    for (const field of shuffled(FIELDS).slice(0, 1 + Math.floor(random() * 2))) {
      patch[field] = `${field}-${round}-${i}`;
    }
    edits.push({ patch, hlc: nextHlc(pick(NODES)) });
  }

  const results = new Set<string>();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let state = EMPTY;
    for (const edit of shuffled(edits)) {
      const { next, lost } = applyEdit(state, edit);
      state = next;

      // 2. 보낸 필드는 적용되거나 밀린 것으로 보고된다. 사이에 빠지는 것이 없어야 한다.
      const reported = new Set([...Object.keys(lost), ...Object.keys(next.row)]);
      for (const field of Object.keys(edit.patch)) {
        if (!reported.has(field) && !lost.includes(field)) silentLoss += 1;
      }
    }
    results.add(stable(state));
  }

  countIfBroken(results.size === 1, `${round}번째 묶음이 순서에 따라 ${results.size}갈래로 갈렸다`);
}
eq('필드별 병합: 200묶음을 스무 순서로 적용해도 한 곳에 닿는다', broken, 0);
eq('보낸 필드는 적용되거나 밀린 것으로 보고된다', silentLoss, 0);

/*
 * 마지막에 이기는 값은 그 필드의 가장 늦은 편집이다.
 *
 * 수렴만 보면 "전부 무시한다"도 수렴이다. 무엇으로 수렴하는지를 함께 못 박는다.
 */
const lateFirst: Edit[] = [
  { patch: { name: '늦은 이름' }, hlc: nextHlc('device-b') },
  { patch: { name: '이른 이름', color: '#fff' }, hlc: nextHlc('device-a') },
];
let winner = EMPTY;
for (const edit of lateFirst) winner = applyEdit(winner, edit).next;
eq('같은 필드는 늦은 편집이 이긴다', winner.row.name, '이른 이름');
eq('다투지 않은 필드는 그대로 남는다', winner.row.color, '#fff');

// 순서를 뒤집어도 같은 곳이다.
let reversed = EMPTY;
for (const edit of [...lateFirst].reverse()) reversed = applyEdit(reversed, edit).next;
eq('뒤집어도 같은 값', stable(reversed), stable(winner));

// ── 3. 전표: 삭제는 언제나 이긴다 ──
//
// 전표는 필드별이 아니라 통째로 이기고 진다. 다리와 금액이 한 단위이기 때문이다.
// 그 위에 규칙이 하나 더 있다 -- 툼스톤은 시계를 보지 않는다.

type EntryOp =
  | { kind: 'replace'; hlc: string; description: string }
  | { kind: 'delete'; hlc: string };

/** 서버가 재생하는 규칙 그대로. 지워진 전표는 되살아나지 않는다. */
function applyEntryOp(
  state: { deleted: boolean; hlc: string | null; description: string },
  op: EntryOp,
) {
  if (op.kind === 'delete') return { ...state, deleted: true };
  if (state.deleted) return state;
  if (!isAfterHlc(op.hlc, state.hlc)) return state;
  return { deleted: false, hlc: op.hlc, description: op.description };
}

broken = 0;
for (let round = 0; round < 200; round += 1) {
  const ops: EntryOp[] = [];
  const count = 2 + Math.floor(random() * 4);
  for (let i = 0; i < count; i += 1) {
    ops.push({ kind: 'replace', hlc: nextHlc(pick(NODES)), description: `고침-${round}-${i}` });
  }
  ops.push({ kind: 'delete', hlc: nextHlc(pick(NODES)) });

  for (let attempt = 0; attempt < 10; attempt += 1) {
    let state = { deleted: false, hlc: null as string | null, description: '처음' };
    for (const op of shuffled(ops)) state = applyEntryOp(state, op);
    countIfBroken(state.deleted, `${round}번째에서 지운 전표가 되살아났다`);
  }
}
eq('삭제는 어떤 순서에서도 이긴다', broken, 0);

// ── 4. 순서 값 (분수 색인) ──
//
// 화면이 부르는 그 함수(`rankForMove`)로 옮긴다. 웹의 드래그와 앱의 위/아래 버튼이 같은
// 자리를 거치므로, 여기서 깨지면 두 화면 모두에서 깨진다.

interface Row {
  id: string;
  sortRank: string;
}

const sorted = (rows: readonly Row[]) =>
  [...rows].sort((a, b) => compareRank(a.sortRank, b.sortRank));

broken = 0;
let longest = 0;
for (let round = 0; round < 100; round += 1) {
  const size = 3 + Math.floor(random() * 8);
  const ranks = initialRanks(size);
  let rows: Row[] = ranks.map((rank, index) => ({ id: `row-${index}`, sortRank: rank }));

  for (let move = 0; move < 30; move += 1) {
    const target = pick(rows);
    const toIndex = Math.floor(random() * rows.length);
    const rank = rankForMove(rows, target.id, toIndex);
    if (!rank) continue;

    // 화면이 하는 일 그대로. 그 줄의 값 하나만 바꾸고 다시 정렬한다.
    rows = sorted(rows.map((row) => (row.id === target.id ? { ...row, sortRank: rank } : row)));
    longest = Math.max(longest, rank.length);

    const at = rows.findIndex((row) => row.id === target.id);
    countIfBroken(at === toIndex, `옮긴 자리가 다르다 (기대 ${toIndex}, 실제 ${at})`);

    const distinct = new Set(rows.map((row) => row.sortRank));
    countIfBroken(distinct.size === rows.length, '순서 값이 겹쳤다');
    countIfBroken(
      rows.every((row, index) => index === 0 || row.sortRank > rows[index - 1].sortRank),
      '사전순이 화면 차례와 어긋난다',
    );
  }
}
eq('무작위로 3000번 옮겨도 전순서가 유지된다', broken, 0);
eq('순서 값이 지나치게 길어지지 않는다 (30자 미만)', longest < 30, true);

/*
 * 두 기기가 서로 다른 줄을 옮기면 둘 다 남는다.
 *
 * 정수 순번이 못 하던 것이다. 그때는 목록 전체를 다시 매겨야 해서 나중에 도착한 편집이
 * 앞의 이동을 통째로 지웠다.
 */
const base: Row[] = initialRanks(4).map((rank, index) => ({ id: `r${index}`, sortRank: rank }));
const moveA = rankForMove(base, 'r0', 3);
const moveB = rankForMove(base, 'r3', 0);
const both = sorted(
  base.map((row) => {
    if (row.id === 'r0' && moveA) return { ...row, sortRank: moveA };
    if (row.id === 'r3' && moveB) return { ...row, sortRank: moveB };
    return row;
  }),
);
eq('맨 앞의 줄을 뒤로 보낸 이동이 남는다', both[both.length - 1].id, 'r0');
eq('맨 뒤의 줄을 앞으로 보낸 이동도 남는다', both[0].id, 'r3');

// ── 5. 태그 ──
//
// 서버와 기기가 함께 쓰는 함수다 (`applyTagChange`). 통째 교체가 아니라 더한 것과 뗀
// 것만 담기 때문에, 겹치지 않는 두 명령은 순서를 타지 않는다.

interface TagOp {
  add: string[];
  remove: string[];
}

const applyOps = (start: readonly string[], ops: readonly TagOp[]) => {
  let current = new Set(start);
  for (const op of ops) current = applyTagChange(current, op.add, op.remove).next;
  return [...current].sort().join(',');
};

const TAGS = ['t1', 't2', 't3', 't4', 't5', 't6'];
broken = 0;
let notIdempotent = 0;
for (let round = 0; round < 200; round += 1) {
  const start = shuffled(TAGS).slice(0, Math.floor(random() * 3));

  /*
   * 두 명령이 서로 다른 태그를 건드리게 만든다.
   *
   * 겹치면 순서가 결과를 바꾼다 -- 붙였다 떼는 것과 뗐다 붙이는 것은 다른 일이고, 그것은
   * 버그가 아니라 사용자가 시킨 일이다. 성질이 성립하는 경계를 못 박는 자리다.
   */
  const pool = shuffled(TAGS);
  const forA = pool.slice(0, 3);
  const forB = pool.slice(3);
  const opA: TagOp = { add: forA.slice(0, 2), remove: forA.slice(2) };
  const opB: TagOp = { add: forB.slice(0, 1), remove: forB.slice(1) };

  countIfBroken(
    applyOps(start, [opA, opB]) === applyOps(start, [opB, opA]),
    `${round}번째에서 순서가 결과를 바꿨다`,
  );

  // 재전송. 같은 명령을 두 번 재생해도 결과가 그대로여야 한다.
  const once = applyOps(start, [opA, opB]);
  const twice = applyOps(start, [opA, opB, opA, opB]);
  if (once !== twice) notIdempotent += 1;
}
eq('겹치지 않는 두 태그 명령은 순서를 타지 않는다', broken, 0);
eq('같은 태그 명령을 두 번 재생해도 결과가 같다', notIdempotent, 0);

// 규칙 자체도 한 번 못 박는다. 위의 성질들이 통째로 지나가도 이 셋은 눈에 띄어야 한다.
const change = applyTagChange(['t1', 't2'], ['t2', 't3'], ['t1', 't9']);
eq('이미 붙어 있는 것은 더하지 않는다', change.added.join(','), 't3');
eq('붙어 있지 않은 것은 떼지 않는다', change.removed.join(','), 't1');
eq('어느 쪽에도 없는 태그는 그대로 둔다', [...change.next].sort().join(','), 't2,t3');
eq('달라진 것이 없으면 changed 가 false',
  applyTagChange(['t1'], ['t1'], ['t9']).changed, false);

console.log(fail === 0 ? '\n전체 통과' : `\n실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
