/**
 * 거래 입력 폼의 검사.
 *
 * 저장할 수 있는 값인지 보고, 어긋나면 고칠 칸과 까닭을 값으로 돌려준다. 조립(entry-build)이
 * 같은 자리를 다시 막지만, 저장을 눌러 보고서야 알게 하지 않으려고 여기서 먼저 본다.
 */

import { Dec, INSTALLMENT_MAX_MONTHS } from '@money/types';

import { isDateKey } from '../lib/datetime';
import {
  type EntryFormValues,
  installmentBaseAmount,
  isTimeKey,
  parseMethod,
  toDec,
  totalDiscountOf,
} from './entry-form-values';

export interface EntryFormViolation {
  /** 어느 칸을 고쳐야 하는지. 화면이 그 자리에 표시를 켠다. */
  field: keyof EntryFormValues;
  code: string;
}

/**
 * 저장할 수 있는 값인지 본다. 맞으면 null.
 *
 * 서버가 어차피 다시 보지만 여기서 먼저 거른다. 오프라인에서는 서버가 없고, 규칙에 어긋난
 * 명령을 큐에 넣으면 서버가 영구히 거절하는 독이 된다 (설계 문서의 D3).
 */
export function checkEntryForm(
  values: EntryFormValues,
  /**
   * 신용카드 부채 계정의 id 들. 이체 양쪽이 다 카드인지 가리는 데만 쓴다.
   *
   * 폼 값만으로는 알 수 없어 받는다. 넘기지 않으면 그 검사는 건너뛰고 조립이 막는다.
   */
  cardLiabilityIds: ReadonlySet<string> = new Set(),
): EntryFormViolation | null {
  // 거래한 사람은 묻지 않는다. 비우면 미지정으로 저장된다 (2026-10-10 사용자 요청).

  /*
   * 설명은 묻지 않는다.
   *
   * 웹과 서버는 처음부터 비워 두는 것을 받아들였고 목록도 그때를 대비해 그려 둔다 --
   * 설명이 비면 분류가 그 줄의 이름이 되고, 그것마저 없으면 "(내용 없음)"이 선다.
   * 여기서만 막고 있어, 같은 거래를 웹에서는 적을 수 있고 앱에서는 적을 수 없었다.
   */

  const amount = toDec(values.amount);
  if (!amount || !amount.isPositive()) return { field: 'amount', code: 'AMOUNT_INVALID' };

  /*
   * 날짜와 시간의 모양.
   *
   * 앱에는 달력 입력이 없어 사용자가 글자로 적는다. 모양이 어긋나면 인스턴트가
   * Invalid Date 가 되고, 그대로 저장되면 목록 어디에도 뜨지 않는 거래가 남는다.
   */
  if (!isDateKey(values.dateKey)) return { field: 'dateKey', code: 'DATE_INVALID' };
  if (values.timeKey && !isTimeKey(values.timeKey)) {
    return { field: 'timeKey', code: 'TIME_INVALID' };
  }

  /*
   * 외화. 통화를 골랐으면 환율이 있어야 한다.
   *
   * 오프라인에서는 서버의 환율표를 볼 수 없어 비워 두면 재생하는 날의 환율로 값이 다시
   * 매겨진다 -- 기기가 보여 준 금액과 서버에 남는 금액이 갈린다 (설계 문서의 D7).
   * 그래서 화면이 기본값을 채워 주고, 여기서는 비어 있지 않은지만 본다.
   */
  if (values.currency) {
    const rate = toDec(values.exchangeRate);
    if (!rate || !rate.isPositive()) return { field: 'exchangeRate', code: 'RATE_INVALID' };
  }

  /*
   * 즉시 차감과 되돌린 결제. 지출에만 붙는다.
   *
   * 다른 갈래에서 값이 남아 있어도 `entryFormToRequest` 가 싣지 않으므로 여기서는
   * 지출일 때만 본다 -- 갈래를 옮겨 다니는 사이에 저장이 막히면 이유를 알 수 없다.
   */
  if (values.kind === 'expense') {
    /*
     * 차감은 줄마다 본다. 정가보다 크지만 않으면 된다.
     *
     * 줄 하나가 0원으로 남는 것은 받는다 -- 전액 환불이 그 모양이고, 분할의 한 줄만
     * 그렇게 되는 일도 있다 (여행경비만 돌려받고 식비 줄은 남는다).
     */
    const lines =
      values.splits.length > 0
        ? values.splits.map((split) => ({
            discountAmount: split.discountAmount,
            amount: toDec(split.amount),
          }))
        : [{ discountAmount: values.discountAmount, amount }];
    for (const line of lines) {
      const violation = checkExpenseExtras(line.discountAmount, line.amount);
      if (violation) return violation;
    }
  }

  /*
   * 할부 개월수. 비우거나 1 이면 일시불이고, 나누면 2~50개월이다 (2026-10-10 사용자 요청, 조립의
   * assertCanInstall 과 같은 규칙). 칸에 아무 숫자나 적을 수 있어 여기서 먼저 막는다.
   */
  if (values.kind === 'expense' && parseMethod(values.method).cardId) {
    const months = Number(values.installmentMonths);
    if (
      values.installmentMonths.trim() !== '' &&
      months !== 1 &&
      (!Number.isInteger(months) || months < 2 || months > INSTALLMENT_MAX_MONTHS)
    ) {
      return { field: 'installmentMonths', code: 'INSTALLMENT_MONTHS_RANGE' };
    }
  }

  /*
   * 할부를 골랐으면 수수료가 붙는지도 골라야 한다.
   *
   * 기본값으로 대신하지 않는 까닭은 `EntryFormValues.installmentInterest` 에 적었다.
   * 개월수를 고른 신용카드 지출에만 묻는다.
   */
  /*
   * 할부가 실리는 폼인가. `entryFormToRequest` 가 회차 표를 싣는 조건과 같다. 결제수단을 통장으로
   * 바꾸거나 갈래를 옮기면 회차 칸이 숨지만 값은 남는다 -- 그 값으로 저장을 막으면 보이지 않는
   * 칸 때문에 막힌다 (예전의 INSTALLMENT_SHARES_COUNT).
   */
  const installs =
    values.kind === 'expense' &&
    Boolean(parseMethod(values.method).cardId) &&
    Number(values.installmentMonths) >= 2;

  if (installs && !values.installmentInterest) {
    return { field: 'installmentInterest', code: 'INSTALLMENT_INTEREST_REQUIRED' };
  }

  /*
   * 적어 둔 회차 금액. 개수와 합만 본다.
   *
   * 값 자체는 손대지 않는다 -- 끝수를 어디에 붙이는지가 카드사마다 달라, 사람이 적은
   * 값이 곧 사실이다. 합이 어긋난 채 저장되면 카드 화면의 주기별 청구액이 갚을 대금과
   * 달라지고, 그 어긋남은 몇 달 뒤 명세서를 대조할 때에야 드러난다.
   *
   * 외화 결제는 여기서 보지 않는다. 카드에 청구되는 금액이 환산 뒤에야 정해져 폼의
   * 값만으로는 견줄 수 없다 -- 그때는 조립(entry-build)이 카드 다리를 보고 막는다.
   */
  if (installs && values.installmentShares.length > 0 && !values.currency) {
    const months = Number(values.installmentMonths);
    if (values.installmentShares.length !== months) {
      return { field: 'installmentShares', code: 'INSTALLMENT_SHARES_COUNT' };
    }
    /*
     * 빈 칸은 0 으로 본다. 치는 중에는 늘 빈 칸이 생기고, 그 한 칸 때문에 "회차 금액은
     * 0보다 작을 수 없습니다" 같은 엉뚱한 말이 뜨면 어디를 고쳐야 하는지 알 수 없다.
     * 채우지 않은 채로 저장하려 하면 아래 합계 검사가 막는다.
     */
    const shares = values.installmentShares.map((share) => toDec(share) ?? Dec.of(0));
    if (shares.some((share) => share.isNegative())) {
      return { field: 'installmentShares', code: 'INSTALLMENT_SHARE_NEGATIVE' };
    }
    const total = shares.reduce<Dec>((acc, share) => acc.plus(share), Dec.of(0));
    // 회차는 차감 뒤 금액을 나눈다. 서버(installmentSharesOf)가 카드 다리와 견주는 값이다.
    if (!total.eq(installmentBaseOf(values) ?? amount)) {
      return { field: 'installmentShares', code: 'INSTALLMENT_SHARES_SUM' };
    }
  }

  /*
   * 이자 쪽. 유이자 할부에만 뜻이 있다.
   *
   * 고정형은 낸 돈의 합이 산 값에 못 미치면 할부가 아니다 -- 이율을 아무리 낮춰도
   * 표가 풀리지 않아 이자 칸이 비어 버린다. 그 까닭을 저장할 때가 아니라 적는 자리에서
   * 알려 준다. 회차 이자는 개수와 부호만 본다. 맞춰야 할 총액이 없기 때문이다.
   */
  if (installs && values.installmentInterest === 'interest') {
    const months = Number(values.installmentMonths);

    /*
     * 외화가 얽힌 결제에는 유이자 할부를 적을 수 없다.
     *
     * 이자는 명세서에 찍힌 금액 그대로 적는 값이라 환산할 환율이 없고, 이자가 섞인
     * 환산액에서 환율을 되짚으면 적은 적 없는 환율이 화면에 뜬다. 조립도 같은 자리를
     * 막지만(`assertInterestCurrency`), 고른 순간에 알려 주는 편이 낫다.
     */
    if (values.currency) {
      return { field: 'installmentInterest', code: 'INSTALLMENT_INTEREST_CURRENCY' };
    }

    if (values.installmentInterestMode === 'fixed' && values.installmentMonthlyPayment.trim()) {
      const payment = toDec(values.installmentMonthlyPayment);
      if (!payment || !payment.isPositive()) {
        return { field: 'installmentMonthlyPayment', code: 'INSTALLMENT_PAYMENT_INVALID' };
      }
      // 외화 결제는 청구액이 환산 뒤에 정해져 폼의 금액과 견줄 수 없다.
      if (!values.currency && payment.times(months).lt(installmentBaseOf(values) ?? amount)) {
        return { field: 'installmentMonthlyPayment', code: 'INSTALLMENT_PAYMENT_TOO_SMALL' };
      }
    }

    if (values.installmentInterestMode === 'rate' && values.installmentAnnualRate.trim()) {
      const rate = toDec(values.installmentAnnualRate);
      if (!rate || rate.isNegative()) {
        return { field: 'installmentAnnualRate', code: 'INSTALLMENT_RATE_INVALID' };
      }
    }

    if (values.installmentInterestShares.length > 0) {
      if (values.installmentInterestShares.length !== months) {
        return { field: 'installmentInterestShares', code: 'INSTALLMENT_INTEREST_SHARES_COUNT' };
      }
      // 빈 칸은 0 이다. 치는 중에 한 칸이 비었다고 막지 않는다 (회차 원금과 같은 규칙).
      const interests = values.installmentInterestShares.map((share) => toDec(share) ?? Dec.of(0));
      if (interests.some((interest) => interest.isNegative())) {
        return { field: 'installmentInterestShares', code: 'INSTALLMENT_INTEREST_NEGATIVE' };
      }
    }
  }

  if (values.kind === 'transfer') {
    const from = parseMethod(values.method).accountId;
    if (!from) return { field: 'method', code: 'FROM_ACCOUNT_REQUIRED' };
    if (!values.toAccountId) return { field: 'toAccountId', code: 'TO_ACCOUNT_REQUIRED' };
    if (from === values.toAccountId) return { field: 'toAccountId', code: 'TRANSFER_SAME_ACCOUNT' };

    /*
     * 양쪽이 다 카드인 이동은 받지 않는다.
     *
     * 목록은 그 전표를 카드대금으로 읽고 "어느 카드의 대금인가"를 하나로 정해야 해서
     * 어느 쪽을 골라도 반쪽만 보인다. 조립도 같은 이유로 막는다(TRANSFER_BOTH_CARDS).
     * 이 검사는 카드 목록을 알아야 하므로 부르는 쪽이 넘겨 준다.
     */
    if (cardLiabilityIds.has(from) && cardLiabilityIds.has(values.toAccountId)) {
      return { field: 'toAccountId', code: 'TRANSFER_BOTH_CARDS' };
    }

    const fee = values.transferFee ? toDec(values.transferFee) : null;
    if (values.transferFee && (!fee || fee.isNegative())) {
      return { field: 'transferFee', code: 'FEE_INVALID' };
    }
    if (fee && fee.isPositive() && !values.transferFeeCategoryId) {
      return { field: 'transferFeeCategoryId', code: 'FEE_CATEGORY_REQUIRED' };
    }
    return null;
  }

  /*
   * 분할. 줄마다 분류와 금액이 있어야 하고, 합이 전체 금액과 같아야 한다.
   *
   * 남는 것을 마지막 줄에 몰아주지 않는다. 사용자가 적은 숫자와 저장되는 숫자가 다르면
   * 그 차이를 알아챌 길이 없다 -- 금액은 그대로인데 분류별 합계만 어긋난다.
   */
  if (values.splits.length > 0) {
    let total = Dec.of(0);
    for (const split of values.splits) {
      if (!split.categoryId) return { field: 'splits', code: 'SPLIT_CATEGORY_REQUIRED' };

      const line = toDec(split.amount);
      if (!line || !line.isPositive()) return { field: 'splits', code: 'SPLIT_AMOUNT_INVALID' };

      total = total.plus(line);
    }
    if (!total.eq(amount)) return { field: 'splits', code: 'SPLIT_SUM_MISMATCH' };

    // 분할이 있으면 대표 분류는 쓰이지 않는다. 줄마다 따로 있기 때문이다.
    return null;
  }

  // 페이백은 원거래의 어느 줄인지가 있어야 한다. 분할이면 화면이 고르게 한다.
  if (values.kind === 'payback' && values.paybackOfEntryId && !values.paybackOfLineKey) {
    return { field: 'paybackOfLineKey', code: 'PAYBACK_LINE_REQUIRED' };
  }

  if (!values.categoryId) return { field: 'categoryId', code: 'CATEGORY_REQUIRED' };

  /*
   * 지출·수입의 결제수단은 고르지 않아도 된다.
   *
   * 비워 두면 조립이 미지정 계정에 붙인다(entry-build 의 resolvePaymentSource). 현금을
   * 따로 관리하지 않거나 어느 통장인지 기억나지 않는 거래를 적는 자리다.
   */
  return null;
}

