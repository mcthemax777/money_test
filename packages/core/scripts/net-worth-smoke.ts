/**
 * 순자산 합치기·덜어 내기 검사 (2026-10-16).
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/net-worth-smoke.ts
 *
 * 금액을 double 로 더하면 소수가 있는 외화·투자 금액에서 끝자리가 어긋난다(0.1 + 0.2). 자산 탭의
 * 사람 고르기(`sumNetWorth`)와 합계 제외(`withoutAccounts`)가 십진으로 정확히 더하고 빼는지 본다.
 */
import type { ReportDto } from '@money/types';

import { sumNetWorth, withoutAccounts } from '../src/lib/net-worth';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

// ── 사람 고르기: 소수 금액을 정확히 더한다 ──
const joined = sumNetWorth([
  { cash: '0.1', investment: '1000.0001', liability: '-0.3', byType: { deposit: '0.1' }, byGroup: { cash: '0.1' } },
  { cash: '0.2', investment: '2000', liability: '0', byType: { deposit: '0.2', investment: '2000' }, byGroup: { cash: '0.2' } },
  undefined,
]);
eq('현금성 0.1 + 0.2', joined.cash, '0.3');
eq('투자 (뒤의 0 을 뗀다)', joined.investment, '3000.0001');
eq('총액', joined.total, '3000.0001');
eq('유형별 소계', joined.byType.deposit, '0.3');
eq('묶음별 소계', joined.byGroup?.cash, '0.3');
eq('부채', joined.liability, '-0.3');

// 묶음별 소계가 없는 옛 응답이 섞이면 비운다 (반쪽 합 방지)
eq('옛 응답이 섞이면 묶음별 소계를 비운다',
  sumNetWorth([{ cash: '1', investment: '0', liability: '0', byType: {} }, { cash: '1', investment: '0', liability: '0', byType: {}, byGroup: {} }]).byGroup,
  undefined);
eq('아무도 없으면 0', sumNetWorth([]).total, '0');

// ── 합계 제외: 정확히 덜어 내고 0 이 된 칸은 뺀다 ──
const netWorth = {
  total: '1000.3',
  cash: '0.3',
  investment: '1000',
  liability: '0',
  byType: { deposit: '0.3', investment: '1000' },
  byGroup: { cash: '0.3', investment: '1000' },
  byPerson: [
    { personId: 'p1', total: '0.3', cash: '0.3', investment: '0', liability: '0', byType: { deposit: '0.3' }, byGroup: { cash: '0.3' } },
  ],
  byAccount: [
    { accountId: 'a1', ownerId: 'p1', type: 'deposit', group: 'cash', amount: '0.1' },
    { accountId: 'a2', ownerId: 'p1', type: 'deposit', group: 'cash', amount: '0.2' },
    { accountId: 's1', ownerId: null, type: 'investment', group: 'investment', amount: '1000' },
  ],
} as unknown as ReportDto.NetWorth;

const minusOne = withoutAccounts(netWorth, new Set(['a1']));
eq('한 계좌를 빼면 0.3 - 0.1', minusOne?.cash, '0.2');
eq('총액도 함께', minusOne?.total, '1000.2');
eq('그 사람 소계도 함께', minusOne?.byPerson[0].cash, '0.2');

const minusBoth = withoutAccounts(netWorth, new Set(['a1', 'a2']));
eq('둘 다 빼면 정확히 0', minusBoth?.cash, '0');
eq('0 이 된 유형은 표에서 빠진다', 'deposit' in (minusBoth?.byType ?? {}), false);
eq('0 이 된 묶음도 빠진다', 'cash' in (minusBoth?.byGroup ?? {}), false);

console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
