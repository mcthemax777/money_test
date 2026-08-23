/**
 * 금액 표시 헬퍼.
 *
 * 서버는 금액을 문자열로 보낸다 (Prisma Decimal 기본 직렬화).
 * JSON 숫자는 자바스크립트에서 double이라 정밀도 보장이 없기 때문이다.
 * 합산은 전부 서버(/reports/*)에서 끝나므로, 화면은 표시 직전에만 숫자로 바꾼다.
 */
import { formatMoney } from '@money/types';


/** 표시·비교용 숫자 변환. 합산 용도로 쓰지 말 것 (그건 서버 몫이다). */
export function toNumber(amount: string | number | null | undefined): number {
  if (amount === null || amount === undefined || amount === '') return 0;
  const value = Number(amount);
  return Number.isFinite(value) ? value : 0;
}

/**
 * "₩1,234,567" / "$1,234.56" / "￥1,234"
 *
 * 통화를 생략하면 원으로 본다. 화면 대부분은 기준통화(환산액)를 그리므로
 * 인자 없이 부르고, 계좌 잔액처럼 그 계좌의 통화로 보여야 하는 곳만 넘긴다.
 * 자릿수 규칙은 `@money/types`가 통화별로 들고 있다.
 */
export function formatCurrency(
  amount: string | number | null | undefined,
  currency: string = 'KRW',
): string {
  return formatMoney(toNumber(amount), currency);
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

  const rate = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(
    Number(entry.exchangeRate),
  );
  return `${original} · 환율 ${rate}`;
}

/** 부호 없는 천 단위 구분. 입력 폼 등에서 사용 */
export function formatNumber(amount: string | number | null | undefined): string {
  return new Intl.NumberFormat('ko-KR').format(toNumber(amount));
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
