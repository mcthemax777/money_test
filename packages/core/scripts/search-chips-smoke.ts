/**
 * 거래 화면의 검색 조건 알약. 서버도 데이터베이스도 필요 없다.
 *
 * 실행: cd packages/core && node -r ../api/node_modules/ts-node/register/transpile-only \
 *       scripts/search-chips-smoke.ts
 *
 * 화면에서 눌러 보면 금방 알 수 있는 종류의 코드이지만, 세 가지는 눌러서 알기 어렵다.
 *
 *   1. **하나를 빼면 나머지가 그대로 남는가.** 알약 하나를 눌렀는데 다른 조건까지
 *      풀리면 사용자는 목록이 왜 늘었는지 알 수 없다.
 *   2. **이름을 못 찾는 조건을 감추지 않는가.** 프로젝트를 옮기면 지난 프로젝트의
 *      분류 id 가 검색에 남는다. 감추면 거르고 있는데 보이지 않는 조건이 된다.
 *   3. **반쪽 기간은 서지 않는가.** 날짜를 한 칸만 적은 상태는 사용자가 고른 구간이
 *      아니라 적다 만 것이라, 알약으로 굳으면 안 된다.
 */
import {
  EMPTY_SEARCH,
  searchChipsOf,
  withoutChip,
  type TransactionSearch,
} from '../src/hooks/useTransactions';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

/** 사전 대신 열쇠를 그대로 돌려준다. 어느 문구가 쓰였는지 검사에서 보인다. */
const t = ((key: string) => key) as never;

const categories = [
  { id: 'c-food', name: '외식', parentId: null },
  { id: 'c-lunch', name: '점심', parentId: 'c-food' },
] as never[];
const accounts = [{ id: 'a-bank', name: '보통예금' }] as never[];
const cards = [{ id: 'k-shinhan', name: '신한 신용' }] as never[];

const chipsOf = (search: TransactionSearch) =>
  searchChipsOf(search, { t, categories, accounts, cards });

const full: TransactionSearch = {
  categoryIds: ['c-food', 'c-lunch'],
  paymentAccountIds: ['a-bank'],
  paymentCardIds: ['k-shinhan'],
  kinds: ['expense', 'transfer'],
  startDate: '2026-08-10',
  endDate: '2026-11-30',
};

// ── 1. 조건마다 알약 하나, 검색 창과 같은 차례로 ──
const chips = chipsOf(full);
eq('조건마다 알약 하나', chips.length, 7);
eq('차례는 기간·유형·분류·계좌·카드',
  chips.map((chip) => chip.id).join(','),
  'period,kind:expense,kind:transfer,category:c-food,category:c-lunch,account:a-bank,card:k-shinhan');
eq('기간은 양끝을 함께 적는다', chips[0].label, '2026-08-10 ~ 2026-11-30');
eq('유형은 사전에서 꺼낸다', chips[1].label, 'tx.kind.expense');
eq('대분류는 이름만', chips[3].label, '외식');
eq('소분류는 대분류를 앞에 적는다', chips[4].label, '외식 > 점심');
eq('계좌 이름', chips[5].label, '보통예금');
eq('카드 이름', chips[6].label, '신한 신용');

// ── 2. 이름을 못 찾아도 감추지 않는다 ──
const strayChips = chipsOf({ ...EMPTY_SEARCH, categoryIds: ['c-gone'] });
eq('모르는 id 도 알약이 선다', strayChips.length, 1);
eq('그때는 무리 이름으로 적는다', strayChips[0].label, 'tx.search.categories');

// ── 3. 하나를 빼면 그것만 빠진다 ──
const withoutLunch = withoutChip(full, 'category:c-lunch');
eq('고른 분류에서 그것만 빠진다', withoutLunch.categoryIds.join(','), 'c-food');
eq('다른 무리는 그대로', withoutLunch.paymentCardIds.join(','), 'k-shinhan');
eq('기간도 그대로', `${withoutLunch.startDate}~${withoutLunch.endDate}`, '2026-08-10~2026-11-30');

const withoutTransfer = withoutChip(full, 'kind:transfer');
eq('유형도 하나씩 빠진다', withoutTransfer.kinds.join(','), 'expense');

const withoutPeriod = withoutChip(full, 'period');
eq('기간은 두 칸이 함께 빠진다', `${withoutPeriod.startDate}|${withoutPeriod.endDate}`, '|');
eq('기간을 빼도 나머지는 그대로', chipsOf(withoutPeriod).length, 6);

// 하나씩 다 빼면 아무 조건도 남지 않는다
let left: TransactionSearch = full;
for (const chip of chips) left = withoutChip(left, chip.id);
eq('전부 빼면 알약이 없다', chipsOf(left).length, 0);

// ── 4. 모르는 열쇠는 그대로 둔다 ──
eq('모르는 열쇠는 손대지 않는다', chipsOf(withoutChip(full, 'nope:1')).length, 7);
eq('무리 이름이 없는 열쇠도 마찬가지', chipsOf(withoutChip(full, 'period-ish')).length, 7);

// ── 5. 반쪽 기간은 알약이 서지 않는다 ──
eq('시작일만 적은 상태', chipsOf({ ...EMPTY_SEARCH, startDate: '2026-08-10' }).length, 0);
eq('실재하지 않는 날짜',
  chipsOf({ ...EMPTY_SEARCH, startDate: '2026-02-31', endDate: '2026-03-01' }).length, 0);
eq('앞뒤가 뒤집힌 구간',
  chipsOf({ ...EMPTY_SEARCH, startDate: '2026-11-30', endDate: '2026-08-10' }).length, 0);

console.log(fail === 0 ? '\n전체 통과' : `\n실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
