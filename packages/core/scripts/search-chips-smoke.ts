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
 *   3. **한쪽만 적은 기간이 그대로 서는가.** 시작일만 적으면 "그날부터 끝까지"다.
 *      잘못 적은 날짜(2월 31일)와 뒤집힌 구간만 서지 않아야 한다.
 */
import { NO_TAG } from '@money/types';

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

/**
 * 사전 대신 열쇠를 그대로 돌려준다. 어느 문구가 쓰였는지 검사에서 보인다.
 *
 * 자리(`{name}`)가 있는 문구만 실제 사전처럼 채운다 -- 통장 이름에 주인을 붙이는
 * 표기가 그 모양이라, 열쇠만 돌려주면 무엇이 붙었는지 볼 수 없다.
 */
const t = ((key: string, values?: Record<string, string | number>) =>
  key === 'tx.search.assetOwner' ? `${values?.name} · ${values?.owner}` : key) as never;

const categories = [
  { id: 'c-food', name: '외식', parentId: null },
  { id: 'c-lunch', name: '점심', parentId: 'c-food' },
] as never[];
const accounts = [{ id: 'a-bank', name: '보통예금', ownerId: 'p-me' }] as never[];
const cards = [{ id: 'k-shinhan', name: '신한 신용', paymentAccountId: 'a-bank' }] as never[];
const tags = [{ id: 'g-trip', name: '여행' }] as never[];
const people = [{ id: 'p-me', name: '김철수' }];

const chipsOf = (search: TransactionSearch) =>
  searchChipsOf(search, { t, categories, accounts, cards, tags, people });

/** 주인이 둘인 집. 통장 이름이 같아 주인 없이는 고를 수 없다. */
const twoOwnerAccounts = [
  { id: 'a-bank', name: '보통예금', ownerId: 'p-me' },
  { id: 'a-bank2', name: '보통예금', ownerId: 'p-spouse' },
] as never[];
const twoOwnerPeople = [
  { id: 'p-me', name: '김철수' },
  { id: 'p-spouse', name: '이영희' },
];
const twoOwnerChipsOf = (search: TransactionSearch) =>
  searchChipsOf(search, {
    t,
    categories,
    accounts: twoOwnerAccounts,
    cards,
    tags,
    people: twoOwnerPeople,
  });

const full: TransactionSearch = {
  ...EMPTY_SEARCH,
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

// ── 5. 한쪽만 적은 기간은 열린 구간으로 선다 ──
const fromOnly = chipsOf({ ...EMPTY_SEARCH, startDate: '2026-08-10' });
eq('시작일만 적어도 알약이 선다', fromOnly.length, 1);
eq('열린 쪽은 비워 둔다', fromOnly[0].label, '2026-08-10 ~');
const toOnly = chipsOf({ ...EMPTY_SEARCH, endDate: '2026-11-30' });
eq('종료일만 적어도 선다', toOnly.length, 1);
eq('그때는 앞이 비어 있다', toOnly[0].label, '~ 2026-11-30');

// 잘못 적은 것만 서지 않는다
eq('실재하지 않는 날짜',
  chipsOf({ ...EMPTY_SEARCH, startDate: '2026-02-31', endDate: '2026-03-01' }).length, 0);
eq('실재하지 않는 날짜 한 칸', chipsOf({ ...EMPTY_SEARCH, startDate: '2026-02-31' }).length, 0);
eq('앞뒤가 뒤집힌 구간',
  chipsOf({ ...EMPTY_SEARCH, startDate: '2026-11-30', endDate: '2026-08-10' }).length, 0);

// ── 6. 통장·카드의 주인 ──
eq('주인이 하나면 이름만 적는다',
  chipsOf({ ...EMPTY_SEARCH, paymentAccountIds: ['a-bank'] })[0].label, '보통예금');
eq('주인이 하나면 카드도 이름만',
  chipsOf({ ...EMPTY_SEARCH, paymentCardIds: ['k-shinhan'] })[0].label, '신한 신용');

eq('주인이 여럿이면 통장에 주인을 붙인다',
  twoOwnerChipsOf({ ...EMPTY_SEARCH, paymentAccountIds: ['a-bank2'] })[0].label,
  '보통예금 · 이영희');
eq('카드는 결제 통장의 주인을 따른다',
  twoOwnerChipsOf({ ...EMPTY_SEARCH, paymentCardIds: ['k-shinhan'] })[0].label,
  '신한 신용 · 김철수');
eq('이름을 못 찾는 id 는 무리 이름 그대로',
  twoOwnerChipsOf({ ...EMPTY_SEARCH, paymentAccountIds: ['a-gone'] })[0].label,
  'tx.search.accounts');

// ── 7. 태그 없음과 낸 사람 ──
const noTagChips = chipsOf({ ...EMPTY_SEARCH, tagIds: [NO_TAG] });
eq('"태그 없음"도 알약 하나', noTagChips.length, 1);
eq('그 알약의 이름은 사전에서', noTagChips[0].label, 'tx.search.noTag');
eq('그 알약만 빼면 태그 무리가 빈다',
  withoutChip({ ...EMPTY_SEARCH, tagIds: [NO_TAG, 'g-trip'] }, `tag:${NO_TAG}`).tagIds.join(','),
  'g-trip');

const personChips = chipsOf({ ...EMPTY_SEARCH, entryPersonIds: ['p-me'] });
eq('낸 사람도 알약 하나', personChips.length, 1);
eq('이름은 구성원 목록에서', personChips[0].label, '김철수');
eq('모르는 사람 id 는 무리 이름으로',
  chipsOf({ ...EMPTY_SEARCH, entryPersonIds: ['p-gone'] })[0].label, 'tx.search.people');
eq('사람만 빼면 나머지는 그대로',
  withoutChip({ ...full, entryPersonIds: ['p-me'] }, 'person:p-me').entryPersonIds.join(','), '');

// ── 8. 설명에서 찾는 글자 ──
const textChips = chipsOf({ ...EMPTY_SEARCH, text: '  스타벅스  ' });
eq('글자도 알약 하나', textChips.length, 1);
eq('앞뒤 공백을 털고 따옴표로 감싼다', textChips[0].label, '"스타벅스"');
eq('공백만 적은 것은 서지 않는다', chipsOf({ ...EMPTY_SEARCH, text: '   ' }).length, 0);
eq('글자만 빼면 나머지는 그대로',
  withoutChip({ ...full, text: '스타벅스' }, 'text').text, '');
eq('글자를 빼도 다른 조건은 남는다',
  chipsOf(withoutChip({ ...full, text: '스타벅스' }, 'text')).length, 7);

console.log(fail === 0 ? '\n전체 통과' : `\n실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
