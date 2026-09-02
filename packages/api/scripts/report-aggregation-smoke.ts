/**
 * 리포트 집계 규칙 검사. 데이터베이스에 닿지 않는다.
 *
 * 실행: cd packages/api && npx ts-node scripts/report-aggregation-smoke.ts
 *
 * `reports-smoke` 는 이 규칙이 서버 응답에서 맞는지 본다. 여기서 보는 것은 규칙
 * 자체다. 기기가 오프라인에서 이 함수를 직접 부르므로, 서버를 거치지 않는 경로도
 * 지켜져야 한다. 특히 세 가지를 콕 집어 본다.
 *
 *   1. 한 다리가 일반과 과소비로 나뉘는 셈 (다리를 걸러내면 돈이 사라진다)
 *   2. 달력 경계를 프로젝트 타임존으로 자르는 것 (UTC로 자르면 새벽 거래가 밀린다)
 *   3. 롤업한 칸의 이름과 부모 정보
 */
import {
  type NamedCategoryPostingRow,
  categoryBreakdown,
  dailyTotals,
  monthlyTotals,
  shiftYearMonth,
  summarize,
} from '@money/types';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

const KST = 'Asia/Seoul';

/** 지출 다리 하나. 과소비 몫을 주면 나머지가 일반 몫이 된다. */
const expense = (
  amount: string,
  date: string,
  extra = '0',
  categoryId = 'c-food',
): NamedCategoryPostingRow => ({
  categoryId,
  categoryType: 'expense',
  categoryName: '식비',
  parentCategoryId: null,
  parentCategoryName: null,
  baseAmount: amount,
  extraAmount: extra,
  normalAmount: String(Number(amount) - Number(extra)),
  date,
});

/** 수입 다리. 환산액이 음수라는 점이 지출과 다르다. */
const income = (amount: string, date: string, extra = '0'): NamedCategoryPostingRow => ({
  categoryId: 'c-salary',
  categoryType: 'income',
  categoryName: '급여',
  parentCategoryId: null,
  parentCategoryName: null,
  baseAmount: `-${amount}`,
  extraAmount: extra,
  normalAmount: String(Number(amount) - Number(extra)),
  date,
});

// ── 합계 ──
const rows = [
  expense('30000', '2026-08-05T03:00:00.000Z'),
  expense('50000', '2026-08-06T03:00:00.000Z', '20000'),
  income('3000000', '2026-08-25T03:00:00.000Z'),
];

const all = summarize(rows);
eq('지출 합계 (수입 다리가 섞이지 않는다)', all.expense.toString(), '80000');
eq('수입 합계 (음수 환산액을 크기로 센다)', all.income.toString(), '3000000');
eq('과소비 지출', all.extraExpense.toString(), '20000');
eq('일반 지출', all.normalExpense.toString(), '60000');
eq('두 몫의 합 = 지출 합계',
  all.extraExpense.plus(all.normalExpense).toString(), all.expense.toString());
eq('순액', all.net.toString(), '2920000');

const onlyExtra = summarize(rows, true);
eq('과소비만 볼 때 지출은 과소비 몫', onlyExtra.expense.toString(), '20000');
eq('과소비만 볼 때 일반 몫은 0으로 적는다', onlyExtra.normalExpense.toString(), '0');

const onlyNormal = summarize(rows, false);
eq('일반만 볼 때 지출은 일반 몫', onlyNormal.expense.toString(), '60000');
eq('일반만 볼 때 과소비 몫은 0으로 적는다', onlyNormal.extraExpense.toString(), '0');
eq('부분 과소비 거래의 나머지가 사라지지 않는다',
  onlyExtra.expense.plus(onlyNormal.expense).toString(), all.expense.toString());

eq('빈 목록의 합계는 0', summarize([]).expense.toString(), '0');

// ── 날짜별 ──
// 한국 시간 8월 6일 00:30 은 UTC 로 8월 5일 15:30 이다. UTC 로 자르면 5일로 밀린다.
const dawn = expense('10000', '2026-08-05T15:30:00.000Z');
const days = dailyTotals([...rows, dawn], { timeZone: KST, type: 'expense' });
eq('날짜 수', days.length, 2);
eq('첫 날', days[0]?.date, '2026-08-05');
eq('새벽 거래가 다음 날로 넘어가지 않는다', days[1]?.date, '2026-08-06');
eq('8/6 합계 (50000 + 10000)',
  days[1]?.normal.plus(days[1].extra).toString(), '60000');
