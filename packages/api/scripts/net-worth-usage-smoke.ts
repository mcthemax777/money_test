/**
 * 순자산과 예산 사용액 규칙 검사. 데이터베이스에 닿지 않는다.
 *
 * 실행: cd packages/api && npx ts-node scripts/net-worth-usage-smoke.ts
 *
 * 홈 화면이 이 두 값을 쓴다. 기기가 오프라인에서 같은 값을 내야 하므로 서버를
 * 거치지 않는 경로도 지켜져야 한다. 특히 다음을 콕 집어 본다.
 *
 *   1. 계좌 유형이 어느 칸에 드는지 (외화라는 이유로 칸이 바뀌지 않는다)
 *   2. 두 환율을 섞지 않는 것 (계좌 통화 -> 표시, 저장 통화 -> 표시)
 *   3. 시가가 없는 투자 계좌가 0원이 되지 않는 것
 *   4. 대분류 사용액이 소분류를 롤업하되 두 번 세지 않는 것
 */
import {
  type CategoryNode,
  type CategoryPostingRow,
  type NetWorthAccountRow,
  categoryUsage,
  isBudgetApplicable,
  netWorth,
  slotOf,
  totalUsage,
} from '@money/types';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

// ── 칸 나누기 ──
eq('예금은 현금성', slotOf('deposit'), 'cash');
eq('현금도 현금성', slotOf('cash'), 'cash');
eq('저축은 현금성', slotOf('savings'), 'cash');
eq('투자는 투자', slotOf('investment'), 'investment');
eq('부동산도 투자', slotOf('real_estate'), 'investment');
eq('신용카드 사용액은 부채', slotOf('credit_card'), 'liability');
eq('대출도 부채', slotOf('loan'), 'liability');

// ── 원화 프로젝트, 원화로 보기 ──
const won = { ledgerCurrency: 'KRW', displayCurrency: 'KRW', toDisplay: { KRW: '1' }, ledgerToDisplay: '1' };

const basic: NetWorthAccountRow[] = [
  { id: 'a1', type: 'deposit', currency: 'KRW', balance: '1000000', ownerId: 'p1', ownerName: '김철수' },
  { id: 'a2', type: 'savings', currency: 'KRW', balance: '500000', ownerId: 'p2', ownerName: '이영희' },
  { id: 'a3', type: 'credit_card', currency: 'KRW', balance: '-50000', ownerId: 'p1', ownerName: '김철수' },
  // 자본 계정이 섞여 와도 빠진다 (기초잔액이 두 번 세어지면 안 된다)
  { id: 'a4', type: 'opening_balance', currency: 'KRW', balance: '-1500000', ownerId: null, ownerName: null },
];

const plain = netWorth(basic, won);
eq('현금성 (예금 + 저축)', plain.cash.toString(), '1500000');
eq('부채', plain.liability.toString(), '-50000');
eq('총자산 = 현금성 + 투자 + 부채', plain.total.toString(), '1450000');
eq('자본 계정은 빠진다', plain.byType.has('opening_balance'), false);
eq('유형별 소계: 예금', plain.byType.get('deposit')?.toString(), '1000000');
eq('사람 수', plain.byPerson.length, 2);
const chulsoo = plain.byPerson.find((p) => p.personId === 'p1');
eq('김철수 소계 (100만 - 5만)', chulsoo?.total.toString(), '950000');
eq('주인 없는 계좌는 사람 소계에 들지 않는다',
  plain.byPerson.reduce((sum, p) => sum + Number(p.total), 0), 1450000);
eq('빈 목록', netWorth([], won).total.toString(), '0');

// ── 투자 계좌: 시가와 장부가 ──
const invested = netWorth(
  [
    { id: 'i1', type: 'investment', currency: 'KRW', balance: '500000', bookValue: '500000',
      marketValue: '800000', ownerId: 'p1', ownerName: '김철수' },
  ],
  won,
);
eq('투자 평가액은 시가', invested.investment.toString(), '800000');
eq('미실현손익 = 시가 - 장부가', invested.unrealizedGain.toString(), '300000');

const noValuation = netWorth(
  [
    { id: 'i2', type: 'investment', currency: 'KRW', balance: '500000', bookValue: '500000',
      marketValue: null, ownerId: 'p1', ownerName: '김철수' },
  ],
  won,
);
eq('시가가 없으면 장부 잔액으로 대체한다 (0원이 되지 않는다)',
  noValuation.investment.toString(), '500000');
eq('그때 미실현손익은 0', noValuation.unrealizedGain.toString(), '0');

// ── 외화 계좌 ──
// 달러 통장 $1,000. 지금 환율 1,400원. 장부가는 거래 시점 환율로 130만원이 쌓여 있다.
const foreign = netWorth(
  [
    { id: 'f1', type: 'deposit', currency: 'USD', balance: '1000', bookValue: '1300000',
      ownerId: 'p1', ownerName: '김철수' },
  ],
  { ledgerCurrency: 'KRW', displayCurrency: 'KRW', toDisplay: { USD: '1400' }, ledgerToDisplay: '1' },
);
eq('외화 잔액은 지금 환율로 환산', foreign.cash.toString(), '1400000');
eq('달러 통장도 현금성이다 (외화라고 칸이 바뀌지 않는다)',
  foreign.byType.get('deposit')?.toString(), '1400000');
