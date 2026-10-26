/**
 * 거래 입력 폼의 값과 규칙.
 *
 * 화면이 다루는 것은 "5,000원, 식비, 신한카드, 어제"이고 서버가 받는 것은 `EntryDto`다.
 * 그 사이를 옮기는 일이 여기 있다. 컴포넌트 안에 두면 검사할 방법이 없고, 웹과 앱이
 * 각자 적으면 같은 입력이 두 화면에서 다른 거래가 된다.
 *
 * 예외를 던지지 않고 위반을 값으로 돌려주는 것은 `ledger-rules` 와 같은 이유다. 부르는
 * 쪽이 그것을 자기 화면의 문구로 바꾼다.
 *
 * 갈래는 넷이다 -- 지출·수입·이체·카드사 대금 이동. 지출과 수입은 **분할**(분류 여럿)을,
 * 모든 갈래가 **외화**(통화·환율·청구액)를 받는다.
 *
 * 이 파일은 바깥에서 가져다 쓰는 입구다. 내용은 맡은 일에 따라 나뉘어 있다 (2026-10-26):
 *
 *   entry-form-values   폼의 값 모양, 빈 폼, 결제수단 글자, 함께 쓰는 작은 규칙
 *   entry-form-open     목록 한 줄·원거래·보관함 후보에서 폼을 연다
 *   entry-form-check    저장할 수 있는 값인지 본다
 *   entry-form-request  폼을 서버가 받는 요청으로 조립한다
 */

export {
  type EntryFormKind,
  type EntryFormSplit,
  type PaymentMethodValue,
  type EntryFormValues,
  type EntryFormDefaults,
  newSplitLine,
  accountValue,
  cardValue,
  parseMethod,
  emptyEntryForm,
  defaultCountsPerformance,
  showDiscountPerformance,
  installmentBaseAmount,
  totalDiscountOf,
  isTimeKey,
} from './entry-form-values';
export {
  type PaybackCard,
  entryFormFromItem,
  foreignEditAmounts,
  paybackMethodOf,
  paybackFormFrom,
  interestInAmount,
  withoutInterest,
  entryFormFromDraft,
} from './entry-form-open';
export { type EntryFormViolation, checkEntryForm } from './entry-form-check';
export { defaultSharesToSend, entryFormToRequest } from './entry-form-request';
