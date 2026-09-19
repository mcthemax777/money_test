/**
 * 리포트 집계 규칙 검사. 데이터베이스에 닿지 않는다.
 *
 * 실행: cd packages/api && npx ts-node scripts/report-aggregation-smoke.ts
 *
 * `reports-smoke` 는 이 규칙이 서버 응답에서 맞는지 본다. 여기서 보는 것은 규칙
 * 자체다. 기기가 오프라인에서 이 함수를 직접 부르므로, 서버를 거치지 않는 경로도
 * 지켜져야 한다. 특히 두 가지를 콕 집어 본다.
 *
 *   1. 달력 경계를 프로젝트 타임존으로 자르는 것 (UTC로 자르면 새벽 거래가 밀린다)
 *   2. 롤업한 칸의 이름과 부모 정보
 */
import {
  type NamedCategoryPostingRow,
  categoryBreakdown,
  dailyTotals,
  entryMonths,
  monthlyTotals,
  periodDayRange,
  periodKeyOf,
  unitOfKey,
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

/** 지출 다리 하나. */
const expense = (
  amount: string,
  date: string,
  categoryId = 'c-food',
): NamedCategoryPostingRow => ({
  categoryId,
  categoryType: 'expense',
  categoryName: '식비',
  parentCategoryId: null,
  parentCategoryName: null,
  baseAmount: amount,
  date,
});

/** 수입 다리. 환산액이 음수라는 점이 지출과 다르다. */
const income = (amount: string, date: string): NamedCategoryPostingRow => ({
  categoryId: 'c-salary',
  categoryType: 'income',
  categoryName: '급여',
  parentCategoryId: null,
  parentCategoryName: null,
  baseAmount: `-${amount}`,
  date,
});

// ── 합계 ──
const rows = [
  expense('30000', '2026-08-05T03:00:00.000Z'),
  expense('50000', '2026-08-06T03:00:00.000Z'),
  income('3000000', '2026-08-25T03:00:00.000Z'),
];

const all = summarize(rows);
eq('지출 합계 (수입 다리가 섞이지 않는다)', all.expense.toString(), '80000');
eq('수입 합계 (음수 환산액을 크기로 센다)', all.income.toString(), '3000000');
eq('순액', all.net.toString(), '2920000');

eq('빈 목록의 합계는 0', summarize([]).expense.toString(), '0');

// ── 날짜별 ──
// 한국 시간 8월 6일 00:30 은 UTC 로 8월 5일 15:30 이다. UTC 로 자르면 5일로 밀린다.
const dawn = expense('10000', '2026-08-05T15:30:00.000Z');
const days = dailyTotals([...rows, dawn], { timeZone: KST, type: 'expense' });
eq('날짜 수', days.length, 2);
eq('첫 날', days[0]?.date, '2026-08-05');
eq('새벽 거래가 다음 날로 넘어가지 않는다', days[1]?.date, '2026-08-06');
eq('8/6 합계 (50000 + 10000)', days[1]?.amount.toString(), '60000');
eq('수입만 보면 그 날짜만 남는다',
  dailyTotals(rows, { timeZone: KST, type: 'income' }).length, 1);

const utcDays = dailyTotals([dawn], { timeZone: 'UTC', type: 'expense' });
eq('타임존을 바꾸면 날짜가 달라진다 (UTC 기준)', utcDays[0]?.date, '2026-08-05');

// ── 구성비 ──
const dining: NamedCategoryPostingRow = {
  ...expense('40000', '2026-08-07T03:00:00.000Z', 'c-lunch'),
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

/*
 * ── 거래 목록의 바깥 묶음 -- 해·달·주 ──
 *
 * 열쇠를 만드는 일은 서버와 기기 사본이 같은 함수로 한다. 두 벌이면 같은 주가 화면마다
 * 다른 날에서 시작해, 폰에서 본 줄을 웹에서 찾을 수 없다.
 *
 * 주는 **일요일**에 끊는다. 이 저장소의 달력과 요일 이름이 이미 그렇다.
 */
// 한국 시간 9월 14일은 월요일. 그 주는 9월 13일(일)에서 시작한다.
eq('주는 일요일에서 시작한다', periodKeyOf('2026-09-14T05:00:00.000Z', KST, 'week'), '2026-09-13');
eq('일요일 자신은 그 주의 첫날', periodKeyOf('2026-09-20T05:00:00.000Z', KST, 'week'), '2026-09-20');
eq('주가 해를 넘는다', periodKeyOf('2027-01-01T05:00:00.000Z', KST, 'week'), '2026-12-27');
eq('해 열쇠', periodKeyOf('2026-09-14T05:00:00.000Z', KST, 'year'), '2026');
eq('달 열쇠', periodKeyOf('2026-09-14T05:00:00.000Z', KST, 'month'), '2026-09');

// 경계도 타임존을 따른다. KST 9월 20일 00:30 = UTC 9월 19일 15:30 이라 주가 갈린다.
eq('주 경계가 타임존을 따른다 (KST)',
  periodKeyOf('2026-09-19T15:30:00.000Z', KST, 'week'), '2026-09-20');
eq('UTC 로 보면 앞 주다',
  periodKeyOf('2026-09-19T15:30:00.000Z', 'UTC', 'week'), '2026-09-13');

/*
 * 양끝은 **열쇠에서** 읽는다. 단위를 따로 받지 않는 것이 요점이다.
 *
 * 화면의 단위 상태와 손에 든 열쇠는 한 순간 어긋난다 -- 단위를 바꾸면 상태가 먼저
 * 바뀌고 새 목록은 그 다음에 온다. 그 사이에 옛 열쇠를 새 단위로 읽으면 "2026-09" 가
 * 해가 되어 `Number` 가 NaN 이 되고, 그 값으로 만든 날짜가 형식기에서 터진다.
 */
eq('열쇠가 단위를 말한다 (해)', unitOfKey('2026'), 'year');
eq('열쇠가 단위를 말한다 (달)', unitOfKey('2026-09'), 'month');
eq('열쇠가 단위를 말한다 (주)', unitOfKey('2026-09-13'), 'week');
eq('해의 양끝', JSON.stringify(periodDayRange('2026')),
  '{"startKey":"2026-01-01","endKey":"2026-12-31"}');
eq('달의 양끝 (말일을 안다)', JSON.stringify(periodDayRange('2026-02')),
  '{"startKey":"2026-02-01","endKey":"2026-02-28"}');
eq('주의 양끝 (이레)', JSON.stringify(periodDayRange('2026-09-13')),
  '{"startKey":"2026-09-13","endKey":"2026-09-19"}');

/*
 * 어느 단위로 묶어도 합계는 같다.
 *
 * 줄이 갈리는 것과 돈이 새는 것은 다른 이야기다. 묶는 열쇠를 바꾸다 거래 하나를
 * 흘리면 합계가 조용히 줄어든다.
 */
const spread = [
  expense('1000', '2026-09-14T05:00:00.000Z'),
  expense('2000', '2026-09-20T05:00:00.000Z'),
  expense('4000', '2026-10-01T05:00:00.000Z'),
  expense('8000', '2025-12-31T05:00:00.000Z'),
];
const totalOf = (unit: 'year' | 'month' | 'week') =>
  entryMonths(spread, { timeZone: KST, unit })
    .reduce((sum, row) => sum + Number(row.expense.toString()), 0);
eq('해로 묶어도 합이 같다', totalOf('year'), 15000);
eq('달로 묶어도 합이 같다', totalOf('month'), 15000);
eq('주로 묶어도 합이 같다', totalOf('week'), 15000);
eq('해는 두 줄', entryMonths(spread, { timeZone: KST, unit: 'year' }).length, 2);
eq('달은 세 줄', entryMonths(spread, { timeZone: KST, unit: 'month' }).length, 3);
eq('주는 네 줄', entryMonths(spread, { timeZone: KST, unit: 'week' }).length, 4);
eq('새 줄이 위다', entryMonths(spread, { timeZone: KST, unit: 'year' })[0]?.yearMonth, '2026');
// 단위를 주지 않으면 달이다. 이 칸을 모르는 옛 기기가 그 길로 온다.
eq('단위가 없으면 달', entryMonths(spread, { timeZone: KST }).length, 3);

// ── 달 이동 ──
eq('연 경계를 넘는다', shiftYearMonth(2026, 1, -1), '2025-12');
eq('앞으로도 넘는다', shiftYearMonth(2026, 12, 1), '2027-01');
eq('여러 해', shiftYearMonth(2026, 3, -27), '2023-12');

console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
