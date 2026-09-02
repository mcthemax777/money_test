/**
 * 카드 주기별 사용액과 실적 계산.
 *
 * 지금까지 이 규칙은 서버의 `card-ledger.service` 안에 질의와 섞여 있었다. 기기가
 * 오프라인에서 카드 실적을 보여 주려면 같은 규칙이 기기에도 있어야 하는데, 두 벌로
 * 두면 같은 카드의 이번 주기 사용액이 웹과 앱에서 다르게 나온다.
 *
 * 경계는 다른 집계와 같다. **무엇을 셀지 고르는 일은 질의가**(이 카드의 다리를,
 * 그리고 최장 할부만큼 앞에서부터), **고른 것을 나누고 더하는 일은 여기서** 한다.
 *
 * 청구서를 저장하지 않는다는 결정이 이 파일을 순수하게 만든다. 주기는 카드의 현재
 * 마감일 설정으로 그때그때 계산하므로, 읽는 쪽이 카드 설정과 다리만 넘기면 된다.
 */

import type { CardDto } from './dtos';
import { Dec, type DecInput } from './decimal';
import {
  closingMonthKey,
  closingMonthOf,
  periodForClosingMonth,
  shiftClosingMonth,
} from './statement-period';
import { zonedParts, zonedYearMonth } from './tz';

/** 기본으로 보여 주는 과거 주기 수 (진행 중인 주기 포함) */
export const DEFAULT_USAGE_PERIODS = 6;
export const MAX_USAGE_PERIODS = 24;

/**
 * 앞으로 몇 주기까지 벌려서 보여 줄지.
 *
 * 할부는 구매 시점 이후 주기로 넘어가므로 미래 주기를 만들어야 한다. 그런데 상한이
 * 없으면 잘못 입력된 먼 미래 거래 하나가 지금부터 그 달까지를 전부 만든다
 * (2926년 한 건에 주기 10,806개, 응답 1.5MB). 거래 날짜에 5년 상한을 걸었지만 그 전에
 * 들어온 데이터가 이미 있을 수 있으므로 여기서도 자른다.
 *
 * 60개월이면 실제로 쓰이는 최장 할부(보통 36개월)를 넉넉히 덮는다.
 */
export const MAX_FUTURE_PERIODS = 60;

/** 집계가 보는 카드 다리 하나. */
export interface CardUsagePosting {
  /** 다리 금액. 사용은 음수로 저장된다(부채가 늘거나 통장에서 나간다). */
  amount: DecInput;
  /** 전표 시각. 주기 경계는 프로젝트 타임존으로 판단한다. */
  date: Date | string;
  /** 할부 개월수. 일시불이면 null 이나 1 이다. */
  installmentMonths?: number | null;
}

export interface CreditUsageInput {
  postings: readonly CardUsagePosting[];
  statementClosingDay: number;
  paymentDueDay: number;
  timeZone: string;
  /** 만들 과거 주기 수. 진행 중인 주기를 포함한다. */
  span: number;
  /** 지금. 검사에서 고정하려고 받는다. */
  now?: Date;
}

export interface CreditUsageResult {
  periods: CardDto.UsagePeriod[];
  /**
   * 표시 범위를 넘는 주기를 잘라냈는가.
   *
   * 잘못된 날짜의 거래가 섞여 있다는 뜻이다. 부르는 쪽이 경고를 남긴다.
   */
  clipped: boolean;
}

/** 정해진 범위로 자른 주기 수. */
export function usageSpan(months?: number): number {
  return Math.min(Math.max(Number(months) || DEFAULT_USAGE_PERIODS, 1), MAX_USAGE_PERIODS);
}

/**
 * 신용카드의 주기별 사용액.
 *
 * 마감일 기준으로 자른다. 마감일이 15일이면 8/16~9/15가 한 주기다. 할부는 구매한
 * 주기에 전액이 아니라 회차분만 들어가고, 나머지는 뒤 주기로 넘어간다.
 */
export function creditUsagePeriods(input: CreditUsageInput): CreditUsageResult {
  const { statementClosingDay, paymentDueDay, timeZone, span } = input;
  const now = input.now ?? new Date();

  // 마감 연월 -> 그 주기에 청구되는 금액
  const byMonth = new Map<string, Dec>();
  const add = (closing: { year: number; month: number }, amount: Dec) => {
    const key = closingMonthKey(closing);
    byMonth.set(key, (byMonth.get(key) ?? Dec.of(0)).plus(amount));
  };

  for (const posting of input.postings) {
    // 부채 다리는 사용이 음수다. 표시용으로 뒤집는다.
    const total = Dec.of(posting.amount).negated();
    const purchase = closingMonthOf(asDate(posting.date), statementClosingDay, timeZone);

    const shares = splitInstallment(total, posting.installmentMonths ?? 1);
    for (let offset = 0; offset < shares.length; offset += 1) {
      add(shiftClosingMonth(purchase, offset), shares[offset]);
    }
  }

  const today = zonedParts(now, timeZone);
  const current = closingMonthOf(now, statementClosingDay, timeZone);
  const todayMarker = Date.UTC(today.year, today.month - 1, today.day);

  // 최근 span개 주기를 기본으로 하되, 할부 때문에 금액이 잡힌 미래 주기까지 넓힌다.
  const first = shiftClosingMonth(current, -(span - 1));
  const furthestKey = closingMonthKey(shiftClosingMonth(current, MAX_FUTURE_PERIODS));

  let last = current;
  let clipped = false;
  for (const key of byMonth.keys()) {
    if (key > furthestKey) {
      clipped = true;
      continue;
    }
    const [year, month] = key.split('-').map(Number);
    if (key > closingMonthKey(last)) last = { year, month };
  }

  const periods: CardDto.UsagePeriod[] = [];
  for (
    let cursor = first;
    closingMonthKey(cursor) <= closingMonthKey(last);
    cursor = shiftClosingMonth(cursor, 1)
  ) {
    const period = periodForClosingMonth(
      cursor.year,
      cursor.month,
      statementClosingDay,
      paymentDueDay,
    );
    periods.push({
      periodStart: period.periodStart.toISOString(),
      periodEnd: period.periodEnd.toISOString(),
      dueDate: period.dueDate.toISOString(),
      closed: period.periodEnd.getTime() < todayMarker,
      usage: (byMonth.get(closingMonthKey(cursor)) ?? Dec.of(0)).toString(),
    });
  }

  return { periods, clipped };
}

