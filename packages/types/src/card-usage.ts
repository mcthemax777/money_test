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
  /**
   * 사용자가 적어 둔 회차별 원금. 없으면 개월수로 나눈 값을 쓴다.
   *
   * 끝수를 어느 회차에 몰아주는지는 카드사마다 다르다. 1,000원 3개월이 334/333/333 일
   * 수도 334/334/332 일 수도 있어, 명세서와 맞추려면 사람이 적은 값을 그대로 써야 한다.
   * 길이는 개월수와 같고 합은 결제 금액과 같다 (조립이 그때 검사한다).
   */
  installmentShares?: readonly DecInput[] | null;
  /**
   * 사용자가 적어 둔 회차별 이자. 없거나 개수가 어긋나면 이자가 없는 것으로 본다.
   *
   * 다리 금액에는 이 이자가 **이미 들어 있다**. 카드사에 갚을 돈이 원금과 이자를
   * 합한 값이기 때문이다. 그래서 청구는 회차마다 원금에 이자를 더해 세고, 실적은
   * 반대로 이자를 빼고 센다 -- 카드사가 혜택을 정할 때 세는 것은 결제액뿐이다.
   */
  installmentInterestShares?: readonly DecInput[] | null;
  /**
   * 이 거래를 실적에 세는가. 없으면 센 것으로 본다.
   *
   * **분할해도 하나다.** 카드사가 보는 것은 승인 한 건이라, 분류로 나눴다고 절반만
   * 실적에 드는 일은 없다. 청구액과도 다른 값이다 -- 꺼져 있어도 청구는 그대로 되므로
   * `billed` 에는 들어가고 `usage` 에서만 빠진다.
   */
  countsPerformance?: boolean;
  /**
   * 결제 자리에서 깎인 금액 (포인트·자동할인·취소). 양수다.
   *
   * 깎인 금액은 줄마다 따로 적히므로(`Posting.discountAmount`) 부르는 쪽이 그 합을
   * 담는다. 다리 금액은 이미 깎인 뒤의 값이라, 실적을 정가로 셀 때 여기서 되살린다.
   */
  discountAmount?: DecInput | null;
  /**
   * 그 차감액을 실적에서도 뺄지. 없으면 뺀 것으로 본다 (지금까지의 동작).
   *
   * 꺼져 있으면 `usage` 만 정가로 세고 `billed` 는 깎인 금액 그대로다 -- 갚을 대금은
   * 어느 쪽이든 달라지지 않는다.
   */
  discountCountsPerformance?: boolean;
}

/**
 * 실적에 셀 금액. 청구액과 갈리는 자리는 차감 하나뿐이다.
 *
 * 받는 `billed` 는 이미 부호를 뒤집은 값이다 (사용이 양수).
 */
function performanceAmount(billed: Dec, posting: CardUsagePosting): Dec {
  /*
   * 이자는 실적에서 뺀다. 다리 금액에 들어 있으므로 여기서 덜어낸다.
   *
   * 카드사가 혜택을 정할 때 세는 것은 승인된 결제액이다. 할부 수수료를 얼마나 냈는지는
   * 그 셈에 들어가지 않으므로, 전표가 이자까지 담게 된 뒤에도 실적은 구매가 그대로다.
   */
  const amount = billed.minus(
    installmentInterestTotal(posting.installmentInterestShares, installmentMonthsOf(posting)),
  );

  if (posting.discountCountsPerformance ?? true) return amount;

  const discount = posting.discountAmount;
  if (discount === undefined || discount === null || discount === '') return amount;
  return amount.plus(Dec.of(discount));
}

/** 이 다리의 할부 개월수. 일시불이면 1 이다. */
function installmentMonthsOf(posting: CardUsagePosting): number {
  return Math.max(posting.installmentMonths ?? 1, 1);
}

/**
 * 적어 둔 회차 이자. 개수가 개월수와 다르면 null 이다.
 *
 * 개수가 어긋난 값은 금액이나 개월수를 고친 뒤 남은 옛 값이다. 어느 회차의 이자인지
 * 알 수 없으므로 없는 것으로 본다 (회차 원금과 같은 판단이다).
 */
