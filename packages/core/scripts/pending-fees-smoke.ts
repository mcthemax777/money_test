/**
 * 밀린 할부 수수료를 거래별로 묶는 규칙.
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/pending-fees-smoke.ts
 *
 * 묶지 않으면 밀린 회차가 결제일 순으로 섞여 선다. 할부가 둘만 되어도 "냉장고 2회차,
 * 자동차 5회차, 냉장고 3회차"처럼 늘어서, 어느 줄이 어느 결제의 것인지 화면에서 가릴 수
 * 없다. 설명 없이 적은 거래가 섞이면 더 그렇다 -- 이름 자리가 통째로 빈다.
 *
 * 서버 쪽 짝은 `api/scripts/installment-fee-smoke.ts` 다 (분류 이름이 함께 오는지).
 */
import type { CardDto } from '@money/types';

import { groupPendingFeesByEntry, pendingFeeTitle } from '../src/lib/pending-fees';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

/** 밀린 회차 하나. 화면이 읽는 자리만 채운다. */
const item = (over: Partial<CardDto.PendingFeeItem>): CardDto.PendingFeeItem => ({
  planId: 'plan-1',
  sequence: 1,
  months: 3,
  entryId: 'e-1',
  description: '냉장고',
  merchant: null,
  categoryName: '가전',
  purchaseDate: '2026-07-20T03:00:00.000Z',
  closingMonth: '2026-08',
  dueDate: '2026-08-14T00:00:00.000Z',
  principal: '33334',
  ...over,
});

// ── 거래별로 묶는다 ──
//
// 서버는 결제일 순으로 준다. 그대로 그리면 두 거래의 회차가 번갈아 선다.
const mixed = [
  item({ planId: 'plan-1', sequence: 1, dueDate: '2026-08-14T00:00:00.000Z' }),
  item({
    planId: 'plan-2', entryId: 'e-2', description: '자동차', months: 24, sequence: 4,
    dueDate: '2026-08-14T00:00:00.000Z', principal: '100000',
  }),
  item({ planId: 'plan-1', sequence: 2, dueDate: '2026-09-14T00:00:00.000Z' }),
  item({
    planId: 'plan-2', entryId: 'e-2', description: '자동차', months: 24, sequence: 5,
    dueDate: '2026-09-14T00:00:00.000Z', principal: '100000',
  }),
];

const groups = groupPendingFeesByEntry(mixed);
eq('거래 수만큼 묶인다', groups.length, 2);
eq('한 거래의 회차가 한 묶음에', groups.map((group) => group.items.length).join(','), '2,2');
eq('회차는 차례대로', groups[0].items.map((row) => row.sequence).join(','), '1,2');
eq('가장 오래 밀린 거래가 앞', groups[0].description, '냉장고');

// ── 이름 ──
//
// 설명을 적지 않고 지나가는 일이 흔하다. 그 자리를 가맹점과 분류가 차례로 메운다.
eq('설명이 있으면 설명', pendingFeeTitle(item({})), '냉장고');
eq(
  '설명이 비면 가맹점',
  pendingFeeTitle(item({ description: '', merchant: '하이마트' })),
  '하이마트',
);
eq('둘 다 비면 분류', pendingFeeTitle(item({ description: '', merchant: null })), '가전');
eq(
  '셋 다 없으면 빈 글자 (화면이 "(내용 없음)"을 세운다)',
  pendingFeeTitle(item({ description: '', merchant: null, categoryName: null })),
  '',
);
eq(
  '묶음에도 그 이름이 실린다',
  groupPendingFeesByEntry([item({ description: '  ', merchant: null })])[0].title,
  '가전',
);

console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
