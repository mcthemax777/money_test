/**
 * 외화 결제의 청구액 확정. 서버와 기기가 함께 쓴다.
 *
 * 원화 카드로 외화를 쓰면 청구액은 명세서가 나와야 안다. 그때까지는 추정 환율로 적어 두고
 * (`rateProvisional`), 명세서를 받으면 실제 청구액으로 **다리 금액만** 다시 쓴다. 전표를
 * 새로 만들지 않으므로 줄 키·태그·차감은 그대로 남는다.
 *
 * 규칙을 한 벌로 두는 이유. 기기는 오프라인에서 확정한 결과를 사본에 먼저 적고, 서버는
 * 나중에 그 명령을 재생한다. 끝수를 어느 줄에 몰지가 두 자리에서 다르면 같은 거래의
 * 금액이 기기와 서버에서 1원씩 갈리고, 그 차이는 다음 pull 이 사본을 덮을 때에야 드러난다.
 */

import { currencyDecimals } from './currency';
import { Dec, type DecInput } from './decimal';
import type { CardDto } from './dtos';
import { closingMonthKey, closingMonthOf, periodForClosingMonth } from './statement-period';

/** 확정할 수 없는 사정. 서버는 400 으로, 기기는 그 자리의 오류로 낸다. */
export class RestateError extends Error {
  constructor(
    readonly code:
      | 'BILLED_NOT_POSITIVE'
      | 'ENTRY_NOT_FOUND'
      | 'NO_ORIGINAL_AMOUNT'
      | 'FOREIGN_LEG'
      | 'ZERO_ENTRY',
    message: string,
  ) {
    super(message);
    this.name = 'RestateError';
  }
}

/** 청구액을 다시 쓸 다리 하나. */
export interface RestatePosting {
  id: string;
  amount: DecInput;
  currency: string;
  /** 분류 줄의 신원. 끝수를 몰아줄 줄을 고를 때 쓴다 (계좌 다리는 null). */
  lineKey?: string | null;
}

/**
 * 총액을 가중치 비율로 나눈다. 끝수는 첫 항목에 몰아준다 (부르는 쪽이 차례를 정한다).
 *
 * 분할 지출을 확정할 때 줄마다 따로 반올림하면 합계가 총액에서 벗어나 전표 균형이 깨진다.
 * 그래서 나머지를 버린 뒤 남은 끝수를 한 곳에 몰아준다.
 */
export function allocateByWeight(total: Dec, weights: readonly Dec[], decimals: number): Dec[] {
  if (weights.length === 0) return [];
  if (weights.length === 1) return [total];

  const sum = Dec.sum(weights);
  const shares = weights.map((weight) => total.times(weight).dividedBy(sum, decimals, 'down'));
  shares[0] = shares[0].plus(total.minus(Dec.sum(shares)));
  return shares;
}

/**
 * 청구액으로 다시 쓴 다리 금액. 다리 id -> 새 금액.
 *
 * **모든 다리가 기준통화인 전표만 다룬다.** 원화 카드의 외화 결제가 그렇다 -- 청구되는
 * 돈이 원화라 다리도 원화이고, 외화라는 사실은 originalAmount 에만 남는다. 외화 계좌
 * 거래는 다리 자체가 외화라 규칙이 다르다. 섞어서 처리하면 조용히 틀린다.
 *
 * 양쪽(들어온 다리와 나간 다리)에 같은 총액을 나눠 담으므로 합계는 정확히 0으로 남는다.
 */
