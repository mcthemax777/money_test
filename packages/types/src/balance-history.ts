/**
 * 자산 추이 그래프의 규칙. 서버(`reports.getBalanceHistory`)와 기기 사본이 함께 쓴다.
 *
 * 두 가지를 여기 둔다.
 *   1. **칸 나누기** -- 일·주·월·년 칸의 경계. 프로젝트 타임존 기준이다.
 *   2. **칸마다 잔액 쌓기** -- 칸 직전까지의 장부가에, 평가 계좌는 그때까지의 마지막 평가액.
 *
 * 금액을 모으는 일(다리의 합)은 각자 한다. 서버는 SQL 로 계좌·칸별로 더해 오고, 사본은 다리를
 * 읽어 칸에 떨군다. 둘이 같은 칸 경계와 같은 쌓기 규칙을 써야 같은 날의 선이 갈리지 않는다.
 */
import type { AccountType } from './entities';
import { Dec, type DecInput } from './decimal';
import { weekStartKey } from './entry-period';
import { VALUED_ACCOUNT_TYPES } from './net-worth-aggregation';
import { shiftYearMonth } from './report-aggregation';
import { zonedDateKey, zonedDayStart, zonedMonthStart, zonedParts } from './tz';
import { DEFAULT_WEEK_START, type WeekStart } from './week-start';

/** 잔액 추이의 한 칸. 값은 end 직전까지 쌓인 잔액이다. */
export interface BalanceBucket {
  label: string;
  start: Date;
  end: Date;
}

/** 칸을 고르는 데 쓰는 값. 부르는 쪽이 모양을 검사한 뒤 넘긴다 (서버는 400 으로 막는다). */
export interface BalanceBucketQuery {
  granularity: 'day' | 'week' | 'month' | 'year';
  /** 창의 마지막 달 "YYYY-MM" */
  endMonth: string;
  /** 일 단위에서 그 달 하나를 그릴 때 "YYYY-MM" */
  yearMonth?: string;
  /** 일·주 단위 창의 마지막 날 "YYYY-MM-DD". 없으면 오늘 */
  endDate?: string;
  days?: unknown;
  weeks?: unknown;
  months?: unknown;
  years?: unknown;
  weekStart: WeekStart;
}

/** 구간 개수. 쿼리스트링으로 오는 값이라 숫자가 아닐 수 있다. */
function clampCount(value: unknown, fallback: number, max: number): number {
  return Math.min(Math.max(Number(value) || fallback, 1), max);
}

/** 고른 단위의 칸들. 오래된 칸부터다. */
export function balanceBuckets(query: BalanceBucketQuery, timeZone: string): BalanceBucket[] {
  const { granularity, endMonth } = query;
  if (granularity === 'day') {
    return query.yearMonth
      ? dayBuckets(query.yearMonth, timeZone)
      : recentDayBuckets(clampCount(query.days, 30, 366), timeZone, query.endDate);
  }
  if (granularity === 'week') {
    return weekBuckets(clampCount(query.weeks, 13, 260), timeZone, query.endDate, query.weekStart);
  }
  if (granularity === 'year') {
    return yearBuckets(Number(endMonth.slice(0, 4)), clampCount(query.years, 5, 30), timeZone);
  }
  return monthBuckets(endMonth, clampCount(query.months, 12, 60), timeZone);
}

/** 월 단위 칸. endMonth 를 포함해 뒤로 months 개. */
function monthBuckets(endMonth: string, months: number, timeZone: string): BalanceBucket[] {
  const [year, month] = endMonth.split('-').map(Number);
  const buckets: BalanceBucket[] = [];
  for (let i = months - 1; i >= 0; i--) {
    buckets.push({
      label: shiftYearMonth(year, month, -i),
      start: zonedMonthStart(year, month - i, timeZone),
      end: zonedMonthStart(year, month - i + 1, timeZone),
    });
  }
  return buckets;
}

/** 연 단위 칸. endYear 를 포함해 뒤로 years 개. */
function yearBuckets(endYear: number, years: number, timeZone: string): BalanceBucket[] {
  const buckets: BalanceBucket[] = [];
  for (let i = years - 1; i >= 0; i--) {
    const year = endYear - i;
    buckets.push({
      label: String(year),
      start: zonedMonthStart(year, 1, timeZone),
      end: zonedMonthStart(year + 1, 1, timeZone),
    });
  }
  return buckets;
}

/**
 * 일 단위 칸. endDate(없으면 오늘)를 포함해 뒤로 days 개.
 *
 * zonedDayStart 는 day 가 1보다 작아도 앞 달로 넘어간다(Date.UTC 의 규칙). 달 경계를 따로
 * 다루지 않아도 되는 이유다. endDate 는 이미 프로젝트 타임존으로 정해진 달력 날짜다.
 */
