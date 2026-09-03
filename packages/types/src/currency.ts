/**
 * 지원 통화와 환산 규칙.
 *
 * 원장은 통화를 두 층으로 다룬다.
 *   - posting의 `amount`는 그것이 가리키는 대상의 통화다. 계좌 다리는 그 계좌의
 *     통화, 카테고리 다리는 프로젝트 기준통화.
 *   - `baseAmount`는 기준통화로 환산한 값이고, 전표의 균형(합계 0)은 이 값으로
 *     판정한다. 통화가 섞인 전표는 `amount` 합계가 0이 될 수 없기 때문이다.
 *
 * 그래서 "8월 지출"처럼 통화를 가로지르는 집계는 전부 `baseAmount`를 더한다.
 * 반대로 계좌 잔액은 그 계좌 통화 그대로 보여야 하므로 `amount`를 쓴다.
 */

export const SUPPORTED_CURRENCIES = ['KRW', 'USD', 'JPY'] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

/** 통화별 소수 자릿수. 원과 엔은 보조 단위를 쓰지 않는다. */
const CURRENCY_DECIMALS: Record<CurrencyCode, number> = {
  KRW: 0,
  USD: 2,
  JPY: 0,
};

/** 금액 뒤에 붙여 읽는 이름. "100,000원", "50.00달러"처럼 쓴다. */
export const CURRENCY_UNIT: Record<CurrencyCode, string> = {
  KRW: '원',
  USD: '달러',
  JPY: '엔',
};

export const CURRENCY_LABEL: Record<CurrencyCode, string> = {
  KRW: `${CURRENCY_UNIT.KRW} (KRW)`,
  USD: `${CURRENCY_UNIT.USD} (USD)`,
  JPY: `${CURRENCY_UNIT.JPY} (JPY)`,
};

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

/**
 * 금액 뒤에 붙일 이름. 모르는 코드는 코드를 그대로 쓴다.
 *
 * 기호(₩, $)를 앞에 두는 대신 이름을 뒤에 두면 "십만 원입니다"처럼 읽는 차례대로
 * 적힌다. 화면에서 문장으로 읽히는 자리에 쓴다.
 */
export function currencyUnit(currency: string): string {
  return isCurrencyCode(currency) ? CURRENCY_UNIT[currency] : currency;
}

/** 그 통화가 쓰는 소수 자릿수. 모르는 코드는 2자리로 본다(가장 흔한 값). */
export function currencyDecimals(currency: string): number {
  return isCurrencyCode(currency) ? CURRENCY_DECIMALS[currency] : 2;
}

/**
 * 금액 표시. 서버가 문자열로 주는 값을 그대로 받는다.
 *
 * 통화를 넘기지 않으면 원으로 본다. 화면 어디서든 같은 규칙을 쓰도록
 * 이 함수 하나만 거치게 한다.
 */
/*
 * 통화마다 형식기 하나를 두고 다시 쓴다.
 *
 * **`new Intl.NumberFormat` 을 부를 때마다 만들면 안 된다.** 만드는 값이 쓰는 값보다
 * 훨씬 비싸다(Hermes 에서 밀리초 단위다). 거래 목록은 한 번 그릴 때 이 함수를 수백 번
 * 부르므로, 만들기를 없애는 것만으로 한 달 펼치기가 800ms 에서 눈에 띄게 내려간다.
 *
 * 통화 수가 손에 꼽으므로 지도가 자라지 않는다.
 */
const moneyFormatters = new Map<string, Intl.NumberFormat>();

function moneyFormatter(currency: string, digits: number): Intl.NumberFormat {
  const key = `${currency}|${digits}`;
  const cached = moneyFormatters.get(key);
  if (cached) return cached;

  const formatter = new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  moneyFormatters.set(key, formatter);
  return formatter;
}

export function formatMoney(
  amount: string | number | null | undefined,
  currency: string = 'KRW',
): string {
  const value = Number(amount ?? 0);
  const safe = Number.isFinite(value) ? value : 0;

  return moneyFormatter(currency, currencyDecimals(currency)).format(safe);
}

/**
 * 환율의 뜻을 한곳에 고정한다.
 *
 * `rate`는 **1 <from> = rate <to>** 다. USD -> KRW 가 1360이면 1달러가 1360원이다.
 * Posting.exchangeRate 도 같은 방향으로, "1 <posting 통화> = rate <기준통화>"이며
 * `baseAmount = amount * exchangeRate` 가 성립한다.
 */
export interface ExchangeRateInfo {
  from: CurrencyCode;
  to: CurrencyCode;
  /** 1 from = rate to */
  rate: string;
  /** 이 환율의 기준 날짜 ("YYYY-MM-DD"). 고정값이면 비어 있을 수 있다. */
  date?: string;
  /** 'manual' | 'fallback' | 그 밖에 가져온 곳 이름 */
  source: string;
}
