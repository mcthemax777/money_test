/**
 * 카드 주기 원장의 줄을 화면 글자로 옮기는 규칙.
 *
 * 실적 원장과 청구 내역이 같은 줄 모양을 쓰는데, 할부를 적는 방식만 갈린다. 두 화면이
 * 따로 적으면 웹과 앱에서 같은 줄에 다른 글자가 붙으므로 여기 한 곳에 둔다.
 */
import {
  annualRateSchedule,
  fixedPaymentSchedule,
  installmentInterestTotal,
  installmentPrincipals,
  type CardDto,
} from '@money/types';

import type { MessageKey } from './i18n';

/** 화면이 그대로 `t(key, params)` 에 넘길 수 있는 꼴. */
export interface LedgerBadge {
  key: MessageKey;
  params: Record<string, number>;
}

/**
 * 줄에 붙일 할부 배지. 일시불이면 없다.
 *
 * 청구 줄에는 회차가 실려 있어 "3/24회차"로 적는다. 그 줄이 왜 이번 달 대금에 들었는지가
 * 그 한 마디로 드러난다. 실적 줄에는 회차라는 것이 없다 -- 실적은 결제한 주기에 전액이
 * 들어가므로 개월수만 적는다.
 */
export function installmentBadge(
  row: Pick<CardDto.PeriodLedgerRow, 'installmentIndex' | 'installmentMonths'>,
): LedgerBadge | null {
  if (row.installmentMonths <= 1) return null;

  return row.installmentIndex
    ? {
        key: 'assets.billedInstallment',
        params: { index: row.installmentIndex, months: row.installmentMonths },
      }
    : { key: 'assets.performanceInstallment', params: { months: row.installmentMonths } };
}

/**
 * 거래 상세에 적을 할부 한 마디. 일시불이면 없다.
 *
 * 개월수만으로는 모자란다. 유이자 할부는 **이자가 금액에 들어 있으므로**, 그 거래를
 * 열었을 때 "왜 산 값보다 큰가"의 답이 여기 있어야 한다. 그래서 적어 둔 이자가 있으면
 * 얼마가 이자인지 함께 적는다 -- "3개월 할부 · 유이자 · 이자 6,000 포함".
 *
 * 금액을 글자로 옮기는 일은 부르는 쪽이 한다(`formatAmount`). 표시 통화를 아는 것은
 * 화면이고, 주지 않으면 개월수와 종류만 적는다.
 */
export function installmentLabel(
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
  entry: {
    installmentMonths: number | null;
    installmentInterest: boolean | null;
    installmentInterestShares?: readonly string[] | null;
  },
  formatAmount?: (amount: string) => string,
): string | null {
  if (!entry.installmentMonths) return null;

  const months = t('tx.detail.installmentMonths', { months: entry.installmentMonths });
  const kind = t(entry.installmentInterest ? 'editor.installmentInterest' : 'editor.installmentFree');

  const interest = installmentInterestTotal(entry.installmentInterestShares, entry.installmentMonths);
  if (!formatAmount || interest.isZero()) return `${months} · ${kind}`;

  const included = t('tx.detail.installmentInterestIncluded', {
    amount: formatAmount(interest.toString()),
  });
  return `${months} · ${kind} · ${included}`;
}

/**
 * 회차 금액 칸에 채울 값.
 *
 * 사용자가 적어 둔 값이 있으면 그것이고, 없으면 개월수로 나눈 기본값이다. 빈 칸으로
 * 두지 않는 까닭은 고칠 것이 한두 회차뿐이기 때문이다 -- 기본값을 보여 주고 다른
 * 자리만 고치게 한다.
 */