export function installmentInterests(
  interests: readonly DecInput[] | null | undefined,
  months: number,
): Dec[] | null {
  if (!interests || interests.length !== months) return null;
  return toDecList(interests);
}

/** 회차 이자의 합. 적어 둔 것이 없으면 0 이다. */
export function installmentInterestTotal(
  interests: readonly DecInput[] | null | undefined,
  months: number,
): Dec {
  const values = installmentInterests(interests, months);
  if (!values) return Dec.of(0);
  return values.reduce<Dec>((acc, value) => acc.plus(value), Dec.of(0));
}

/** 한 다리가 어느 주기에 얼마를 쌓는가. 실적은 주기 하나에만 들어간다. */
export interface PerformanceShare {
  /** 마감 연월 키 (`closingMonthKey`). 체크카드는 달력 월 키다. */
  closingKey: string;
  /** 그 주기의 실적에 더해지는 금액. 사용이 양수다. */
  amount: string;
  /** 할부 개월수. 일시불이면 1 이다. 화면이 "3개월 할부"로 적는 데 쓴다. */
  months: number;
}

/**
 * 신용카드 다리 하나가 실적에 더하는 몫. 언제나 하나다.
 *
 * **할부도 결제한 주기에 전액이 든다.** 카드사가 실적으로 세는 것은 승인 한 건이라,
 * 24개월로 나눠 갚는다고 그 달 실적이 1/24 만 오르지 않는다. 청구는 회차로 나뉘므로
 * 이 함수와 `billedShares` 가 갈리고, 그래서 주기마다 실적과 청구가 다른 값이다.
 *
 * 실적에서 뺀 거래는 빈 목록이다. 차감을 실적에서 빼지 않기로 한 거래는 정가로 센다 --
 * 주기 합계(`creditUsagePeriods`)가 이 함수를 그대로 쓴다.
 */
export function creditPerformanceShares(
  posting: CardUsagePosting,
  statementClosingDay: number,
  timeZone: string,
): PerformanceShare[] {
  if (!(posting.countsPerformance ?? true)) return [];

  const purchase = closingMonthOf(asDate(posting.date), statementClosingDay, timeZone);
  return [
    {
      closingKey: closingMonthKey(purchase),
      amount: performanceAmount(Dec.of(posting.amount).negated(), posting).toString(),
      months: Math.max(posting.installmentMonths ?? 1, 1),
    },
  ];
}

/**
 * 체크카드 다리 하나가 실적에 더하는 몫. 달력 월 하나뿐이다.
 *
 * 체크카드에는 할부가 없어 나눌 것이 없다. 실적에서 뺀 거래는 빈 목록이다.
 */
export function debitPerformanceShares(
  posting: CardUsagePosting,
  timeZone: string,
): PerformanceShare[] {
  if (!(posting.countsPerformance ?? true)) return [];

  const amount = performanceAmount(Dec.of(posting.amount).negated(), posting);
  return [
    {
      closingKey: zonedYearMonth(asDate(posting.date), timeZone),
      amount: amount.toString(),
      months: 1,
    },
  ];
}

/** 한 다리가 어느 주기에 얼마를 청구하는가. 할부는 회차마다 하나씩이다. */
export interface BilledShare {
  /** 마감 연월 키 (`closingMonthKey`). */
  closingKey: string;
  /** 그 주기에 청구되는 금액. 사용이 양수다. */
  amount: string;
  /** 할부 회차. 일시불이면 1 이다. */
  index: number;
  /** 할부 개월수. 일시불이면 1 이다. */
  months: number;
}

