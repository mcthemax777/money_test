/**
 * 리포트 집계 규칙.
 *
 * 지금까지 이 규칙은 서버의 SQL 안에만 있었다(`SUM`, `groupBy`, `date_trunc`).
 * 오프라인에서는 기기가 스스로 월 합계를 내야 하므로, 규칙을 SQL에서 꺼내
 * 순수 함수로 옮긴다. 서버도 이 함수를 쓴다. 두 벌로 두면 같은 달의 합계가
 * 기기와 웹에서 다르게 나오는 날이 온다.
 *
 * 나누는 자리는 하나다.
 *   - **무엇을 셀지 고르는 일**(프로젝트, 기간, 사람, 결제수단)은 질의가 한다.
 *     인덱스가 있는 쪽에서 걸러야 하고, 기기에서는 SQLite가 같은 일을 한다.
 *   - **고른 것을 더하는 일**은 여기서 한다.
 *
 * 왜 @money/types 인가. 서버(@money/api)는 @money/core 를 의존할 수 없다.
 * axios·zustand·react 가 함께 딸려 온다. 서버와 화면이 함께 의존하는 패키지는
 * 여기 하나뿐이다.
 *
 * 금액은 모두 **기준통화 환산액**이다. 표시 통화로 옮기는 곱셈은 부르는 쪽이
 * 마지막 합계에 한 번만 한다. 행마다 곱하면 반올림이 행 수만큼 쌓인다.
 */

import { Dec, type DecInput } from './decimal';
import type { CategoryType } from './entities';
import { zonedDateKey, zonedYearMonth } from './tz';

/**
 * 일반/과소비 선택.
 *
 *   undefined = 전체 (다리 금액을 그대로 센다)
 *   false     = 일반 몫만
 *   true      = 과소비 몫만
 */
export type ExtraSelection = boolean | undefined;

/**
 * 집계가 보는 카테고리 다리 하나.
 *
 * 계좌 다리는 오지 않는다. "지출 = 지출 카테고리 posting의 합"이 정의이고,
 * 계좌 다리는 두 몫(normal·extra)이 모두 0이라 섞이면 결과만 흐려진다.
 */
export interface CategoryPostingRow {
  categoryId: string;
  categoryType: CategoryType;
  /** 기준통화 환산액. 지출은 +, 수입은 -. */
  baseAmount: DecInput;
  /** 그 환산액을 쪼갠 두 몫. 언제나 0 이상이고 합은 |baseAmount| 다. */
  normalAmount: DecInput;
  extraAmount: DecInput;
  /** 전표 시각. 달력 경계는 프로젝트 타임존으로 계산한다. */
  date: Date | string;
}

/** 구성비에 이름을 실어 주려면 이만큼이 더 필요하다. */
export interface NamedCategoryPostingRow extends CategoryPostingRow {
  categoryName: string;
  parentCategoryId: string | null;
  parentCategoryName: string | null;
}

/**
 * 고른 필터에서 이 다리가 내놓는 금액.
 *
 * 한 다리가 일반과 과소비로 나뉜다(3,000원 중 2,000원이 과소비). 한쪽만 볼 때
 * 다리째로 넣거나 빼면, 일반만 보는 화면에서 남은 1,000원이 어디에도 세어지지 않는다.
 * 그래서 다리를 고르는 것이 아니라 **금액을 쪼갠다**.
 */
export function selectedAmount(row: CategoryPostingRow, extra: ExtraSelection): Dec {
  if (extra === undefined) return Dec.of(row.baseAmount).abs();
  return Dec.of(extra ? row.extraAmount : row.normalAmount);
}

export interface SummaryTotals {
  income: Dec;
  expense: Dec;
  extraExpense: Dec;
  normalExpense: Dec;
  extraIncome: Dec;
  normalIncome: Dec;
  /** 수입 - 지출 */
  net: Dec;
}

/**
 * 수입/지출 합계와 그 안의 일반·과소비 몫.
 *
 * 고르지 않은 몫은 0으로 적는다. "일반만" 보는 화면에 과소비 금액이 남아 있으면
 * 사용자가 고른 것과 다른 숫자를 보게 된다.
 */
export function summarize(
  rows: readonly CategoryPostingRow[],
  extra: ExtraSelection = undefined,
): SummaryTotals {
  let income = Dec.of(0);
  let expense = Dec.of(0);
  let extraExpense = Dec.of(0);
  let normalExpense = Dec.of(0);
  let extraIncome = Dec.of(0);
  let normalIncome = Dec.of(0);

  for (const row of rows) {
    const selected = selectedAmount(row, extra);
    if (row.categoryType === 'expense') {
      expense = expense.plus(selected);
      if (extra !== false) extraExpense = extraExpense.plus(row.extraAmount);
      if (extra !== true) normalExpense = normalExpense.plus(row.normalAmount);
    } else {
      income = income.plus(selected);
      if (extra !== false) extraIncome = extraIncome.plus(row.extraAmount);
      if (extra !== true) normalIncome = normalIncome.plus(row.normalAmount);
    }
  }

  return {
    income,
    expense,
    extraExpense,
    normalExpense,
    extraIncome,
    normalIncome,
    net: income.minus(expense),
  };
}

