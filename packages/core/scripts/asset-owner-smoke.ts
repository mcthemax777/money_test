/**
 * 검색 창의 통장·카드 묶음과 차례. 서버도 데이터베이스도 필요 없다.
 *
 * 실행: cd packages/core && node -r ../api/node_modules/ts-node/register/transpile-only \
 *       scripts/asset-owner-smoke.ts
 *
 * 눌러서 알기 어려운 것 셋을 못 박는다.
 *
 *   1. **카드의 주인은 결제 통장에서 온다.** 카드 자신에는 주인이 없다.
 *   2. **주인이 하나뿐이면 이름을 적지 않는다.** 모든 줄에 같은 이름이 붙으면 고르는 데
 *      도움이 되지 않는다.
 *   3. **카드는 결제 통장의 차례를 따른다.** 서버가 주는 카드 순서는 통장을 보지 않아
 *      자산 화면과 차례가 어긋난다.
 */
import type { AccountDto, CardDto } from '@money/types';

import {
  assetOwnerNames,
  groupByOwner,
  hasSeveralOwners,
  sortCardsByAccount,
} from '../src/lib/asset-owner';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

/** 자산 화면의 차례 그대로다 (통장은 주인별 sortOrder). */
const accounts = [
  { id: 'a-mine-1', name: '국민은행 통장', ownerId: 'p-me' },
  { id: 'a-mine-2', name: '하나은행 통장', ownerId: 'p-me' },
  { id: 'a-spouse', name: '보민계좌', ownerId: 'p-spouse' },
];

/** 서버가 주는 카드 차례. 통장이 뒤섞여 있다. */
const cards = [
  { id: 'k-hana', name: '하나 신용', paymentAccountId: 'a-mine-2' },
  { id: 'k-kb-1', name: 'KB 체크', paymentAccountId: 'a-mine-1' },
  { id: 'k-kb-2', name: 'KB 신용', paymentAccountId: 'a-mine-1' },
  { id: 'k-gone', name: '지난 카드', paymentAccountId: 'a-gone' },
];

const people = [
  { id: 'p-me', name: '김용찬' },
  { id: 'p-spouse', name: '강보민' },
];

/*
 * 표본은 이 검사가 보는 칸만 담는다. 통장·카드의 DTO 를 통째로 적으면 무엇이 답에
 * 관여하는지 묻혀 버린다. 그래서 **함수를 부르는 자리에서만** 넓힌다 -- 배열 자체를
 * `never[]` 로 두면 묶음의 원소까지 never 가 되어 `.name` 을 읽을 수 없다.
 */
const asAccounts = (rows: typeof accounts) => rows as unknown as AccountDto.Response[];
const asCards = (rows: typeof cards) => rows as unknown as CardDto.Response[];

// ── 1. 주인 찾기 ──
const owners = assetOwnerNames(asAccounts(accounts), asCards(cards), people);
eq('통장의 주인', owners.get('a-mine-1'), '김용찬');
eq('카드는 결제 통장의 주인을 따른다', owners.get('k-kb-1'), '김용찬');
eq('다른 사람의 통장', owners.get('a-spouse'), '강보민');
eq('통장을 못 찾은 카드는 주인이 없다', String(owners.get('k-gone')), 'undefined');

eq('주인이 여럿이면 이름을 적는다', hasSeveralOwners(owners), true);
eq('주인이 하나면 적지 않는다',
  hasSeveralOwners(assetOwnerNames(asAccounts([accounts[0]]), [], people)), false);

// ── 2. 주인별 묶음 ──
const groups = groupByOwner(accounts, owners);
eq('묶음 둘', groups.length, 2);
eq('차례를 주지 않으면 목록에 나온 순',
  groups.map((group) => group.ownerName).join(','), '김용찬,강보민');
eq('구성원 차례를 주면 그것을 따른다',
  groupByOwner(accounts, owners, ['강보민', '김용찬'])
    .map((group) => group.ownerName)
    .join(','),
  '강보민,김용찬');
eq('목록에 없는 이름은 뒤로',
  groupByOwner(accounts, owners, ['강보민'])
    .map((group) => group.ownerName)
    .join(','),
  '강보민,김용찬');
eq('묶음 안의 차례도 그대로',
  groups[0].items.map((row) => row.name).join(','), '국민은행 통장,하나은행 통장');

const cardGroups = groupByOwner(cards, owners, ['강보민', '김용찬']);
eq('주인을 모르는 카드는 차례와 상관없이 맨 뒤',
  cardGroups[cardGroups.length - 1].ownerName, String(null));

// ── 3. 카드의 차례 ──
eq('카드는 결제 통장의 차례를 따른다',
  sortCardsByAccount(asCards(cards), asAccounts(accounts)).map((card) => card.name).join(','),
  'KB 체크,KB 신용,하나 신용,지난 카드');
eq('같은 통장 안에서는 받은 차례 그대로',
  sortCardsByAccount(asCards(cards), asAccounts(accounts))
    .filter((card) => card.paymentAccountId === 'a-mine-1')
    .map((card) => card.id)
    .join(','),
  'k-kb-1,k-kb-2');
eq('원래 배열은 건드리지 않는다', cards[0].name, '하나 신용');

console.log(fail === 0 ? '\n전체 통과' : `\n실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
