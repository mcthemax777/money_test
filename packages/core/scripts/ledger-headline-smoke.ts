/*
 * 가계 첫 문장의 낱말과 금액.
 *
 * 실행: cd packages/core && npx tsx scripts/ledger-headline-smoke.ts
 *
 * 상자를 눌러 갈래를 끄고 켜면 금액만 바뀌는 것이 아니라 **낱말도 바뀐다.** 지출을 빼면
 * 남는 것이 수입이고, 수입을 빼면 지출이다. 그 규칙을 여기서 못박는다 -- 화면 둘(웹·앱)이
 * 같은 함수를 쓰므로 한쪽만 어긋날 일은 없지만, 규칙 자체가 조용히 바뀌는 것은 막아야 한다.
 */
import { ledgerHeadline, ledgerKindAmount, LEDGER_KIND_GROUPS } from '../src/lib/entries';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

/** 이 달 수입 300만, 지출 200만. 순수입은 100만이다. */
const totals = { incomeTotal: 3_000_000, expenseTotal: 2_000_000 };

const both = ledgerHeadline(['expense', 'income'], totals);
eq('둘 다 켜면 순수입', both.nounKey, 'ledgerSummary.net');
eq('그 금액은 수입 - 지출', both.amount, 1_000_000);

const incomeOnly = ledgerHeadline(['income'], totals);
eq('지출을 빼면 수입', incomeOnly.nounKey, 'tx.kind.income');
eq('그 금액은 수입', incomeOnly.amount, 3_000_000);

const expenseOnly = ledgerHeadline(['expense'], totals);
eq('지출만 켜면 지출', expenseOnly.nounKey, 'tx.kind.expense');
// 부호를 뒤집지 않는다. "지출은 -200만 원입니다"는 돈이 들어온 것처럼 읽힌다.
eq('그 금액은 지출액 그대로', expenseOnly.amount, 2_000_000);

const none = ledgerHeadline([], totals);
eq('둘 다 끄면 더할 것이 없다', none.amount, 0);
eq('낱말은 순수입으로 둔다', none.nounKey, 'ledgerSummary.net');

// 더 썼으면 순수입은 음수다. 화면이 그때만 빨강으로 적는다.
eq('더 쓴 달의 순수입은 음수',
  ledgerHeadline(['expense', 'income'], { incomeTotal: 1_000, expenseTotal: 5_000 }).amount,
  -4_000);

// 저장된 옛 키가 섞여 있어도 아는 것만 본다 (자산 유형 필터와 같은 규칙).
eq('모르는 키는 무시한다',
  ledgerHeadline(['income', 'transfer'], totals).nounKey, 'tx.kind.income');

// 상자에 적는 금액.
eq('상자는 둘', LEDGER_KIND_GROUPS.length, 2);
eq('지출 상자가 앞', LEDGER_KIND_GROUPS[0].key, 'expense');
eq('지출 상자의 금액', ledgerKindAmount('expense', totals), 2_000_000);
eq('수입 상자의 금액', ledgerKindAmount('income', totals), 3_000_000);

console.log(fail === 0 ? '\n전체 통과' : `\n실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
