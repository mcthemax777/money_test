/**
 * 미확정 외화 결제를 화면에 올리는 셈.
 *
 * 원화 카드로 외화를 쓰면 청구액은 결제일에 카드사가 정한다(자기 환율 + 수수료).
 * 그때까지 원장에는 추정 환산액이 들어 있고, 명세서가 나오면 실제 청구액으로 확정한다.
 *
 * 웹과 앱이 같은 묶음·같은 반올림을 보여 줘야 해서 여기 둔다 -- 한쪽만 고치면 같은
 * 명세서를 두 화면에서 다르게 채우게 된다.
 */
import { currencyDecimals, type CardDto } from '@money/types';

import { toNumber } from './money';

/**
 * 주기별로 묶는다. 사용자가 대조하는 단위가 명세서 한 장이기 때문이다.
 *
 * 마감 연월("YYYY-MM")의 사전순이 곧 시간순이라 그대로 정렬한다.
 */
export function groupPendingByMonth(
  items: CardDto.PendingRateItem[],
): Array<[string, CardDto.PendingRateItem[]]> {
  const byMonth = new Map<string, CardDto.PendingRateItem[]>();
  for (const item of items) {
    byMonth.set(item.closingMonth, [...(byMonth.get(item.closingMonth) ?? []), item]);
  }
  return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/**
 * 적용환율 한 줄로 청구액 칸을 모두 채운다.
 *
 * 저장은 청구액으로 한 경로만 쓴다. 화면에 보이는 숫자와 저장되는 값이 같아야
 * 사용자가 저장 전에 확인할 수 있고, 반올림 결과도 미리 드러난다.
 *
 * 카드 통화의 자릿수로 맞춘다. 원은 원 단위, 달러는 센트까지다.
 */
export function billedFromRate(
  items: CardDto.PendingRateItem[],
  rate: number,
  currency: string,
): Record<string, string> {
  const decimals = currencyDecimals(currency);
  return Object.fromEntries(
    items.map((item) => [item.entryId, (toNumber(item.originalAmount) * rate).toFixed(decimals)]),
  );
}

/** 채워 넣은 것만. 빈 칸은 아직 명세서를 못 본 건이다. */
export function filledPendingItems(
  items: CardDto.PendingRateItem[],
  billed: Record<string, string>,
): CardDto.PendingRateItem[] {
  return items.filter((item) => toNumber(billed[item.entryId]) > 0);
}

/**
 * 확정하면 실제로 적용될 환율. 저장 전에 눈으로 확인할 수 있어야 한다.
 *
 * 채우지 않은 칸은 0이다. 부르는 쪽이 그때는 아무것도 적지 않는다.
 */
export function derivedRate(billedValue: string | undefined, originalAmount: string): number {
  const amount = toNumber(billedValue);
  if (amount <= 0) return 0;

  const original = toNumber(originalAmount);
  if (original <= 0) return 0;

  // 소수점 둘째 자리까지 보여 준다. 명세서의 적용환율도 그 자리까지 적힌다.
  return Math.round((amount / original) * 100) / 100;
}