export function installmentShareInputs(
  total: string,
  months: number,
  saved: readonly string[] | null | undefined,
): string[] {
  if (!months || months < 2) return [];

  /*
   * 손댄 값은 글자 그대로 돌려준다. **숫자로 읽지 않는다.**
   *
   * 여기 오는 값은 사용자가 치고 있는 중의 글자라 빈 칸이나 "1," 같은 도막이 섞인다.
   * 그것을 십진값으로 읽으려 하면 한 칸을 지우는 순간 화면이 넘어진다.
   *
   * 개수가 개월수와 다르면 손댄 값을 버린다 -- 개월수를 바꾼 뒤라 어느 회차의 값인지
   * 알 수 없다.
   */
  if (saved && saved.length === months) return [...saved];

  return installmentPrincipals(total || '0', months).map((share) => share.toString());
}

/**
 * 유이자 할부에서 이자를 어떻게 정하는가.
 *
 * `''` 는 아직 고르지 않았다는 뜻이다. 그때는 이자 칸이 비어 있고, 사용자가 명세서를
 * 보고 회차마다 손으로 적는다 -- 지금까지의 동작이다.
 */
export type InstallmentInterestMode = '' | 'fixed' | 'rate';

/**
 * 회차 이자 칸에 채울 값.
 *
 * 고른 방식대로 계산한 **기본값**이고, 사용자가 한 칸이라도 고치면 그 값이 그대로
 * 남는다 (`saved`). 명세서와 다르면 고쳐 적는 자리라, 계산은 처음 채워 주는 데까지다.
 *
 * 방식을 고르지 않았으면 빈 칸을 돌려준다. 0 으로 채우면 "이자 없음"을 적은 것과
 * 같아져, 아직 모르는 것과 없는 것이 구별되지 않는다.
 */
export function installmentInterestInputs(input: {
  /** 카드에 청구되는 총액 (폼의 금액 칸). */
  total: string;
  months: number;
  /** 회차 원금 칸의 현재 값. 변동형의 이자가 이 값을 딛고 매겨진다. */
  principals: readonly string[];
  mode: InstallmentInterestMode;
  /** 고정형의 월 납입액. */
  monthlyPayment: string;
  /** 변동형의 연이율 (퍼센트). */
  annualRate: string;
  /** 사용자가 고쳐 둔 값. 개수가 맞으면 그대로 쓴다. */
  saved: readonly string[] | null | undefined;
}): string[] {
  const { total, months, principals, mode, monthlyPayment, annualRate, saved } = input;
  if (!months || months < 2) return [];
  // 고친 값은 글자 그대로 돌려준다. 치는 중의 도막이 섞여 있어 숫자로 읽지 않는다.
  if (saved && saved.length === months) return [...saved];

  const blank = Array.from({ length: months }, () => '');
  const schedule =
    mode === 'fixed'
      ? fixedPaymentSchedule(total || '0', months, clean(monthlyPayment) || '0')
      : mode === 'rate'
        ? annualRateSchedule(total || '0', months, clean(annualRate) || '0', readable(principals))
        : null;
  if (!schedule) return blank;

  return schedule.interests.map((interest) => interest.toString());
}

/**
 * 회차 원금 칸을 십진값으로 읽는다. 한 칸이라도 읽히지 않으면 없는 것으로 본다.
 *
 * 치는 중에는 빈 칸과 도막이 섞인다. 그 값으로 이자를 매기면 남은 원금이 실제와
 * 달라져, 고치던 칸을 지우는 순간 이자가 튄다 -- 그때는 개월수로 나눈 값을 쓴다.
 */
function readable(principals: readonly string[]): string[] | null {
  const values = principals.map((value) => clean(value));
  return values.every((value) => value !== '' && Number.isFinite(Number(value))) ? values : null;
}

/** 자릿수 쉼표를 뗀다. 사람이 치는 칸이라 "1,000" 이 들어온다. */
function clean(value: string): string {
  return String(value ?? '').replace(/,/g, '').trim();
}

/** 적어 넣은 회차 금액의 합. 화면이 결제 금액과 견줘 보여 준다. */
export function installmentShareTotal(shares: readonly string[]): string {
  return shares
    .reduce((acc, share) => acc + (Number(String(share).replace(/,/g, '')) || 0), 0)
    .toString();
}
