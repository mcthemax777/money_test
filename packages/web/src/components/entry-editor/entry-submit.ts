/*
 * 거래 폼을 저장하기 전의 검사와, 서버로 보낼 짐 만들기.
 *
 * 둘 다 화면 상태를 들지 않는다. 편집기(EntryEditor)가 지금 값과 거기서 셈한 값을
 * 넘기면, 검사는 막을 까닭의 문구 열쇠를, 짐 만들기는 보낼 값을 돌려준다.
 */
import type { MessageKey } from '@money/core/lib/i18n';
import { toAmountString, toNumber } from '@money/core/lib/money';
import {
  defaultCountsPerformance,
  defaultSharesToSend,
  showDiscountPerformance,
} from '@money/core/data/entry-form';
import { Dec, INSTALLMENT_MAX_MONTHS, type CurrencyCode } from '@money/types';
import { splitAmountOf, toCents, type EntryFormValues } from './editor-form';

/** 폼 값에서 셈한 것들. 검사와 짐 만들기가 같은 값을 본다. */
export interface EntrySubmitContext {
  ledgerCurrency: CurrencyCode;
  /** 이체 양쪽이 다 카드다. 저장할 수 없다. */
  transferBothCards: boolean;
  /** 이체 한쪽이 카드면 그 방향. 아니면 null 이다. */
  transferCardSide: 'payment' | 'refund' | null;
  canInstall: boolean;
  hasSplits: boolean;
  hasBilled: boolean;
  isCrossCurrencyTransfer: boolean;
  /** 할부가 나누는 금액 (금액 − 차감). */
  installmentBase: string;
  /** 화면에 보이는 회차 이자. */
  interestInputs: string[];
  /** 이 거래에서 깎인 금액의 합. */
  totalDiscount: string;
}

/**
 * 저장을 막을 까닭. 없으면 null 이다.
 *
 * 함께 적은 페이백의 검사는 여기서 하지 않는다 (편집기가 core 의 usePaybackDrafts 로 본다).
 */