export function restateAmounts(
  postings: readonly RestatePosting[],
  billedTotal: DecInput,
  baseCurrency: string,
): Map<string, Dec> {
  const total = Dec.of(billedTotal);
  if (!total.isPositive()) {
    throw new RestateError('BILLED_NOT_POSITIVE', '청구액은 0보다 커야 합니다.');
  }
  if (postings.some((posting) => posting.currency !== baseCurrency)) {
    throw new RestateError(
      'FOREIGN_LEG',
      '외화 계좌 거래는 여기서 확정할 수 없습니다. 거래를 직접 수정해 주세요.',
    );
  }

  /*
   * 끝수를 몰아줄 줄을 **값으로** 고른다 -- 금액이 큰 줄, 같으면 줄 키 순.
   *
   * 다리 id 는 기준이 될 수 없다. 기기가 만든 전표의 다리는 기기가 id 를 붙이고, 서버가
   * 재생한 같은 전표의 다리는 서버가 붙인다. 읽어 온 차례로 두면 두 자리에서 1원이 다른
   * 줄로 간다. 줄 키와 금액은 양쪽이 같다.
   */
  const amounts = postings
    .map((posting) => ({
      id: posting.id,
      amount: Dec.of(posting.amount),
      lineKey: posting.lineKey ?? '',
    }))
    .sort(
      (a, b) =>
        b.amount.abs().cmp(a.amount.abs()) ||
        (a.lineKey < b.lineKey ? -1 : a.lineKey > b.lineKey ? 1 : 0),
    );
  const positives = amounts.filter((posting) => posting.amount.isPositive());
  const negatives = amounts.filter((posting) => posting.amount.isNegative());
  if (Dec.sum(positives.map((posting) => posting.amount)).isZero()) {
    throw new RestateError('ZERO_ENTRY', '금액이 0인 거래는 청구액을 확정할 수 없습니다.');
  }

  const decimals = currencyDecimals(baseCurrency);
  const next = new Map<string, Dec>();
  allocateByWeight(total, positives.map((posting) => posting.amount), decimals).forEach(
    (share, index) => next.set(positives[index].id, share),
  );
  allocateByWeight(total, negatives.map((posting) => posting.amount.negated()), decimals).forEach(
    (share, index) => next.set(negatives[index].id, share.negated()),
  );
  // 0원 다리는 0으로 남는다. 가중치가 없어 몫을 받지 않는다.
  for (const posting of amounts) if (!next.has(posting.id)) next.set(posting.id, Dec.of(0));
  return next;
}

/**
 * 적용 환율 하나로 정한 청구액. 카드 통화 자릿수로 반올림한다(원화면 원 단위).
 *
 * 명세서에 적용 환율만 한 줄로 적혀 있을 때 쓴다. 기기가 이 값으로 건마다 청구액을
 * 정해 명령에 싣는다 -- 서버가 재생할 때 같은 금액이 나와야 하므로 규칙이 여기 하나다.
 */
export function billedAmountFromRate(
  originalAmount: DecInput,
  rate: DecInput,
  currency: string,
): Dec {
  return Dec.of(originalAmount).times(rate).round(currencyDecimals(currency), 'half-up');
}

/** 미확정 목록의 재료 하나. 카드 부채 계정에 걸린 미확정 외화 전표의 다리다. */
export interface PendingRateSource {
  entryId: string;
  date: Date;
  description: string;
  merchant: string | null;
  originalCurrency: string;
  originalAmount: string;
  /** 부채 계정 다리의 금액. 부채라 음수로 쌓여 있다. */
  liabilityAmount: DecInput;
}

/**
 * 청구액이 아직 확정되지 않은 외화 결제 목록. 날짜 순이어야 한다(부르는 쪽이 정렬한다).
 *
 * 할부는 첫 회차가 청구되는 주기로 묶는다. 확정은 원금 전체에 걸리므로 주기를 하나만
 * 고를 수 있고, 그 거래가 처음 청구서에 오르는 주기가 맞다.
 */
export function pendingRateItems(
  sources: readonly PendingRateSource[],
  card: { statementClosingDay: number; paymentDueDay: number },
  timeZone: string,
): CardDto.PendingRateItem[] {
  return sources.map((source) => {
    const closing = closingMonthOf(source.date, card.statementClosingDay, timeZone);
    const period = periodForClosingMonth(
      closing.year,
      closing.month,
      card.statementClosingDay,
      card.paymentDueDay,
    );

    return {
      entryId: source.entryId,
      date: source.date.toISOString(),
      description: source.description,
      merchant: source.merchant,
      originalCurrency: source.originalCurrency,
      originalAmount: source.originalAmount,
      // 부채는 음수로 쌓인다. 화면이 쓰는 청구액으로 부호를 뒤집는다.
      estimatedAmount: Dec.of(source.liabilityAmount).negated().toString(),
      closingMonth: closingMonthKey(closing),
      dueDate: period.dueDate.toISOString(),
    };
  });
}