eq('8/6 과소비 몫', days[1]?.extra.toString(), '20000');
eq('수입만 보면 그 날짜만 남는다',
  dailyTotals(rows, { timeZone: KST, type: 'income' }).length, 1);

const utcDays = dailyTotals([dawn], { timeZone: 'UTC', type: 'expense' });
eq('타임존을 바꾸면 날짜가 달라진다 (UTC 기준)', utcDays[0]?.date, '2026-08-05');

// ── 구성비 ──
const dining: NamedCategoryPostingRow = {
  ...expense('40000', '2026-08-07T03:00:00.000Z', '0', 'c-lunch'),
  categoryName: '점심',
  parentCategoryId: 'c-dining',
  parentCategoryName: '외식',
};
const breakdownRows = [rows[0], rows[1], dining];

const rolled = categoryBreakdown(breakdownRows, { type: 'expense' });
eq('롤업하면 칸이 둘', rolled.length, 2);
eq('금액 큰 순', rolled[0]?.categoryName, '식비');
eq('식비 금액 (30000 + 50000)', rolled[0]?.amount.toString(), '80000');
eq('롤업한 칸 이름은 대분류 이름', rolled[1]?.categoryName, '외식');
eq('롤업한 칸의 id 는 대분류 id', rolled[1]?.categoryId, 'c-dining');
eq('롤업한 칸에는 부모가 없다', String(rolled[1]?.parentCategoryId), 'null');
eq('건수', rolled[0]?.count, 2);
eq('구성비 합 = 100', Math.round(rolled.reduce((sum, r) => sum + r.ratio, 0)), 100);

const flat = categoryBreakdown(breakdownRows, { type: 'expense', rollup: false });
eq('롤업하지 않으면 소분류가 따로 선다', flat.length, 2);
eq('소분류 칸은 부모를 들고 있다', flat.find((r) => r.categoryId === 'c-lunch')?.parentCategoryName, '외식');

const extraBreakdown = categoryBreakdown(breakdownRows, { type: 'expense', extra: true });
eq('과소비만: 셀 몫이 없는 칸은 빠진다', extraBreakdown.length, 1);
eq('과소비만: 금액', extraBreakdown[0]?.amount.toString(), '20000');
eq('과소비만: 건수도 그 다리만 센다 ("0원인데 3건"이 되지 않는다)', extraBreakdown[0]?.count, 1);
eq('빈 목록의 구성비', categoryBreakdown([], { type: 'expense' }).length, 0);

// ── 월별 ──
const trendRows = [
  expense('90000', '2026-08-07T03:00:00.000Z'),
  expense('40000', '2026-07-10T03:00:00.000Z'),
];
const months = monthlyTotals(trendRows, { timeZone: KST, endYearMonth: '2026-08', months: 3 });
eq('달 수', months.length, 3);
eq('마지막 달', months[2]?.yearMonth, '2026-08');
eq('8월 합계', months[2]?.amount.toString(), '90000');
eq('7월 합계', months[1]?.amount.toString(), '40000');
eq('거래 없는 달은 0으로 채운다', months[0]?.amount.toString(), '0');
eq('6월이 맨 앞', months[0]?.yearMonth, '2026-06');

// 한국 시간 8월 1일 00:30 = UTC 7월 31일 15:30. 달 경계도 타임존을 따른다.
const monthEdge = [expense('7000', '2026-07-31T15:30:00.000Z')];
eq('달 경계가 타임존을 따른다 (KST 8월)',
  monthlyTotals(monthEdge, { timeZone: KST, endYearMonth: '2026-08', months: 1 })[0]?.amount.toString(),
  '7000');
eq('UTC 로 보면 7월에 들어간다',
  monthlyTotals(monthEdge, { timeZone: 'UTC', endYearMonth: '2026-08', months: 1 })[0]?.amount.toString(),
  '0');

// ── 달 이동 ──
eq('연 경계를 넘는다', shiftYearMonth(2026, 1, -1), '2025-12');
eq('앞으로도 넘는다', shiftYearMonth(2026, 12, 1), '2027-01');
eq('여러 해', shiftYearMonth(2026, 3, -27), '2023-12');

console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
