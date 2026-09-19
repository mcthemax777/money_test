/**
 * 카드 주기 원장의 줄을 화면 글자로 옮기는 규칙.
 *
 * 실적 원장과 청구 내역이 같은 줄 모양을 쓰는데, 할부를 적는 방식만 갈린다. 두 화면이
 * 따로 적으면 웹과 앱에서 같은 줄에 다른 글자가 붙으므로 여기 한 곳에 둔다.
 */
import { installmentPrincipals, type CardDto } from '@money/types';

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
 * 개월수만으로는 모자란다. 유이자 할부는 회차마다 수수료 전표가 따로 생기므로, 그
 * 거래를 열었을 때 "왜 수수료가 붙는가"의 답이 여기 있어야 한다.
 */
export function installmentLabel(
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
  entry: { installmentMonths: number | null; installmentInterest: boolean | null },
): string | null {
  if (!entry.installmentMonths) return null;

  const months = t('tx.detail.installmentMonths', { months: entry.installmentMonths });
  const kind = t(entry.installmentInterest ? 'editor.installmentInterest' : 'editor.installmentFree');
  return `${months} · ${kind}`;
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

/** 적어 넣은 회차 금액의 합. 화면이 결제 금액과 견줘 보여 준다. */
export function installmentShareTotal(shares: readonly string[]): string {
  return shares
    .reduce((acc, share) => acc + (Number(String(share).replace(/,/g, '')) || 0), 0)
    .toString();
}