function recentDayBuckets(days: number, timeZone: string, endDate?: string): BalanceBucket[] {
  const { year, month, day } = endDate
    ? {
        year: Number(endDate.slice(0, 4)),
        month: Number(endDate.slice(5, 7)),
        day: Number(endDate.slice(8, 10)),
      }
    : zonedParts(new Date(), timeZone);
  const buckets: BalanceBucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = zonedDayStart(year, month, day - i, timeZone);
    buckets.push({
      label: zonedDateKey(start, timeZone),
      start,
      end: zonedDayStart(year, month, day - i + 1, timeZone),
    });
  }
  return buckets;
}

/**
 * 주 단위 칸. endDate(없으면 오늘)가 든 주를 포함해 뒤로 weeks 개. 주는 고른 요일에 시작한다
 * (`weekStartKey`). 이름표는 그 주의 첫날이다.
 */
function weekBuckets(
  weeks: number,
  timeZone: string,
  endDate?: string,
  weekStart: WeekStart = DEFAULT_WEEK_START,
): BalanceBucket[] {
  const endKey = endDate ?? zonedDateKey(new Date(), timeZone);
  const [year, month, day] = weekStartKey(endKey, weekStart).split('-').map(Number);

  const buckets: BalanceBucket[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = zonedDayStart(year, month, day - i * 7, timeZone);
    buckets.push({
      label: zonedDateKey(start, timeZone),
      start,
      end: zonedDayStart(year, month, day - i * 7 + 7, timeZone),
    });
  }
  return buckets;
}

/** 일 단위 칸. 그 달 1일부터 말일까지. */
function dayBuckets(yearMonth: string, timeZone: string): BalanceBucket[] {
  const [year, month] = yearMonth.split('-').map(Number);
  const monthEnd = zonedMonthStart(year, month + 1, timeZone);
  const pad = (value: number) => String(value).padStart(2, '0');
  const buckets: BalanceBucket[] = [];

  for (let day = 1; ; day++) {
    const start = zonedDayStart(year, month, day, timeZone);
    if (start.getTime() >= monthEnd.getTime()) break;
    buckets.push({
      label: `${year}-${pad(month)}-${pad(day)}`,
      start,
      end: zonedDayStart(year, month, day + 1, timeZone),
    });
  }
  return buckets;
}

/**
 * 칸마다 잔액을 쌓는다.
 *
 *   base      창 시작 전까지 쌓인 계좌별 장부가
 *   steps     칸 안의 계좌별 증감. 열쇠는 그 칸의 start 시각(ms)
 *   valuations 평가 계좌(투자·부동산)의 평가 기록. 날짜 오름차순이어야 한다
 *
 * 평가 계좌는 그 칸 끝 전의 마지막 평가액을, 없으면 장부가를 쓴다 (순자산과 같은 규칙).
 * 돌려주는 값은 저장 통화다 -- 표시 통화로 옮기는 일은 부르는 쪽이 한다.
 */
export function stackBalanceHistory(input: {
  accounts: ReadonlyArray<{ id: string; type: AccountType }>;
  base: ReadonlyMap<string, DecInput>;
  steps: ReadonlyMap<number, ReadonlyArray<{ accountId: string; delta: DecInput }>>;
  valuations: ReadonlyArray<{ accountId: string; date: Date; marketValue: DecInput }>;
  buckets: readonly BalanceBucket[];
}): Array<{ label: string; total: Dec }> {
  const { accounts, base, steps, valuations, buckets } = input;
  const book = new Map<string, Dec>(accounts.map((account) => [account.id, Dec.of(base.get(account.id) ?? 0)]));

  return buckets.map((bucket) => {
    for (const step of steps.get(bucket.start.getTime()) ?? []) {
      book.set(step.accountId, (book.get(step.accountId) ?? Dec.of(0)).plus(step.delta));
    }

    let total = Dec.of(0);
    for (const account of accounts) {
      const bookValue = book.get(account.id) ?? Dec.of(0);
      if (!VALUED_ACCOUNT_TYPES.includes(account.type)) {
        total = total.plus(bookValue);
        continue;
      }
      let asOf: DecInput | null = null;
      for (const valuation of valuations) {
        if (valuation.accountId !== account.id) continue;
        if (valuation.date.getTime() >= bucket.end.getTime()) break;
        asOf = valuation.marketValue;
      }
      total = total.plus(asOf ?? bookValue);
    }
    return { label: bucket.label, total };
  });
}
