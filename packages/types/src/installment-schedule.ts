/**
 * 유이자 할부의 회차별 원금과 이자.
 *
 * 무이자 할부는 나눌 것이 원금뿐이라 `splitInstallment` 하나로 끝난다. 유이자는
 * 카드사가 두 가지 방식 중 하나로 청구한다.
 *
 * - **고정형**: 매달 같은 금액을 낸다. 낸 돈에서 이자를 먼저 떼고 남은 것이 원금이라,
 *   첫 회차는 원금을 조금 갚고 이자를 많이 내며 뒤로 갈수록 뒤집힌다 (원리금균등).
 * - **변동형**: 연이율만 정해져 있다. 원금은 개월수로 고르게 나누고, 이자는 그때
 *   남아 있는 원금에 월할로 붙는다. 그래서 매달 내는 돈이 조금씩 줄어든다.
 *
 * 여기서 내는 값은 **기본값**이다. 카드사마다 끝수를 붙이는 자리가 다르고 수수료를
 * 올림하는 규칙도 달라, 명세서와 다르면 사용자가 회차 표에서 고쳐 적는다.
 */

import { Dec, type DecInput } from './decimal';
import { installmentInterestTotal, installmentInterests, splitInstallment } from './card-usage';
import { shiftYearMonth } from './report-aggregation';
import { clampDayOfMonth, zonedDayStart, zonedParts, zonedYearMonth } from './tz';

/** 회차별 원금과 이자. 두 배열의 길이는 개월수와 같다. */
export interface InstallmentSchedule {
  /** 회차마다 갚는 원금. 합은 언제나 총액과 같다. */
  principals: Dec[];
  /** 회차마다 붙는 이자. 무이자면 전부 0 이다. */
  interests: Dec[];
}

/**
 * 금액을 자르는 자릿수. 원 단위다.
 *
 * `splitInstallment` 과 같은 규칙이다. 소수 통화의 할부는 아직 다루지 않는다 --
 * 외화 결제도 카드에 청구되는 금액(기준통화)을 나누므로 여기까지 오지 않는다.
 */
const MONEY_SCALE = 0;

/** 이자가 0인 일정. 무이자 할부와 이율이 0인 유이자 할부가 같은 값을 받는다. */
export function freeSchedule(
  total: DecInput,
  months: number,
  principals?: readonly DecInput[] | null,
): InstallmentSchedule {
  const shares = principalsOf(total, months, principals);
  return { principals: shares, interests: shares.map(() => Dec.of(0)) };
}

/**
 * 고정형: 월 납입액에서 회차별 원금과 이자를 뽑는다.
 *
 * 카드사가 알려 주는 것은 "10,000원을 3개월, 매달 4,000원"처럼 낼 금액뿐이라, 이율을
 * 되짚어야 회차마다의 이자가 나온다. 총액 = 납입액 × (1 - (1+r)^-n) / r 을 r 에 대해
 * 풀 수 없어 이분법으로 좁힌다. **r 은 금액이 아니라 비율**이라 부동소수로 구해도
 * 원 단위가 흔들리지 않는다 -- 그 값으로 매기는 이자는 다시 Dec 으로 반올림한다.
 *
 * 마지막 회차의 원금은 남은 잔액 그대로다. 반올림이 몇 원씩 쌓여도 원금 합이 결제
 * 금액과 어긋나지 않아야 하기 때문이다 (합이 다르면 저장이 막힌다).
 *
 * 낼 돈의 합이 총액보다 적거나, 이율이 월 100%를 넘을 만큼 커서 풀리지 않으면
 * null 을 낸다. 부르는 쪽이 칸을 비워 두고 사용자에게 맡긴다.
 */
export function fixedPaymentSchedule(
  total: DecInput,
  months: number,
  monthlyPayment: DecInput,
): InstallmentSchedule | null {
  const amount = Dec.of(total);
  const payment = Dec.of(monthlyPayment);
  if (months < 1 || !amount.isPositive() || !payment.isPositive()) return null;

  // 낸 돈의 합이 산 값에 못 미치면 할부가 아니다. 이율을 아무리 낮춰도 풀리지 않는다.
  const paid = payment.times(months);
  if (paid.lt(amount)) return null;
  if (paid.eq(amount)) return freeSchedule(amount, months);

  const rate = solveMonthlyRate(amount.toNumber(), months, payment.toNumber());
  if (rate === null) return null;

  const principals: Dec[] = [];
  const interests: Dec[] = [];
  let balance = amount;
  for (let index = 0; index < months; index += 1) {
    const interest = balance.times(rate.toFixed(12)).round(MONEY_SCALE);
    /*
     * 마지막 회차는 남은 원금을 다 갚는다. 그 앞은 낸 돈에서 이자를 뗀 나머지이되,
     * 남은 원금을 넘지 않는다 -- 반올림이 쌓여 마지막 회차가 음수가 되지 않게 한다.
     */
    const last = index === months - 1;
    const principal = last
      ? balance
      : minOf(maxOf(payment.minus(interest), Dec.of(0)), balance);
    principals.push(principal);
    interests.push(interest);
    balance = balance.minus(principal);
  }
  return { principals, interests };
}

