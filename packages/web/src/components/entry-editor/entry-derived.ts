/*
 * 거래 폼 값에서 셈하는 것들. 통화, 청구액·환율 칸을 띄울지, 할부를 받을지, 회차 금액 같은 것이다.
 *
 * 그릴 때마다 지금 값에서 다시 셈한다. 상태를 들지 않으므로 같은 값이면 같은 답이다.
 */
import { formatCurrency, formatNumber, toNumber } from '@money/core/lib/money';
import { installmentBaseAmount } from '@money/core/data/entry-form';
import { installmentInterestInputs, installmentShareInputs } from '@money/core/lib/period-ledger';
import type { Account, Card } from '@money/core/lib/types';
import { isCurrencyCode, type CurrencyCode } from '@money/types';
import { toCents, type EntryFormValues } from './editor-form';

export function deriveEntryForm({
  formData,
  accounts,
  cards,
  ledgerCurrency,
  cardLiabilityIds,
  rateOf,
}: {
  formData: EntryFormValues;
  accounts: Account[];
  cards: Card[];
  ledgerCurrency: CurrencyCode;
  /** 신용카드 부채 계정의 id 들. 이체 양쪽이 카드인지 가리는 데 쓴다. */
  cardLiabilityIds: ReadonlySet<string>;
  /** 설정의 환율 (core 의 useExchangeRates). */
  rateOf: (currency: CurrencyCode) => string;
}) {
  /** 이체 양쪽 중 카드 부채 계정인 쪽. 없거나 둘 다 카드면 null 이다. */
  const transferCardSide = (() => {
    if (formData.type !== 'transfer') return null;
    const fromIsCard = cardLiabilityIds.has(formData.accountId);
    const toIsCard = cardLiabilityIds.has(formData.toAccountId);
    if (fromIsCard && !toIsCard) return 'refund' as const;
    if (toIsCard && !fromIsCard) return 'payment' as const;
    return null;
  })();

  /*
   * 양쪽이 다 카드인 이동. 저장할 수 없다.
   *
   * 목록은 그 전표를 카드대금으로 읽고 "어느 카드의 대금인가"를 하나로 정해야 해서
   * 어느 쪽을 골라도 반쪽만 보인다. 조립도 같은 이유로 막는다.
   */
  const transferBothCards =
    formData.type === 'transfer' &&
    cardLiabilityIds.has(formData.accountId) &&
    cardLiabilityIds.has(formData.toAccountId);

  /*
   * 통화.
   *
   * 기본값은 결제수단(또는 이체 보내는 계좌)의 통화다. 달러 통장을 고르면
   * 달러로 입력하게 되고, 원화 카드를 고른 채 통화만 달러로 바꾸면 "원화 카드로
   * 한 외화 결제"가 된다. 두 경우의 원장 모양은 서버가 갈라 준다.
   */
  const currencyOfAccount = (accountId: string): CurrencyCode => {
    const account = accounts.find((a) => a.id === accountId);
    return isCurrencyCode(account?.currency) ? account.currency : ledgerCurrency;
  };

  /** 결제수단의 통화. 카드는 결제 통장을 따른다. */
  const currencyOfMethod = (accountId?: string | null, cardId?: string | null): CurrencyCode => {
    if (cardId) {
      const card = cards.find((c) => c.id === cardId);
      return card ? currencyOfAccount(card.paymentAccountId) : ledgerCurrency;
    }
    if (accountId) return currencyOfAccount(accountId);
    return ledgerCurrency;
  };

  /** 지금 고른 결제수단의 통화 */
  const paymentCurrency = currencyOfMethod(formData.accountId, formData.cardId);

  const toCurrency: CurrencyCode = formData.toAccountId
    ? currencyOfAccount(formData.toAccountId)
    : ledgerCurrency;

  const isCrossCurrencyTransfer =
    formData.type === 'transfer' && Boolean(formData.toAccountId) && paymentCurrency !== toCurrency;

  /** 환율 칸을 보여 줄지. 기준통화로 입력하면 환산할 것이 없다. */
  const needsRate = formData.currency !== ledgerCurrency;

  /**
   * 청구액 칸을 보여 줄지.
   *
   * 원화 카드로 달러를 결제한 경우처럼 "결제수단은 기준통화, 입력은 외화"일 때만
   * 통장에서 빠진 금액이 따로 존재한다. 달러 통장에서 달러를 쓴 거래에는 그런
   * 금액이 없다. 계좌 통화 금액이 이미 사실이기 때문이다. 서버도 같은 조건으로
   * 받는다 (LedgerService.resolveBilled).
   */
  const needsBilled = needsRate && paymentCurrency === ledgerCurrency;

  /** 사용자가 청구액을 직접 넣었는지. 넣었으면 환율보다 우선한다. */
  const hasBilled = needsBilled && toNumber(formData.billedAmount) > 0;

  /**
   * 실제 금액을 지금 받아야 하는지.
   *
   * 청구액이 나중에 정해지는 것은 신용카드뿐이다. 통장과 체크카드는 결제하는
   * 자리에서 돈이 빠지므로 사용자가 금액을 알고, 확정할 화면도 따로 없다
   * (카드 대조는 신용카드 전용이다). 서버도 같은 규칙으로 막는다
   * (LedgerService.assertCanEstimate).
   */
  const isCreditCardSelected = cards.find((c) => c.id === formData.cardId)?.cardType === 'credit';
  const mustBill = needsBilled && !isCreditCardSelected;

  /**
   * 할부를 받을 수 있는지.
   *
   * 신용카드 지출만 된다. 체크카드는 결제 즉시 통장에서 빠져 나눌 청구가 없고,
   * 통장 결제도 마찬가지다. 서버도 같은 규칙으로 막는다(LedgerService.assertCanInstall).
   */
  const canInstall = formData.type === 'expense' && formData.method === 'card' && isCreditCardSelected;

  /**
   * 분류를 나눠 적는 중인지.
   *
   * 이체와 카드대금 결제에는 분류 칸 자체가 없으므로 줄이 남아 있어도 쓰지 않는다
   * (유형을 바꿀 때 비우지만, 어느 쪽으로 들어와도 같게 읽히도록 갈래까지 본다).
   */
  const hasSplits = formData.type !== 'transfer' && formData.splits.length > 0;

  /*
   * 할부가 나누는 금액 = 금액 − 차감 (core `installmentBaseAmount`). 카드에 청구되는 것이 차감 뒤
   * 금액이라 서버도 그 값을 나눈다. 금액 칸을 그대로 나누면 회차가 차감만큼 크게 보이고, 고친
   * 회차는 서버가 "합이 다르다"로 거절한다.
   */
  const installmentBase = installmentBaseAmount(
    formData.amount,
    String(
      hasSplits
        ? toCents(formData.splits.reduce((sum, split) => sum + toNumber(split.discountAmount), 0)) / 100
        : toNumber(formData.discountAmount),
    ),
  );
  /*
   * 회차 금액 칸에 보일 값. 적어 둔 것이 없으면 개월수로 나눈 기본값이다.
   *
   * 빈 칸으로 두지 않는 까닭은 고칠 자리가 한두 회차뿐이기 때문이다 -- 기본값을 보여
   * 주고 다른 회차만 고치게 한다.
   */
  const shareInputs = installmentShareInputs(
    installmentBase,
    Number(formData.installmentMonths),
    formData.installmentShares,
    ledgerCurrency,
  );

  /*
   * 회차 이자 칸에 보일 값. 고른 방식으로 계산한 기본값이고, 고치면 그 값이 남는다.
   *
   * 방식을 고르지 않았으면 빈 칸이다 -- 0 으로 채우면 "이자 없음"과 구별되지 않는다.
   */
  const interestInputs = installmentInterestInputs({
    total: installmentBase,
    months: Number(formData.installmentMonths),
    principals: shareInputs,
    mode: formData.installmentInterestMode,
    monthlyPayment: formData.installmentMonthlyPayment,
    annualRate: formData.installmentAnnualRate,
    saved: formData.installmentInterestShares,
    currency: ledgerCurrency,
  });

  /**
   * 저장하면 얼마로 기록되는지. 저장 전에 눈으로 확인하게 한다.
   *
   * 청구액을 넣었으면 그 금액이 그대로 기록된다. 환율을 곱하지 않는다.
   */
  const convertedPreview = (() => {
    if (!needsRate) return '';
    if (hasBilled) return formatCurrency(formData.billedAmount, ledgerCurrency);

    const rate = Number(rateOf(formData.currency));
    const amount = Number(formData.amount);
    if (!Number.isFinite(rate) || !Number.isFinite(amount) || rate <= 0 || amount <= 0) return '';
    return formatCurrency(amount * rate, ledgerCurrency);
  })();

  /** 청구액을 넣었을 때 실제로 적용되는 환율. 저장 전에 함께 보여 준다. */
  const derivedRate = (() => {
    const amount = toNumber(formData.amount);
    if (!hasBilled || amount <= 0) return '';
    return formatNumber(Math.round((toNumber(formData.billedAmount) / amount) * 100) / 100);
  })();

  /**
   * 이 거래에서 깎인 금액의 합.
   *
   * 분할이면 줄마다 적은 값을 더한 것이 그 거래의 차감이다. "차감을 실적에서 뺄지"는
   * 거래에 하나뿐이라 그 판단에 이 합을 쓴다.
   */
  const totalDiscount = String(
    hasSplits
      ? formData.splits.reduce((sum, split) => sum + toNumber(split.discountAmount), 0)
      : toNumber(formData.discountAmount),
  );

  return {
    transferCardSide,
    transferBothCards,
    currencyOfMethod,
    paymentCurrency,
    toCurrency,
    isCrossCurrencyTransfer,
    needsRate,
    needsBilled,
    hasBilled,
    isCreditCardSelected,
    mustBill,
    canInstall,
    hasSplits,
    installmentBase,
    shareInputs,
    interestInputs,
    convertedPreview,
    derivedRate,
    totalDiscount,
  };
}