export interface DebitUsageInput {
  postings: readonly CardUsagePosting[];
  timeZone: string;
  span: number;
  now?: Date;
}

/**
 * 체크카드의 달별 사용액.
 *
 * 청구 주기도 갚을 대금도 없지만 "지난달에 얼마 썼나"는 신용카드와 똑같이 알고 싶은
 * 값이다. 자를 기준만 달력 월로 바꿔 같은 모양으로 돌려준다. 할부는 나누지 않는다
 * (체크카드에는 할부가 없다).
 */
export function debitUsagePeriods(input: DebitUsageInput): CardDto.UsagePeriod[] {
  const { timeZone, span } = input;
  const now = input.now ?? new Date();

  const byMonth = new Map<string, Dec>();
  for (const posting of input.postings) {
    const key = zonedYearMonth(asDate(posting.date), timeZone);
    byMonth.set(key, (byMonth.get(key) ?? Dec.of(0)).plus(Dec.of(posting.amount).negated()));
  }

  const [thisYear, thisMonth] = zonedYearMonth(now, timeZone).split('-').map(Number);
  const periods: CardDto.UsagePeriod[] = [];

  for (let offset = span - 1; offset >= 0; offset -= 1) {
    const cursor = new Date(Date.UTC(thisYear, thisMonth - 1 - offset, 1));
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth() + 1;
    const key = `${year}-${String(month).padStart(2, '0')}`;

    periods.push({
      // 달력 날짜 표시자. 청구 주기 쪽과 같은 형태로 맞춘다 (그 달 1일 ~ 말일).
      periodStart: new Date(Date.UTC(year, month - 1, 1)).toISOString(),
      periodEnd: new Date(Date.UTC(year, month, 0)).toISOString(),
      // 이번 달만 아직 늘어날 수 있다.
      closed: offset > 0,
      usage: (byMonth.get(key) ?? Dec.of(0)).toString(),
    });
  }

  return periods;
}

/**
 * 실적 응답 조립. 기준액이 없으면 달성 여부와 남은 금액은 뜻이 없다.
 *
 * 사용액이 음수일 수 있다(그 구간에 취소가 더 많은 경우). 남은 금액은 기준액보다
 * 커지고, 그게 사실이므로 0으로 자르지 않는다. 반대로 이미 채웠으면 음수가 아니라
 * 0으로 적는다 - "0원 남았다"가 "-3만원 남았다"보다 읽기 쉽다.
 */
export function performanceOf(input: {
  cardId: string;
  currency: string;
  basis: 'statement' | 'month';
  periodStart: string;
  periodEnd: string;
  usage: DecInput;
  previousPeriodStart: string;
  previousPeriodEnd: string;
  previousUsage: DecInput;
  target: DecInput | null;
}): CardDto.PerformanceResponse {
  const usage = Dec.of(input.usage);
  const target = input.target === null ? null : Dec.of(input.target);
  const achieved = target !== null && usage.gte(target);

  return {
    cardId: input.cardId,
    currency: input.currency,
    basis: input.basis,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    usage: usage.toString(),
    previousPeriodStart: input.previousPeriodStart,
    previousPeriodEnd: input.previousPeriodEnd,
    previousUsage: Dec.of(input.previousUsage).toString(),
    target: target?.toString() ?? null,
    achieved,
    remaining: target === null ? null : achieved ? '0' : target.minus(usage).toString(),
  };
}

/**
 * 할부 회차 금액. 나누어떨어지지 않는 끝수는 첫 회차에 몰아준다.
 * 10,000원 3개월이면 3,334 / 3,333 / 3,333 이 된다.
 */
export function splitInstallment(total: DecInput, months: number): Dec[] {
  const amount = Dec.of(total);
  if (months <= 1) return [amount];

  // 원 단위로 자른다. 소수 통화는 지금 다루지 않는다.
  const each = amount.dividedBy(months, 0, 'down');
  const shares = Array.from({ length: months }, () => each);
  shares[0] = each.plus(amount.minus(each.times(months)));
  return shares;
}

/** 문자열과 Date 가 섞여 온다. 한 곳에서 맞춘다. */
function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