export function entryFormErrorKey(
  formData: EntryFormValues,
  {
    ledgerCurrency,
    transferBothCards,
    transferCardSide,
    canInstall,
    hasSplits,
    installmentBase,
  }: EntrySubmitContext,
): MessageKey | null {
  if (transferBothCards) return 'entryForm.bothCards';

  // 수수료를 넣었으면 분류가 있어야 한다. 없이 보내면 서버가 거절하는데,
  // 그 오류만 보고는 어느 칸이 비었는지 알기 어렵다.
  if (
    formData.type === 'transfer' &&
    !transferCardSide &&
    toNumber(formData.transferFee) > 0 &&
    !formData.transferFeeMainCategoryId
  ) {
    return 'editor.feeCategoryRequired';
  }

  /* 할부 개월수는 2~50 이다. 비우거나 1 이면 일시불이다 (core checkEntryForm 과 같은 규칙). */
  if (canInstall && formData.installmentMonths.trim() !== '') {
    const months = Number(formData.installmentMonths);
    if (months !== 1 && (!Number.isInteger(months) || months < 2 || months > INSTALLMENT_MAX_MONTHS)) {
      return 'error.INSTALLMENT_MONTHS_RANGE';
    }
  }

  /*
   * 할부를 골랐으면 수수료가 붙는지도 골라야 한다.
   *
   * 기본값으로 대신하지 않는다. 무이자로 두면 유이자 할부가 조용히 수수료 없이
   * 지나가고, 유이자로 두면 무이자 결제마다 "수수료 미입력"이 쌓인다. 앱도 같은
   * 규칙으로 막는다 (core 의 checkEntryForm).
   */
  if (canInstall && Number(formData.installmentMonths) >= 2 && !formData.installmentInterest) {
    return 'entryForm.installmentInterestRequired';
  }

  /*
   * 적어 둔 회차 금액은 개수와 합이 맞아야 한다.
   *
   * 외화 결제는 여기서 보지 않는다. 카드에 청구되는 금액이 환산 뒤에야 정해져 폼의
   * 값만으로는 견줄 수 없다 -- 그때는 서버가 카드 다리를 보고 막는다. **장부 통화와
   * 견주는 것이 요점이다.** 이 폼의 통화 칸은 비는 법이 없어(원화 결제에도 'KRW' 가
   * 들어 있다) 빈 값으로 판단하면 이 검사가 영영 돌지 않는다.
   */
  if (
    canInstall &&
    formData.installmentShares.some((share) => share.trim() !== '') &&
    formData.currency === ledgerCurrency
  ) {
    if (formData.installmentShares.length !== Number(formData.installmentMonths)) {
      return 'entryForm.installmentSharesCount';
    }
    const shareSum = formData.installmentShares.reduce((acc, share) => acc + toNumber(share), 0);
    // 차감 뒤 금액과 견준다. 서버가 견주는 값이다 (installmentBase). 센트에서 견준다 -- 실수로 더하면
    // 10.1 + 10.1 + 10.1 이 30.299999… 가 되어 맞는 회차 금액을 거절했다 (2026-10-16).
    if (toCents(shareSum) !== toCents(toNumber(installmentBase))) {
      return 'entryForm.installmentSharesSum';
    }
  }

  /*
   * 이자 쪽. 유이자 할부에만 본다.
   *
   * 고정형은 낸 돈의 합이 산 값에 못 미치면 표가 풀리지 않는다. 그때 이자 칸이 왜
   * 비어 있는지를 저장할 때가 아니라 적는 자리에서 알려 준다.
   */
  if (canInstall && formData.installmentInterest === 'interest') {
    const months = Number(formData.installmentMonths);

    /*
     * 외화가 얽힌 결제에는 유이자 할부를 적을 수 없다.
     *
     * 이자는 명세서 금액 그대로 적는 값이라 환산할 환율이 없다. 조립도 막지만
     * (`assertInterestCurrency`), 고른 자리에서 알려 주는 편이 낫다.
     *
     * **장부 통화와 견준다.** 이 폼의 통화 칸은 비어 있는 법이 없고 원화 결제에도
     * 'KRW' 가 들어 있다 -- 빈 값으로 판단하면 모든 유이자 할부가 막힌다
     * (core 의 `checkEntryForm` 은 외화일 때만 값이 차는 폼을 본다).
     */
    if (formData.currency !== ledgerCurrency) return 'entryForm.installmentInterestCurrency';

    if (formData.installmentInterestMode === 'fixed' && formData.installmentMonthlyPayment.trim()) {
      const payment = toNumber(formData.installmentMonthlyPayment);
      if (!(payment > 0)) return 'entryForm.installmentPaymentInvalid';
      // 외화 결제는 청구액이 환산 뒤에 정해져 폼의 금액과 견줄 수 없다 (위와 같은 판단).
      if (
        formData.currency === ledgerCurrency &&
        toCents(payment * months) < toCents(toNumber(installmentBase))
      ) {
        return 'entryForm.installmentPaymentTooSmall';
      }
    }

    if (
      formData.installmentInterestMode === 'rate' &&
      formData.installmentAnnualRate.trim() &&
      toNumber(formData.installmentAnnualRate) < 0
    ) {
      return 'entryForm.installmentRateInvalid';
    }

    if (formData.installmentInterestShares.some((share) => share.trim() !== '')) {
      if (formData.installmentInterestShares.length !== months) {
        return 'entryForm.installmentInterestSharesCount';
      }
      if (formData.installmentInterestShares.some((share) => toNumber(share) < 0)) {
        return 'entryForm.installmentInterestNegative';
      }
    }
  }

  /*
   * 차감·취소. **정가보다 클 수 없다.**
   *
   * 같아도 된다 -- 그때 그 줄은 0원으로 남고, 전액 환불이 그 모양이다. 넘으면
   * 지출이 아니라 입금이 되어 서버가 거절하므로 여기서 먼저 막는다.
   */
  if (formData.type === 'expense') {
    const lines = hasSplits
      ? formData.splits.map((split) => ({
          discount: toNumber(split.discountAmount),
          amount: toNumber(split.amount),
        }))
      : [{ discount: toNumber(formData.discountAmount), amount: toNumber(formData.amount) }];
    if (lines.some((line) => line.discount > line.amount)) return 'entryForm.discountTooLarge';
  }

  /*
   * 나눈 줄은 줄마다 분류와 금액이 있어야 하고, 합이 전체 금액과 같아야 한다.
   *
   * 서버는 줄들의 합을 그대로 그 거래의 금액으로 삼는다(entry-build 의
   * resolveRequestLines). 어긋난 채 보내면 위 칸에 적은 금액과 다른 거래가 조용히
   * 저장되므로, 남는 것을 마지막 줄에 몰아주지도 않고 여기서 막는다.
   */
  if (hasSplits) {
    let total = Dec.of(0);
    for (const split of formData.splits) {
      if (!split.mainCategoryId) return 'editor.splitCategoryRequired';

      const line = splitAmountOf(split.amount);
      if (!line) return 'editor.splitAmountInvalid';

      total = total.plus(line);
    }

    if (!total.eq(Dec.of(toAmountString(formData.amount)))) return 'editor.splitSumMismatch';
  }

  return null;
}