/**
 * 줄 하나의 차감액을 본다. 맞으면 null.
 *
 * **정가와 같아도 된다.** 그때 그 줄은 0원으로 남는다 -- 1,000원을 결제하고 1,000원을
 * 돌려받은 일은 있었던 일이다. 분할의 한 줄만 그렇게 되는 것도 같다. 넘으면 지출이
 * 아니라 입금이 되므로 막는다. 조립도 같은 값으로 거절한다(`assertDiscountValid`) --
 * 저장을 눌러 보고서야 알게 하지 않으려고 여기서도 본다.
 */
function checkExpenseExtras(
  discountAmount: string,
  amount: Dec | null,
): EntryFormViolation | null {
  if (!discountAmount.trim()) return null;

  const discount = toDec(discountAmount);
  if (!discount || !discount.isPositive()) {
    return { field: 'discountAmount', code: 'DISCOUNT_INVALID' };
  }
  if (!amount || discount.gt(amount)) {
    return { field: 'discountAmount', code: 'DISCOUNT_TOO_LARGE' };
  }

  return null;
}

/** 폼 값의 할부 기준 금액. 금액 칸을 읽을 수 없으면 null. */
function installmentBaseOf(values: EntryFormValues): Dec | null {
  return toDec(installmentBaseAmount(values.amount, totalDiscountOf(values)));
}