/**
 * 신용카드 다리 하나가 주기마다 청구하는 몫. 할부는 회차만큼이다.
 *
 * 실적과 달리 여기서는 차감을 되살리지 않는다. 깎인 금액은 갚을 대금에서도 빠지므로
 * 다리 금액(이미 순액)이 그대로 청구액이다. 실적에서 뺀 거래도 청구는 그대로 된다.
 *
 * **회차마다 원금에 그 회차의 이자를 더한다.** 명세서에 찍히는 것이 그 값이고, 다리
 * 금액도 이미 이자를 품고 있어 회차 합이 다리와 같다.
 *
 * 24개월 할부처럼 오래 끌리는 청구가 뒤 주기에 얼마씩 얹히는지는 이 목록이 답한다.
 * 원장에는 구매한 날 한 줄뿐이라, 그 줄만 보아서는 이번 달 대금이 왜 큰지 알 수 없다.
 */
export function billedShares(
  posting: CardUsagePosting,
  statementClosingDay: number,
  timeZone: string,
): BilledShare[] {
  const months = Math.max(posting.installmentMonths ?? 1, 1);
  const charged = Dec.of(posting.amount).negated();
  const interests = installmentInterests(posting.installmentInterestShares, months);
  const principalTotal = charged.minus(
    installmentInterestTotal(posting.installmentInterestShares, months),
  );
  const purchase = closingMonthOf(asDate(posting.date), statementClosingDay, timeZone);

  return installmentPrincipals(principalTotal, months, posting.installmentShares).map(
    (share, offset) => ({
      closingKey: closingMonthKey(shiftClosingMonth(purchase, offset)),
      amount: share.plus(interests?.[offset] ?? Dec.of(0)).toString(),
      index: offset + 1,
      months,
    }),
  );
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
 * 마감일 기준으로 자른다. 마감일이 15일이면 8/16~9/15가 한 주기다. 할부의 청구는
 * 구매한 주기에 회차분만 들어가고 나머지는 뒤 주기로 넘어가지만, 실적은 구매한 주기에
 * 전액이 든다. 그래서 주기마다 `billed` 와 `usage` 가 크게 갈릴 수 있다.
 */
export function creditUsagePeriods(input: CreditUsageInput): CreditUsageResult {
  const { statementClosingDay, paymentDueDay, timeZone, span } = input;
  const now = input.now ?? new Date();

  /*
   * 마감 연월 -> 금액. 두 벌을 따로 센다.
   *
   * `billed` 는 그 주기에 청구되는 전부이고, `usage` 는 그중 실적에 드는 것만이다.
   * 실적에서 뺀 거래가 있으면 둘이 갈리는데, 한 값으로 두면 그래프가 남은 대금과
   * 어긋난다 -- 청구는 되었는데 그래프에는 없는 돈이 생긴다.
   */
  const billedByMonth = new Map<string, Dec>();
  const usageByMonth = new Map<string, Dec>();
  const add = (into: Map<string, Dec>, key: string, amount: Dec) => {
    into.set(key, (into.get(key) ?? Dec.of(0)).plus(amount));
  };

  for (const posting of input.postings) {
    /*
     * 청구와 실적을 각자의 함수로 낸다. 두 값은 나뉘는 방식부터 다르다 -- 청구는 할부
     * 회차만큼 뒤 주기로 퍼지고, 실적은 결제한 주기에 전액이 든다.
     *
     * 나누는 규칙은 목록을 그리는 쪽(청구 내역·실적 원장)과 한 함수에 둔다. 두 벌로
     * 두면 줄마다 적히는 값과 주기 합계가 갈린다.
     */
    for (const share of billedShares(posting, statementClosingDay, timeZone)) {
      add(billedByMonth, share.closingKey, Dec.of(share.amount));
    }
    for (const share of creditPerformanceShares(posting, statementClosingDay, timeZone)) {
      add(usageByMonth, share.closingKey, Dec.of(share.amount));
    }
  }
  // 주기를 만들 때는 청구가 잡힌 달을 본다. 실적만 있는 달은 있을 수 없다.
  const byMonth = billedByMonth;

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
      closingKey: closingMonthKey(cursor),
      periodStart: period.periodStart.toISOString(),
      periodEnd: period.periodEnd.toISOString(),
      dueDate: period.dueDate.toISOString(),
      closed: period.periodEnd.getTime() < todayMarker,
      usage: (usageByMonth.get(closingMonthKey(cursor)) ?? Dec.of(0)).toString(),
      billed: (billedByMonth.get(closingMonthKey(cursor)) ?? Dec.of(0)).toString(),
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

  // 신용카드와 같은 규칙으로 두 벌을 센다 (청구 전부 / 실적에 드는 것만).
  const billedByMonth = new Map<string, Dec>();
  const usageByMonth = new Map<string, Dec>();
  for (const posting of input.postings) {
    const key = zonedYearMonth(asDate(posting.date), timeZone);
    const amount = Dec.of(posting.amount).negated();
    billedByMonth.set(key, (billedByMonth.get(key) ?? Dec.of(0)).plus(amount));
    // 실적 쪽은 실적 원장과 같은 함수로 낸다 (차감을 되살리는 규칙이 한 곳에 있다).
    for (const share of debitPerformanceShares(posting, timeZone)) {
      const at = share.closingKey;
      usageByMonth.set(at, (usageByMonth.get(at) ?? Dec.of(0)).plus(Dec.of(share.amount)));
    }
  }

  const [thisYear, thisMonth] = zonedYearMonth(now, timeZone).split('-').map(Number);
  const periods: CardDto.UsagePeriod[] = [];

  for (let offset = span - 1; offset >= 0; offset -= 1) {
    const cursor = new Date(Date.UTC(thisYear, thisMonth - 1 - offset, 1));
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth() + 1;
    const key = `${year}-${String(month).padStart(2, '0')}`;

    periods.push({
      closingKey: key,
      // 달력 날짜 표시자. 청구 주기 쪽과 같은 형태로 맞춘다 (그 달 1일 ~ 말일).
      periodStart: new Date(Date.UTC(year, month - 1, 1)).toISOString(),
      periodEnd: new Date(Date.UTC(year, month, 0)).toISOString(),
      // 이번 달만 아직 늘어날 수 있다.
      closed: offset > 0,
      usage: (usageByMonth.get(key) ?? Dec.of(0)).toString(),
      billed: (billedByMonth.get(key) ?? Dec.of(0)).toString(),
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
 * 이 할부가 회차마다 청구하는 원금.
 *
 * 사용자가 적어 둔 값이 있으면 그것이 사실이다. 끝수를 어느 회차에 몰아주는지는
 * 카드사마다 달라, 계산으로는 명세서와 맞출 수 없는 자리가 있다.
 *
 * 적어 둔 값의 길이가 개월수와 다르면 버린다. 금액이나 개월수를 고친 뒤 남은 옛 값이라,
 * 그대로 쓰면 회차 합이 결제 금액과 어긋난다.
 */
export function installmentPrincipals(
  total: DecInput,
  months: number,
  shares?: readonly DecInput[] | null,
): Dec[] {
  if (shares && shares.length === months) {
    /*
     * 읽을 수 없는 값이 섞여 있으면 통째로 버리고 나눈다.
     *
     * 적어 둔 값은 JSON 칸에 담겨 오므로 무엇이든 들어올 수 있다. 한 칸 때문에 카드
     * 화면이 통째로 넘어지는 것보다, 나눈 값으로 그리고 사용자가 다시 적는 편이 낫다.
     */
    const parsed = toDecList(shares);
    if (parsed) return parsed;
  }
  return splitInstallment(total, months);
}

/** 전부 십진값으로 읽히면 그 목록, 하나라도 아니면 null. */
function toDecList(shares: readonly DecInput[]): Dec[] | null {
  const parsed: Dec[] = [];
  for (const share of shares) {
    try {
      parsed.push(Dec.of(share));
    } catch {
      return null;
    }
  }
  return parsed;
}

/**
 * 할부 회차 금액의 기본값. 나누어떨어지지 않는 끝수는 첫 회차에 몰아준다.
 * 10,000원 3개월이면 3,334 / 3,333 / 3,333 이 된다.
 *
 * 카드사가 끝수를 마지막 회차에 붙이는 경우도 있다. 그때는 사용자가 회차 금액을 직접
 * 적고, 그 값이 이 기본값을 대신한다 (`installmentPrincipals`).
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
