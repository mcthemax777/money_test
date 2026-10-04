/**
 * 폼 검사(`checkEntryForm`)가 짚은 자리를 화면의 문구로. 코드 이름은 규칙 쪽 이름 그대로다.
 *
 * 거래 편집기와 페이백 편집기(웹·앱)가 함께 쓴다. 화면마다 표를 두면 한쪽에만 새 코드가
 * 들어가고, 다른 쪽은 코드 이름을 그대로 띄운다.
 */
import type { MessageKey } from './i18n';

export const ENTRY_FORM_VIOLATION_KEY: Record<string, MessageKey> = {
  PERSON_REQUIRED: 'editor.personRequired',
  AMOUNT_INVALID: 'entryForm.amountRequired',
  DATE_INVALID: 'entryForm.dateInvalid',
  TIME_INVALID: 'entryForm.timeInvalid',
  CATEGORY_REQUIRED: 'entryForm.categoryRequired',
  ACCOUNT_REQUIRED: 'entryForm.accountRequired',
  FROM_ACCOUNT_REQUIRED: 'entryForm.accountRequired',
  TO_ACCOUNT_REQUIRED: 'entryForm.toAccountRequired',
  TRANSFER_SAME_ACCOUNT: 'error.TRANSFER_SAME_ACCOUNT',
  FEE_INVALID: 'entryForm.feeInvalid',
  FEE_CATEGORY_REQUIRED: 'editor.feeCategoryRequired',
  SPLIT_SUM_MISMATCH: 'editor.splitSumMismatch',
  SPLIT_CATEGORY_REQUIRED: 'editor.splitCategoryRequired',
  SPLIT_AMOUNT_INVALID: 'editor.splitAmountInvalid',
  RATE_INVALID: 'editor.rateInvalid',
  CARD_REQUIRED: 'editor.cardRequired',
  DISCOUNT_INVALID: 'entryForm.discountInvalid',
  DISCOUNT_TOO_LARGE: 'entryForm.discountTooLarge',
  DISCOUNT_AMOUNT_REQUIRED: 'entryForm.discountAmountRequired',
  INSTALLMENT_INTEREST_REQUIRED: 'entryForm.installmentInterestRequired',
  INSTALLMENT_INTEREST_CURRENCY: 'entryForm.installmentInterestCurrency',
  INSTALLMENT_SHARES_COUNT: 'entryForm.installmentSharesCount',
  INSTALLMENT_SHARE_NEGATIVE: 'entryForm.installmentShareNegative',
  INSTALLMENT_SHARES_SUM: 'entryForm.installmentSharesSum',
  INSTALLMENT_PAYMENT_INVALID: 'entryForm.installmentPaymentInvalid',
  INSTALLMENT_PAYMENT_TOO_SMALL: 'entryForm.installmentPaymentTooSmall',
  INSTALLMENT_RATE_INVALID: 'entryForm.installmentRateInvalid',
  INSTALLMENT_INTEREST_SHARES_COUNT: 'entryForm.installmentInterestSharesCount',
  INSTALLMENT_INTEREST_NEGATIVE: 'entryForm.installmentInterestNegative',
  TRANSFER_BOTH_CARDS: 'entryForm.bothCards',
  PAYBACK_LINE_REQUIRED: 'payback.lineRequired',
};