export interface DailyTotal {
  /** 프로젝트 타임존의 달력 날짜 "YYYY-MM-DD" */
  date: string;
  normal: Dec;
  extra: Dec;
}

/**
 * 날짜별 일반·과소비 합계. 거래가 있는 날만 돌려준다.
 *
 * 누적은 부르는 쪽이 만든다. 이번 달은 오늘까지만, 지난달은 말일까지 그어야 두 선을
 * 나란히 읽을 수 있는데 그 지점이 화면마다 다르다.
 */
export function dailyTotals(
  rows: readonly CategoryPostingRow[],
  options: { timeZone: string; type: CategoryType; extra?: ExtraSelection },
): DailyTotal[] {
  const { timeZone, type, extra } = options;
  const byDate = new Map<string, { normal: Dec; extra: Dec }>();

  for (const row of rows) {
    if (row.categoryType !== type) continue;

    const key = zonedDateKey(new Date(row.date), timeZone);
    const bucket = byDate.get(key) ?? { normal: Dec.of(0), extra: Dec.of(0) };
    if (extra !== false) bucket.extra = bucket.extra.plus(row.extraAmount);
    if (extra !== true) bucket.normal = bucket.normal.plus(row.normalAmount);
    byDate.set(key, bucket);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, bucket]) => ({ date, normal: bucket.normal, extra: bucket.extra }));
}

export interface CategoryBreakdownBucket {
  categoryId: string;
  categoryName: string;
  parentCategoryId: string | null;
  parentCategoryName: string | null;
  amount: Dec;
  count: number;
  /** 전체 대비 비율 (0~100). 비율이라 표시 통화와 무관하다. */
  ratio: number;
}

/**
 * 카테고리별 구성비. 금액 큰 순으로 준다.
 *
 * 롤업하면 소분류 금액을 대분류로 합친다. posting 은 가장 구체적인 카테고리만
 * 가리키므로 대분류 금액은 이렇게 만들어야 한다.
 *
 * 이름은 행이 들고 온다. 소분류 행이 대분류 이름까지 함께 실어 오므로, 롤업한
 * 칸의 이름을 얻으려고 따로 조회하지 않는다.
 */
export function categoryBreakdown(
  rows: readonly NamedCategoryPostingRow[],
  options: { type: CategoryType; rollup?: boolean; extra?: ExtraSelection },
): CategoryBreakdownBucket[] {
  const { type, rollup = true, extra } = options;

  interface Bucket {
    categoryId: string;
    categoryName: string;
    parentCategoryId: string | null;
    parentCategoryName: string | null;
    amount: Dec;
    count: number;
  }
  const buckets = new Map<string, Bucket>();

  for (const row of rows) {
    if (row.categoryType !== type) continue;

    const amount = selectedAmount(row, extra);
    // 셀 몫이 없는 다리는 건수에서도 뺀다. 그러지 않으면 "0원인데 3건"이 된다.
    if (extra !== undefined && !amount.isPositive()) continue;

    const rolled = rollup && row.parentCategoryId !== null;
    const key = rolled ? row.parentCategoryId! : row.categoryId;
    const bucket = buckets.get(key) ?? {
      categoryId: key,
      // 롤업한 칸의 이름은 그 행이 들고 온 부모 이름이다.
      categoryName: rolled ? row.parentCategoryName ?? '' : row.categoryName,
      // 롤업한 칸은 그 자신이 대분류이므로 부모가 없다.
      parentCategoryId: rolled ? null : row.parentCategoryId,
      parentCategoryName: rolled ? null : row.parentCategoryName,
      amount: Dec.of(0),
      count: 0,
    };
    bucket.amount = bucket.amount.plus(amount);
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  const total = Dec.sum([...buckets.values()].map((bucket) => bucket.amount));

  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      ratio: total.isZero() ? 0 : bucket.amount.dividedBy(total, 10).times(100).toNumber(),
    }))
    .sort((a, b) => b.amount.cmp(a.amount) || a.categoryName.localeCompare(b.categoryName));
}

export interface MonthlyTotal {
  /** "YYYY-MM" */
  yearMonth: string;
  amount: Dec;
}

