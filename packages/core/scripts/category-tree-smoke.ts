/**
 * 검색 창의 분류 묶음. 서버도 데이터베이스도 필요 없다.
 *
 * 실행: cd packages/core && node -r ../api/node_modules/ts-node/register/transpile-only \
 *       scripts/category-tree-smoke.ts
 *
 * 눌러서 알기 어려운 것 둘을 못 박는다.
 *
 *   1. **숨긴 대분류의 소분류가 사라지지 않는가.** 부모를 찾지 못한 소분류를 빼 버리면
 *      거를 수 있는 분류가 화면에서 조용히 없어진다.
 *   2. **대분류를 고르면 그 소분류가 목록에서 빠지는가.** 대분류는 소분류를 함께 걸므로
 *      (서버 규칙) 둘을 같이 담으면 같은 것을 두 번 고른 셈이 된다.
 *   3. **소분류를 다 고르면 대분류로 접히는가.** 그 둘은 같은 뜻이라, 알약도 하나로
 *      모아야 무엇을 골랐는지 읽힌다.
 */
import {
  groupCategories,
  groupCategoriesByType,
  isCategoryPicked,
  toggleCategory,
} from '../src/lib/category-tree';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

/*
 * 서버가 주는 차례 그대로다. 순서(sortOrder)는 유형마다 0부터 매겨지므로 지출과 수입이
 * 번갈아 온다 -- 급여(수입 0) · 식비(지출 0) · 공과금(지출 1) · 상여금(수입 1).
 */
const rows = [
  { id: 'pay', name: '급여', parentId: null, type: 'income' },
  { id: 'food', name: '식비', parentId: null, type: 'expense' },
  { id: 'util', name: '공과금', parentId: null, type: 'expense' },
  { id: 'bonus', name: '상여금', parentId: null, type: 'income' },
  { id: 'food-out', name: '외식', parentId: 'food', type: 'expense' },
  { id: 'food-mart', name: '식료품', parentId: 'food', type: 'expense' },
  /*
   * 소분류 셋째. 둘만 두면 "하나를 켰다"와 "다 켰다"가 붙어 버려, 마지막 하나를 켤 때
   * 대분류로 접히는 규칙과 평소의 하나씩 담기를 갈라 볼 수 없다.
   */
  { id: 'food-cafe', name: '카페', parentId: 'food', type: 'expense' },
  // 숨긴 대분류(목록에 없다)의 소분류
  { id: 'gone-child', name: '지난 분류', parentId: 'gone', type: 'expense' },
] as never[];

const groups = groupCategories(rows);

// ── 1. 묶음의 모양 ──
eq('대분류 넷 + 이름 없는 묶음 하나', groups.length, 5);
eq('차례는 받은 목록 그대로',
  groups.map((group) => group.parent?.name ?? '(없음)').join(','), '급여,식비,공과금,상여금,(없음)');
eq('식비 아래 소분류 셋', groups[1].children.map((row) => row.name).join(','), '외식,식료품,카페');
eq('급여는 소분류가 없다', groups[0].children.length, 0);
eq('부모를 못 찾은 소분류도 남는다', groups[4].children.map((row) => row.id).join(','), 'gone-child');
eq('그 묶음은 이름이 없다', String(groups[4].parent), 'null');

// ── 1-2. 지출·수입 칸 ──
const sections = groupCategoriesByType(rows);
eq('칸 둘', sections.length, 2);
eq('지출이 앞', sections.map((section) => section.type).join(','), 'expense,income');
eq('지출 칸의 차례는 등록한 순서대로',
  sections[0].groups.map((group) => group.parent?.name ?? '(없음)').join(','),
  '식비,공과금,(없음)');
eq('수입 칸도 마찬가지',
  sections[1].groups.map((group) => group.parent?.name).join(','), '급여,상여금');
eq('한쪽만 있으면 그 칸만 선다',
  groupCategoriesByType(rows.filter((row: never) => (row as { type: string }).type === 'income'))
    .map((section) => section.type).join(','),
  'income');

// ── 2. 무리 안에서 누를 때 ──
const foodGroup = groups[1];
const food = foodGroup.parent!;
const [out, mart, cafe] = foodGroup.children;

eq('빈 상태에서 대분류를 고르면 그것 하나',
  toggleCategory([], food, foodGroup).join(','), 'food');
eq('골라 둔 소분류는 대분류에 흡수된다',
  toggleCategory(['food-out', 'food-mart', 'pay'], food, foodGroup).join(','), 'pay,food');
eq('다른 무리의 것은 그대로 남는다',
  toggleCategory(['pay'], food, foodGroup).join(','), 'pay,food');
eq('대분류를 다시 누르면 그 무리는 빈다',
  toggleCategory(['pay', 'food'], food, foodGroup).join(','), 'pay');
eq('소분류는 평소처럼 하나씩 담긴다',
  toggleCategory(['food-out'], mart, foodGroup).join(','), 'food-out,food-mart');
eq('켜 둔 소분류를 다시 누르면 빠진다',
  toggleCategory(['food-out', 'food-mart'], out, foodGroup).join(','), 'food-mart');

/*
 * 요점. 대분류가 켜진 채로 소분류 하나를 끄면, 대분류가 내려가고 나머지 소분류가 켜진다.
 * 대분류를 그대로 두면 뺀 소분류가 계속 걸려 아무 일도 하지 않은 것처럼 보인다.
 */
eq('대분류 켜진 채 소분류를 끄면 나머지만 남는다',
  toggleCategory(['pay', 'food'], out, foodGroup).join(','), 'pay,food-mart,food-cafe');
eq('그때 대분류는 목록에서 빠진다',
  toggleCategory(['food'], out, foodGroup).includes('food'), false);

/*
 * 그 되돌림. 소분류를 하나씩 켜다 마지막을 켜면 대분류를 누른 것과 같은 상태가 되므로,
 * 알약도 대분류 하나로 접는다. 다 골랐는데 대분류만 꺼져 있으면 고른 것을 알약에서
 * 읽을 수 없다.
 */
eq('마지막 소분류를 켜면 대분류로 접힌다',
  toggleCategory(['food-out', 'food-mart'], cafe, foodGroup).join(','), 'food');
eq('아직 남았으면 접지 않는다',
  toggleCategory(['food-out'], mart, foodGroup).join(','), 'food-out,food-mart');
eq('다른 무리의 것은 접으면서도 그대로 둔다',
  toggleCategory(['pay', 'food-out', 'food-mart'], cafe, foodGroup).join(','), 'pay,food');
eq('접은 뒤 하나를 끄면 나머지가 켜진다',
  toggleCategory(toggleCategory(['food-out', 'food-mart'], cafe, foodGroup), cafe, foodGroup)
    .join(','),
  'food-out,food-mart');

// ── 3. 켜져 보이는가 ──
eq('대분류를 켜면 소분류도 켜진 것으로 보인다',
  isCategoryPicked(['food'], out, foodGroup), true);
eq('그 대분류 자신도 켜져 보인다', isCategoryPicked(['food'], food, foodGroup), true);
eq('고르지 않은 소분류는 꺼져 보인다',
  isCategoryPicked(['food-mart'], out, foodGroup), false);
eq('고른 소분류는 켜져 보인다', isCategoryPicked(['food-out'], out, foodGroup), true);

console.log(fail === 0 ? '\n전체 통과' : `\n실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