/**
 * 변동형: 연이율에서 회차별 이자를 매긴다. 원금은 무이자와 같이 고르게 나눈다.
 *
 * 이자는 **그 회차가 시작할 때 남아 있는 원금**에 월이율(연이율 / 12)을 곱한 값이다.
 * 원금이 줄어드는 만큼 이자도 줄어, 매달 내는 돈이 조금씩 가벼워진다.
 *
 * 사용자가 회차 원금을 고쳐 두었으면 그것을 딛고 이자를 매긴다. 끝수를 마지막 회차에
 * 몰아주는 카드에서 이자까지 함께 맞으려면 두 값이 같은 표에서 나와야 한다.
 */
export function annualRateSchedule(
  total: DecInput,
  months: number,
  annualRatePercent: DecInput,
  principals?: readonly DecInput[] | null,
): InstallmentSchedule | null {
  const amount = Dec.of(total);
  const rate = Dec.of(annualRatePercent);
  if (months < 1 || !amount.isPositive() || rate.isNegative()) return null;

  const shares = principalsOf(amount, months, principals);
  // 연이율은 퍼센트로 받는다. 12.0 이면 월 1%다.
  const monthlyRate = rate.dividedBy(1200, 12);

  const interests: Dec[] = [];
  let balance = amount;
  for (const principal of shares) {
    interests.push(balance.times(monthlyRate).round(MONEY_SCALE));
    balance = balance.minus(principal);
  }
  return { principals: shares, interests };
}

/**
 * 적어 둔 회차 원금이 있으면 그것, 없으면 개월수로 나눈 값.
 *
 * 개수가 개월수와 다르면 버린다. 금액이나 개월수를 고친 뒤 남은 옛 값이라
 * (`installmentPrincipals` 과 같은 판단이다).
 */
function principalsOf(
  total: DecInput,
  months: number,
  principals?: readonly DecInput[] | null,
): Dec[] {
  if (principals && principals.length === months) {
    try {
      return principals.map((value) => Dec.of(value));
    } catch {
      // 읽을 수 없는 값이 섞였다. 통째로 버리고 나눈다.
    }
  }
  return splitInstallment(total, months);
}

/**
 * 총액·개월수·월 납입액에서 월이율을 되짚는다. 찾지 못하면 null.
 *
 * 납입액의 현재가치는 이율이 오를수록 작아진다. 그래서 "0%일 때는 총액보다 크고
 * 상한에서는 총액보다 작다"는 것만 확인하면 그 사이에 답이 하나 있다. 60번 쪼개면
 * 폭이 2^-60 이라 원 단위로는 더 좁힐 것이 없다.
 */