eq('미실현 환차익 = 재평가액 - 장부가', foreign.unrealizedGain.toString(), '100000');

// ── 표시 통화가 다른 경우 ──
// 저장은 원화, 보기는 달러(1원 = 0.0007달러). 소수 2자리로 반올림한다.
const inUsd = netWorth(
  [
    { id: 'a1', type: 'deposit', currency: 'KRW', balance: '1000000', ownerId: 'p1', ownerName: '김철수' },
    { id: 'i1', type: 'investment', currency: 'KRW', balance: '500000', bookValue: '500000',
      marketValue: '800000', ownerId: 'p1', ownerName: '김철수' },
  ],
  { ledgerCurrency: 'KRW', displayCurrency: 'USD', toDisplay: { KRW: '0.0007' }, ledgerToDisplay: '0.0007' },
);
eq('표시 통화로 환산하고 그 통화 자릿수로 반올림', inUsd.cash.toString(), '700');
eq('시가도 저장 통화 환율로 환산', inUsd.investment.toString(), '560');
eq('장부가도 같은 환율을 쓴다', inUsd.unrealizedGain.toString(), '210');

// ── 예산 사용액 ──
const categories: CategoryNode[] = [
  { id: 'c-dining', type: 'expense', parentId: null },
  { id: 'c-lunch', type: 'expense', parentId: 'c-dining' },
  { id: 'c-cafe', type: 'expense', parentId: 'c-dining' },
  { id: 'c-utility', type: 'expense', parentId: null },
  { id: 'c-salary', type: 'income', parentId: null },
];

const row = (categoryId: string, amount: string, extra = '0', type: 'expense' | 'income' = 'expense'): CategoryPostingRow => ({
  categoryId,
  categoryType: type,
  baseAmount: type === 'income' ? `-${amount}` : amount,
  extraAmount: extra,
  normalAmount: String(Number(amount) - Number(extra)),
  date: '2026-08-05T03:00:00.000Z',
});

const postings = [
  row('c-lunch', '50000'),
  row('c-cafe', '10000', '10000'),
  row('c-dining', '30000'),
  row('c-utility', '200000'),
  row('c-salary', '3000000', '0', 'income'),
];

const usage = categoryUsage(postings, categories);
eq('소분류 사용액', usage.get('c-lunch')?.amount.toString(), '50000');
eq('대분류 사용액 = 자신 + 소분류', usage.get('c-dining')?.amount.toString(), '90000');
eq('대분류 건수도 함께 센다', usage.get('c-dining')?.count, 3);
eq('수입 다리도 크기로 센다', usage.get('c-salary')?.amount.toString(), '3000000');
eq('거래가 없는 카테고리는 0', usage.get('c-utility')?.amount.toString(), '200000');

eq('전체 지출 = 대분류만 더한다 (소분류를 두 번 세지 않는다)',
  totalUsage(usage, categories, 'expense').toString(), '290000');
eq('전체 수입', totalUsage(usage, categories, 'income').toString(), '3000000');

const extraUsage = categoryUsage(postings, categories, true);
eq('과소비만: 대분류 사용액', extraUsage.get('c-dining')?.amount.toString(), '10000');
eq('과소비만: 셀 몫이 없는 다리는 건수에서도 빠진다', extraUsage.get('c-dining')?.count, 1);
eq('과소비만: 전체 지출', totalUsage(extraUsage, categories, 'expense').toString(), '10000');

const normalUsage = categoryUsage(postings, categories, false);
eq('일반만 + 과소비만 = 전체',
  normalUsage.get('c-dining')!.amount.plus(extraUsage.get('c-dining')!.amount).toString(),
  usage.get('c-dining')!.amount.toString());

// 목록에 없는 카테고리의 다리는 세지 않는다 (다른 프로젝트나 지워진 분류)
eq('모르는 카테고리는 무시', categoryUsage([row('c-unknown', '9999')], categories).get('c-unknown'), undefined);

// ── 예산 적용 기간 ──
eq('기간이 비어 있으면 항상 적용', isBudgetApplicable({}, '2026-08'), true);
eq('시작 달 포함', isBudgetApplicable({ effectiveFrom: '2026-08' }, '2026-08'), true);
eq('시작 전은 제외', isBudgetApplicable({ effectiveFrom: '2026-09' }, '2026-08'), false);
eq('끝 달 포함', isBudgetApplicable({ effectiveTo: '2026-08' }, '2026-08'), true);
eq('끝 뒤는 제외', isBudgetApplicable({ effectiveTo: '2026-07' }, '2026-08'), false);
eq('양쪽이 있는 구간', isBudgetApplicable({ effectiveFrom: '2026-01', effectiveTo: '2026-12' }, '2026-08'), true);
eq('해가 다르면 문자열 비교로도 맞다',
  isBudgetApplicable({ effectiveFrom: '2025-12' }, '2026-01'), true);

console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