/**
 * 월별 합계. 거래가 없는 달도 0으로 채워 그래프가 끊기지 않게 한다.
 *
 * 달의 경계는 프로젝트 타임존의 벽시계다. UTC로 자르면 한국의 00:00~09:00 거래가
 * 전월로 넘어간다.
 */
export function monthlyTotals(
  rows: readonly CategoryPostingRow[],
  options: {
    timeZone: string;
    /** 마지막 달 "YYYY-MM". 이 달을 포함해 뒤로 months 개를 만든다. */
    endYearMonth: string;
    months: number;
    extra?: ExtraSelection;
  },
): MonthlyTotal[] {
  const { timeZone, endYearMonth, months, extra } = options;

  const byMonth = new Map<string, Dec>();
  for (const row of rows) {
    const key = zonedYearMonth(new Date(row.date), timeZone);
    byMonth.set(key, (byMonth.get(key) ?? Dec.of(0)).plus(selectedAmount(row, extra)));
  }

  const [endYear, endMonth] = endYearMonth.split('-').map(Number);
  const points: MonthlyTotal[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const key = shiftYearMonth(endYear, endMonth, -i);
    points.push({ yearMonth: key, amount: byMonth.get(key) ?? Dec.of(0) });
  }
  return points;
}

/** (year, month)에서 delta개월 옮긴 "YYYY-MM". month는 1~12지만 범위를 벗어나도 된다. */
export function shiftYearMonth(year: number, month: number, delta: number): string {
  const index = month - 1 + delta;
  const shiftedYear = year + Math.floor(index / 12);
  const shiftedMonth = (((index % 12) + 12) % 12) + 1;
  return `${shiftedYear}-${String(shiftedMonth).padStart(2, '0')}`;
}

export interface EntryMonthTotal {
  /** "YYYY-MM" */
  yearMonth: string;
  income: Dec;
  expense: Dec;
}

/**
 * 거래가 있는 달만, 최신 달부터.
 *
 * `monthlyTotals` 와 갈라 두는 이유가 둘 있다. 그쪽은 그래프가 끊기지 않도록 빈 달을
 * 0으로 채우고 개수를 미리 받지만, 거래 목록의 첫 화면은 **전체 기간**을 훑으면서
 * 거래가 없는 달은 아예 보여 주지 않는다. 빈 달까지 줄로 세우면 새 가계부의 첫
 * 화면이 "0원"만 수십 줄 늘어선다.
 *
 * 수입과 지출을 함께 낸다. 한 번에 하나씩 내면 같은 행을 두 번 읽어야 한다.
 */
export function entryMonths(
  rows: readonly CategoryPostingRow[],
  options: {
    timeZone: string;
    extra?: ExtraSelection;
    /**
     * 달을 만들어야 하는 전표의 시각.
     *
     * **이체와 카드정산은 카테고리 다리가 없다.** 그래서 다리만 보고 달을 만들면 그
     * 유형만 골라 본 사람에게는 달이 하나도 나오지 않고, 거래가 있는데도 목록이 빈다
     * (실제로 그랬다). 금액은 0이 맞다 -- 계좌 사이를 옮긴 돈은 소비가 아니다. 그러나
     * **줄은 있어야 한다.** 눌러서 그 거래를 볼 수 있어야 하기 때문이다.
     *
     * 넘기지 않으면 다리가 있는 달만 만든다.
     */
    entryDates?: readonly (Date | string)[];
  },
): EntryMonthTotal[] {
  const { timeZone, extra, entryDates } = options;

  const byMonth = new Map<string, { income: Dec; expense: Dec }>();

  for (const date of entryDates ?? []) {
    const key = zonedYearMonth(new Date(date), timeZone);
    if (!byMonth.has(key)) byMonth.set(key, { income: Dec.of(0), expense: Dec.of(0) });
  }
  for (const row of rows) {
    const selected = selectedAmount(row, extra);
    /*
     * 셀 몫이 없는 다리는 그 달을 만들지 않는다.
     *
     * "과소비만" 보는 중이라면 과소비가 0원인 달은 목록에 없어야 한다. 몫을 보지 않고
     * 달부터 만들면 눌러도 아무것도 없는 줄이 생긴다.
     */
    if (extra !== undefined && !selected.isPositive()) continue;

    const key = zonedYearMonth(new Date(row.date), timeZone);
    const bucket = byMonth.get(key) ?? { income: Dec.of(0), expense: Dec.of(0) };
    if (row.categoryType === 'expense') bucket.expense = bucket.expense.plus(selected);
    else bucket.income = bucket.income.plus(selected);
    byMonth.set(key, bucket);
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([yearMonth, bucket]) => ({ yearMonth, ...bucket }));
}
