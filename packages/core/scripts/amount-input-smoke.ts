/**
 * 금액 입력 글자를 서버로 보낼 금액으로 (`toAmountString`).
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/amount-input-smoke.ts
 *
 * 쉼표·전각 숫자를 받고, 덜 친 글자에서 죽지 않고, 큰 금액을 반올림하지 않는지 본다. 예전에는
 * Number 를 거쳐 66자리 금액이 "1e+65" 가 되었고, 그 값을 읽는 Dec 가 렌더 중에 던져 편집 화면이 죽었다.
 */
import { Dec } from '@money/types';
import { toAmountString } from '../src/lib/money';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${String(expected)}, 실제 ${String(actual)})`);
}

eq('쉼표', toAmountString('1,000'), '1000');
eq('전각 숫자와 쉼표', toAmountString('１，０００'), '1000');
eq('앞뒤 공백과 +', toAmountString(' +7 '), '7');
eq('앞자리 0', toAmountString('0010'), '10');
eq('덜 친 소수', toAmountString('.5'), '0.5');
eq('점으로 끝남', toAmountString('5.'), '5');
eq('빈 칸', toAmountString(''), '0');
eq('빼기만', toAmountString('-'), '0');
eq('점 둘', toAmountString('1.2.'), '0');
eq('20자리는 반올림하지 않는다', toAmountString('12345678901234567890'), '12345678901234567890');
eq('지수 꼴은 0', toAmountString('1e70'), '0');
// 무엇이 오든 Dec 가 읽을 수 있는 글자여야 한다 (렌더 중에 던지면 화면이 죽는다).
for (const input of ['9'.repeat(66), '9'.repeat(150), '1e70', '-', '.', '1.2.', 'abc']) {
  let readable = true;
  try {
    Dec.of(toAmountString(input));
  } catch {
    readable = false;
  }
  eq(`Dec 가 읽는다: ${input.slice(0, 12)}${input.length > 12 ? '…' : ''}`, readable, true);
}

console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