/**
 * 서버로 보낼 짐. 화면의 개념을 그대로 보낸다. 서버가 전표(postings)로 번역한다.
 *
 * 카드대금 결제라는 갈래는 보내지 않는다. 이체에서 카드 부채 계정을 고르면
 * 서버가 같은 전표를 만들고, 목록이 그것을 `card_payment` 로 되읽는다.
 *
 * `date` 는 프로젝트 타임존의 벽시계를 UTC 로 옮긴 값이다 (부르는 쪽이 만든다).
 */
export function buildEntryPayload(
  formData: EntryFormValues,
  date: string,
  {
    ledgerCurrency,
    transferCardSide,
    canInstall,
    hasSplits,
    hasBilled,
    isCrossCurrencyTransfer,
    installmentBase,
    interestInputs,
    totalDiscount,
  }: EntrySubmitContext,
) {
  const kind =
    formData.type === 'income' ? 'income' : formData.type === 'transfer' ? 'transfer' : 'expense';
  const useCard = formData.method === 'card' && Boolean(formData.cardId);

  const payload: any = {
    kind,
    // 비워 두면 사람 없이(미지정) 저장한다 (2026-10-10 사용자 요청).
    personId: formData.personId || null,
    // 금액은 문자열로 보낸다 (정밀도 손실 방지)
    amount: toAmountString(formData.amount),
    description: formData.description,
    date,
  };

  // 기준통화면 통화·환율을 보내지 않는다. 서버가 계좌 통화로 알아서 본다.
  if (formData.currency !== ledgerCurrency) {
    payload.currency = formData.currency;
    // 환율은 보내지 않는다. 실제 금액이 있으면 그것을 보내고, 없으면
    // 서버가 설정된 환율로 추정한다 (신용카드만 가능).
    if (hasBilled) {
      payload.billedAmount = toAmountString(formData.billedAmount);
    }
  }

  /*
   * 태그는 언제나 싣는다. 비었어도 뺄 수 없다.
   *
   * 수정은 전표를 통째로 갈아 끼우고 생략은 "비운다"로 읽히므로, 여기서 빈 배열을
   * 빼면 "태그를 전부 뗀 수정"과 "태그를 건드리지 않은 수정"이 같아진다.
   */
  payload.tagIds = formData.tagIds;

  if (formData.merchant) payload.merchant = formData.merchant;
  if (formData.detailedNote) payload.detailedNote = formData.detailedNote;

  if (kind === 'transfer') {
    payload.accountId = formData.accountId;
    payload.toAccountId = formData.toAccountId;
    // 통화가 다른 환전은 받은 금액을 그대로 적는다. 그러면 실제 적용된
    // 환율이 저절로 기록되고, 별도의 환차손익 처리가 필요 없다.
    if (isCrossCurrencyTransfer && formData.toAmount) {
      payload.toAmount = toAmountString(formData.toAmount);
    }
    // 카드사와의 이체에는 수수료가 붙지 않는다. 칸을 감췄어도 남은 값이 따라가지 않게 뺀다.
    if (formData.transferFee && !transferCardSide) {
      payload.transferFee = toAmountString(formData.transferFee);
      // 수수료는 소분류가 있으면 소분류를, 없으면 대분류를 쓴다
      payload.transferFeeCategoryId =
        formData.transferFeeSubCategoryId || formData.transferFeeMainCategoryId;
      // 수수료도 분류 줄이라 키를 갖는다. 폼의 줄 키를 그대로 쓴다.
      payload.transferFeeLineKey = formData.lineKey;
    }
    return { kind, payload };
  }

  // 결제수단은 계좌와 카드 중 하나만 보낸다. 둘 다 보내면 서버가 거부한다.
  // 둘 다 비었으면 싣지 않는다. 서버가 미지정 계정에 붙인다.
  if (useCard) payload.cardId = formData.cardId;
  else if (formData.accountId) payload.accountId = formData.accountId;
  // posting은 가장 구체적인 카테고리 하나만 가리킨다
  /** 그 줄에서 깎인 금액. 지출에만 싣는다. */
  const lineDiscount = (discountAmount: string) =>
    kind === 'expense' && toNumber(discountAmount) > 0
      ? { discountAmount: toAmountString(discountAmount) }
      : {};

  if (hasSplits) {
    // 나눈 줄이 있으면 대표 분류는 보내지 않는다. 줄마다 따로 있기 때문이다.
    payload.splits = formData.splits.map((split) => ({
      categoryId: split.subCategoryId || split.mainCategoryId,
      amount: toAmountString(split.amount),
      lineKey: split.lineKey,
      // 태그도 줄마다 싣는다. 비었어도 뺄 수 없다 -- 생략은 "비운다"로 읽힌다.
      tagIds: split.tagIds,
      ...lineDiscount(split.discountAmount),
    }));
    // 나눈 거래는 줄마다 태그가 다르다. 거래 단위 목록은 싣지 않는다.
    delete payload.tagIds;
  } else {
    payload.categoryId = formData.subCategoryId || formData.mainCategoryId;
    // 그 줄의 키. 이 값이 이어져야 줄에 붙은 태그와 차감이 살아남는다.
    payload.lineKey = formData.lineKey;
    Object.assign(payload, lineDiscount(formData.discountAmount));
  }

  /*
   * 카드 실적 두 칸. **분할이든 아니든 거래에 하나씩이다.**
   *
   * 카드로 냈고 기본값과 다를 때만 싣는다. 기본값은 서버가 갈래를 보고 정하므로
   * 같은 값을 굳이 보내지 않는다 -- 짐만 보고도 사용자가 손댄 자리가 드러난다.
   */
  if (useCard && formData.countsPerformance !== defaultCountsPerformance(kind)) {
    payload.countsPerformance = formData.countsPerformance;
  }
  /*
   * 차감을 실적에서 빼지 않기로 한 것. 그 칸이 화면에 떠 있었을 때만 싣는다.
   *
   * 보여 주지 않은 값을 실어 보내면, 껐다가 차감을 지운 거래가 사용자가 볼 수
   * 없는 값을 들고 다닌다 (앱과 같은 규칙: `showDiscountPerformance`).
   */
  if (
    showDiscountPerformance({
      kind,
      discountAmount: totalDiscount,
      countsPerformance: formData.countsPerformance,
      isCard: useCard,
      isLedgerCurrency: formData.currency === ledgerCurrency,
    }) &&
    !formData.discountCountsPerformance
  ) {
    payload.discountCountsPerformance = false;
  }

  // 할부는 신용카드 지출에만 붙는다. 2개월 미만이면 일시불이라 보내지 않는다.
  // canInstall이 카드 종류까지 본다. 체크카드로 바꾼 뒤 남은 값이 새지 않게 막는다.
  const months = Number(formData.installmentMonths);
  if (canInstall && months >= 2) {
    payload.installmentMonths = months;
    // 수수료가 붙는지는 사용자가 고른다. 고르지 않으면 저장 전 검사에서 막힌다.
    payload.installmentInterest = formData.installmentInterest === 'interest';
    /*
     * 회차 금액은 손댔을 때만 보낸다.
     *
     * 비워 두면 서버가 개월수로 나눈다. 그래야 나중에 금액을 고쳤을 때 회차도
     * 함께 다시 나뉜다 -- 한 번 채워 보내 두면 옛 금액의 회차가 남는다.
     */
    if (formData.installmentShares.some((share) => share.trim() !== '')) {
      // 비운 칸은 0 이다. 개수를 줄여 보내면 서버가 "개수가 다르다"로 거절한다.
      payload.installmentShares = formData.installmentShares.map((share) => toAmountString(share));
    } else {
      // 장부 통화로 나눈 기본값이 서버의 나눔과 다르면(소수 없는 달러 금액) 싣는다 (앱과 같은 `defaultSharesToSend`).
      const shares = defaultSharesToSend(installmentBase, Number(formData.installmentMonths), ledgerCurrency);
      if (shares) payload.installmentShares = shares;
    }

    /*
     * 이자 쪽은 유이자 할부에만 싣는다.
     *
     * 무이자면 아무것도 싣지 않아 서버가 계획의 이자 칸을 비운다 -- 유이자로
     * 적었다가 되돌린 할부에 옛 이자가 남지 않는다.
     */
    if (formData.installmentInterest === 'interest') {
      /*
       * **화면에 보이는 값을 그대로 싣는다.** 계산으로 채워 준 기본값도 손대지
       * 않았다고 버리지 않는다 -- 이자는 전표 금액 안에 들어가는 값이라, 보이는
       * 대로 저장하지 않으면 고쳐 저장하는 순간 갚을 돈이 원금만 남는다.
       * 서버는 이자를 계산하지 않으므로 여기서 싣지 않으면 되살릴 자리가 없다.
       * (앱도 같은 규칙이다: core 의 `installmentInterestPayload`)
       */
      if (interestInputs.some((share) => share.trim() !== '')) {
        payload.installmentInterestShares = interestInputs.map((share) => toAmountString(share));
      }
      if (formData.installmentInterestMode === 'fixed' && formData.installmentMonthlyPayment.trim()) {
        payload.installmentMonthlyPayment = toAmountString(formData.installmentMonthlyPayment);
      }
      if (formData.installmentInterestMode === 'rate' && formData.installmentAnnualRate.trim()) {
        payload.installmentAnnualRate = formData.installmentAnnualRate.trim();
      }
    }
  }

  return { kind, payload };
}