function solveMonthlyRate(total: number, months: number, payment: number): number | null {
  const presentValue = (rate: number) => (payment * (1 - Math.pow(1 + rate, -months))) / rate;

  // 월 100%. 여기서도 총액에 못 미치면 사람이 잘못 적은 것이다.
  const upper = 1;
  if (presentValue(upper) > total) return null;

  let low = 0;
  let high = upper;
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    if (presentValue(mid) > total) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

function minOf(a: Dec, b: Dec): Dec {
  return a.lte(b) ? a : b;
}

function maxOf(a: Dec, b: Dec): Dec {
  return a.gte(b) ? a : b;
}

/** 할부 한 건이 어느 달에 얼마를 물리는가. 회차 하나에 한 줄이다. */
export interface InstallmentMonthShare {
  /** 그 회차가 서는 달력 월 ("YYYY-MM"). */
  yearMonth: string;
  /** 회차 번호. 1부터 센다. */
  index: number;
  months: number;
  /** 그 회차에 나가는 돈. 원금과 이자를 더한 값이고, 합은 전표 금액과 같다. */
  amount: string;
  /** 그 회차의 원금. */
  principal: string;
  /** 그 회차의 이자. 적어 둔 것이 없으면 "0" 이다. */
  interest: string;
}

/**
 * 할부를 **달력 월**로 편다. 1회차가 산 달이고, 그 뒤로 한 달에 하나씩이다.
 *
 * 카드 마감 주기가 아니라 달력 월로 세는 까닭은 일시불과 규칙을 맞추기 위해서다.
 * 카드 지출은 쓴 달에 잡히고 다음 달 결제대금은 지출이 아닌데, 회차만 결제일 달로
 * 옮기면 같은 카드의 두 거래가 다른 규칙을 따른다. 마감일이 말일이 아닌 카드에서는
 * 카드 상세의 청구 내역(`billedShares`)과 한 달 어긋날 수 있다 -- 그쪽은 명세서를
 * 맞추는 화면이고 이쪽은 생활비를 세는 화면이라, 쓰임이 다르다.
 */
export function installmentMonthShares(input: {
  /** 산 시각. */
  date: Date | string;
  /**
   * 카드에 청구된 총액. 양수로 준다. **이자가 들어 있는 값**이다.
   *
   * 전표 금액이 곧 이 값이라, 회차 원금은 여기서 이자 합을 뺀 것을 나눈다. 그래야
   * 회차마다의 원금과 이자를 더한 합이 전표 금액과 정확히 같다.
   */
  total: DecInput;
  months: number;
  /** 사용자가 적어 둔 회차 원금. 없으면 개월수로 나눈다. */
  principals?: readonly DecInput[] | null;
  /** 적어 둔 회차 이자. 없으면 전부 0 이다. */
  interests?: readonly DecInput[] | null;
  timeZone: string;
}): InstallmentMonthShare[] {
  const { date, total, months, principals, interests, timeZone } = input;
  if (months < 1) return [];

  /*
   * 이자는 개수가 맞을 때만 쓴다. 개월수를 고친 뒤 남은 옛 값이면 어느 회차의 것인지
   * 알 수 없어, 없는 것으로 보고 0 으로 센다.
   */
  const interestList = installmentInterests(interests, months);
  const principalTotal = Dec.of(total).minus(installmentInterestTotal(interests, months));
  const principalList = principalsOf(principalTotal, months, principals);

  const purchase = zonedYearMonth(date instanceof Date ? date : new Date(date), timeZone);
  const [year, month] = purchase.split('-').map(Number);

  return principalList.map((principal, offset) => {
    const interest = interestList?.[offset] ?? Dec.of(0);
    return {
      yearMonth: shiftYearMonth(year, month, offset),
      index: offset + 1,
      months,
      amount: principal.plus(interest).toString(),
      principal: principal.toString(),
      interest: interest.toString(),
    };
  });
}

/**
 * 한 분류 줄의 금액을 회차대로 나눈다. 합은 언제나 준 금액과 같다.
 *
 * 분할 거래에서 쓴다. 할부는 결제 한 건에 걸리는데 분류는 여럿일 수 있어, 줄마다
 * 회차 몫을 따로 내야 "식비 3개월 할부"가 달마다 식비로 선다. 회차 원금의 비율로
 * 나누고 **누적값을 반올림해 차이를 취한다** -- 회차마다 따로 반올림하면 끝수가
 * 쌓여 줄의 합이 결제 금액과 어긋난다.
 */
export function installmentLineShares(
  lineAmount: DecInput,
  principals: readonly DecInput[],
): Dec[] {
  const amount = Dec.of(lineAmount);
  const values = principals.map((value) => Dec.of(value));
  const total = values.reduce<Dec>((acc, value) => acc.plus(value), Dec.of(0));
  // 전액이 깎여 0원이 된 할부. 나눌 것이 없으므로 회차마다 0 이다.
  if (total.isZero()) return values.map(() => Dec.of(0));

  const shares: Dec[] = [];
  let running = Dec.of(0);
  let paid = Dec.of(0);
  for (let index = 0; index < values.length; index += 1) {
    running = running.plus(values[index]);
    const upto =
      index === values.length - 1
        ? amount
        : amount.times(running).dividedBy(total, MONEY_SCALE);
    shares.push(upto.minus(paid));
    paid = upto;
  }
  return shares;
}

/**
 * 회차 줄이 서는 날. 산 날의 며칟날을 그 달로 옮긴다.
 *
 * 1회차는 산 날 그대로다 -- 같은 날 적은 다른 거래와 차례가 어긋나지 않는다. 말일이
 * 없는 달(1월 31일 구매의 2월 회차)은 그 달의 마지막 날이다.
 *
 * 회차에는 원래 정해진 날이 없다. 그래도 날을 정해 두는 까닭은 날짜별 합계 때문이다 --
 * 달의 첫날로 몰면 그 하루만 부풀고, 산 날과 같은 날에 세면 달마다 같은 자리에 선다.
 */
export function installmentRowDate(
  date: Date | string,
  offset: number,
  timeZone: string,
): Date | string {
  if (offset === 0) return date;

  const instant = date instanceof Date ? date : new Date(date);
  const parts = zonedParts(instant, timeZone);
  const shifted = shiftYearMonth(parts.year, parts.month, offset);
  const [year, month] = shifted.split('-').map(Number);
  return zonedDayStart(year, month, clampDayOfMonth(year, month, parts.day), timeZone);
}
