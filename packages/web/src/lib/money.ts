/**
 * 금액 표시 헬퍼.
 *
 * 서버는 금액을 문자열로 보낸다 (Prisma Decimal 기본 직렬화).
 * JSON 숫자는 자바스크립트에서 double이라 정밀도 보장이 없기 때문이다.
 * 합산은 전부 서버(/reports/*)에서 끝나므로, 화면은 표시 직전에만 숫자로 바꾼다.
 */
import {
  currencyDecimals,
  formatMoney,
  isCurrencyCode,
  type CurrencyCode,
} from '@money/types';

import { activeLocale, activeLocaleTag, translate, type MessageKey } from '@/lib/i18n';

/**
 * 금액 뒤에 붙여 읽는 통화 이름의 열쇠.
 *
 * `@money/types`의 CURRENCY_UNIT은 한국어 이름만 갖는다. 그 값은 서버도 쓰므로
 * 언어를 아는 화면 쪽에서 다시 적는다. 모르는 통화는 코드를 그대로 띄어 쓴다.
 */
const UNIT_KEY: Record<CurrencyCode, MessageKey> = {
  KRW: 'currencyUnit.KRW',
  USD: 'currencyUnit.USD',
  JPY: 'currencyUnit.JPY',
};


/** 표시·비교용 숫자 변환. 합산 용도로 쓰지 말 것 (그건 서버 몫이다). */
export function toNumber(amount: string | number | null | undefined): number {
  if (amount === null || amount === undefined || amount === '') return 0;
  const value = Number(amount);
  return Number.isFinite(value) ? value : 0;
}

/**
 * "₩1,234,567" / "$1,234.56" / "￥1,234"
 *
 * 통화는 반드시 넘긴다. 기본값을 두면 표시 통화가 달러일 때도 원 기호와 원의
 * 자릿수(소수 0자리)로 찍혀 값이 반올림돼 버리는데, 호출부만 봐서는 이 누락을
 * 알아챌 수 없다. 화면 대부분은 프로젝트의 표시 통화(`useProjectDisplayCurrency`)를
 * 넘기고, 계좌 잔액처럼 그 계좌의 통화로 보여야 하는 곳만 계좌 통화를 넘긴다.
 * 자릿수 규칙은 `@money/types`가 통화별로 들고 있다.
 */
export function formatCurrency(
  amount: string | number | null | undefined,
  currency: string,
): string {
  return formatMoney(toNumber(amount), currency);
}

/**
 * "100,000원" / "50.00달러" — 기호 없이 이름을 뒤에 붙인 금액.
 *
 * 문장으로 읽히는 자리에 쓴다. 기호를 앞에 두면 "₩100,000 입니다"처럼 읽는 차례와
 * 적는 차례가 어긋난다. 모르는 통화는 코드를 띄어 쓴다 ("100.00 CHF").
 */
export function formatAmountWithUnit(
  amount: string | number | null | undefined,
  currency: string,
): string {
  const locale = activeLocale();
  const digits = currencyDecimals(currency);
  const value = new Intl.NumberFormat(activeLocaleTag(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(toNumber(amount));

  if (!isCurrencyCode(currency)) return `${value} ${currency}`;

  return translate(locale, 'money.amountWithUnit', {
    value,
    unit: translate(locale, UNIT_KEY[currency]),
  });
}

/**
 * 외화가 얽힌 거래의 부제. `($50.00 · 1,380원)` 형태.
 * 외화가 아니면 빈 문자열이라 화면이 분기하지 않아도 된다.
 */
export function formatOriginal(entry: {
  originalCurrency?: string | null;
  originalAmount?: string | null;
  exchangeRate?: string | null;
}): string {
  if (!entry.originalCurrency || !entry.originalAmount) return '';

  const original = formatMoney(entry.originalAmount, entry.originalCurrency);
  if (!entry.exchangeRate) return original;

  const value = Number(entry.exchangeRate);
  if (!Number.isFinite(value) || value <= 0) return original;

  const rate = new Intl.NumberFormat(activeLocaleTag(), {
    maximumFractionDigits: rateDecimals(value),
  }).format(value);
  return `${original} · ${translate(activeLocale(), 'money.rate', { rate })}`;
}

/**
 * 환율을 몇 자리까지 적을지.
 *
 * 소수 두 자리로 고정하면 원 -> 달러처럼 1보다 훨씬 작은 환율이 전부 "0"으로 찍힌다.
 * 표시 통화를 달러로 바꾼 순간 모든 거래 옆에 "환율 0"이 붙었다.
 * 유효숫자가 드러나는 자리까지 늘리되, 너무 길어지지 않게 여덟 자리에서 자른다.
 */
function rateDecimals(rate: number): number {
  if (rate >= 1) return 2;
  return Math.min(8, Math.ceil(-Math.log10(rate)) + 3);
}

/**
 * 통화 고르는 목록에 적을 이름. "원 (KRW)" / "won (KRW)" / "ウォン (KRW)".
 *
 * `@money/types`의 CURRENCY_LABEL은 한국어 이름으로 굳어 있다. 코드를 괄호에 함께
 * 적는 것은 이름을 모르는 사용자도 KRW·USD로 알아볼 수 있게 하려는 것이다.
 */
export function currencyLabel(currency: CurrencyCode): string {
  return `${translate(activeLocale(), UNIT_KEY[currency])} (${currency})`;
}

/** 부호 없는 천 단위 구분. 입력 폼 등에서 사용 */
export function formatNumber(amount: string | number | null | undefined): string {
  return new Intl.NumberFormat(activeLocaleTag()).format(toNumber(amount));
}

/** 입력값(문자열/숫자)을 서버로 보낼 금액 문자열로 정규화한다. */
export function toAmountString(input: string | number | null | undefined): string {
  if (input === null || input === undefined || input === '') return '0';
  // 사용자가 "1,000" 처럼 입력할 수 있다
  const cleaned = String(input).replace(/,/g, '').trim();
  const value = Number(cleaned);
  return Number.isFinite(value) ? String(value) : '0';
}

/** 지출은 빨강, 수입은 파랑 등 부호 기반 표시에 사용 */
export function isPositive(amount: string | number | null | undefined): boolean {
  return toNumber(amount) > 0;
}
