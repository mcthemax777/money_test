/*
 * 있는 거래와 보관함 후보를 거래 폼 값으로 되돌린다.
 *
 * 앱은 core 의 `entryFormFromItem`·`entryFormFromDraft` 가 같은 일을 한다. 두 폼의 값
 * 모양이 다르므로(이쪽은 대분류·소분류를 나눠 들고, 결제수단도 method + id 로 나뉜다)
 * 함수를 공유하지 않고 규칙만 같게 둔다.
 */
import type { Category } from '@money/core/lib/types';
import { toNumber } from '@money/core/lib/money';
import { dateKeyOf, nowTimeKey, timeInputOf } from '@money/core/lib/datetime';
import { foreignEditAmounts, interestInAmount, withoutInterest } from '@money/core/data/entry-form';
import type { InstallmentInterestMode } from '@money/core/lib/period-ledger';
import { isCurrencyCode, newLineKey, type CurrencyCode, type EntryDraftDto } from '@money/types';
import type { EntryListItem } from '@/components/TransactionItem';
import {
  emptyEntryForm,
  grossAmountOf,
  grossOfLine,
  isSplitEntry,
  splitCategoryOf,
  type EntryFormValues,
} from './editor-form';

interface FormValueContext {
  categories: Category[];
  ledgerCurrency: CurrencyCode;
  timeZone: string;
  /** 결제수단의 통화. 카드는 결제 통장을 따른다. */
  currencyOfMethod: (accountId?: string | null, cardId?: string | null) => CurrencyCode;
}

/**
 * 있는 거래를 폼 값으로 되돌린다.
 *
 * 고치기와 베끼기가 함께 쓴다. 두 길의 값이 갈리면 "고쳐 저장한 것"과 "베껴 저장한
 * 것"이 서로 다른 거래가 되므로 채우는 자리를 하나로 둔다. 어느 거래를 고치는가
 * (`editingId`)와 그 거래를 본 시점의 판(`baseHlc`)만 부르는 쪽이 정한다.
 */
export function formValuesOfEntry(
  shown: EntryListItem,
  { categories, ledgerCurrency, timeZone, currencyOfMethod }: FormValueContext,
) {
  // 표시 통화로 옮긴 줄이면 옮기기 전의 것으로 연다 (`editSource`). 폼은 적었던 통화의 값을 든다.
  const entry = shown.editSource ?? shown;
  const category = splitCategoryOf(categories, entry.categoryId);
  const fee = splitCategoryOf(categories, entry.feeCategoryId);
  // 분류 하나짜리 거래의 그 줄. 이체·카드 대금 결제에는 없다.
  const only = isSplitEntry(entry) ? null : entry.lines[0] ?? null;

  /*
   * 이 거래의 금액에 들어 있는 할부 이자. 유이자 할부가 아니면 0 이다.
   *
   * 금액 칸과 나눈 줄에서 같은 규칙으로 되뺀다 (`entryFormFromItem` 과 한 함수다).
   */
  const interest = interestInAmount(entry);
  // 외화로 적은 거래는 원래 금액에서 정가와 수수료를 되살린다 (앱과 같은 함수).
  const foreign = foreignEditAmounts(entry);

  /*
   * 청구액을 되돌려 놓을 수 있는 거래인지.
   *
   * 아직 잠정인 거래는 채우지 않는다. 그 금액은 사용자가 넣은 적 없는 서버
   * 추정값인데, 칸에 적혀 있으면 확정된 금액처럼 보이고 그대로 저장하는 순간
   * 확정으로 넘어간다. 확정한 사실이 없는데 확정 표시가 붙으면 안 된다.
   *
   * 나머지 조건은 폼의 needsBilled 와 같다.
   */
  const billedPrefill =
    !entry.rateProvisional &&
    isCurrencyCode(entry.originalCurrency) &&
    entry.originalCurrency !== ledgerCurrency &&
    currencyOfMethod(entry.accountId, entry.cardId) === ledgerCurrency
      ? entry.amount
      : '';

  return {
    /*
     * 카드대금 결제는 이체 폼으로 편다.
     *
     * 저장된 전표는 통장 다리와 카드 부채 다리 둘뿐이라 이체와 같은 모양이고, 목록이
     * 나간 쪽을 accountId, 들어온 쪽을 toAccountId 로 준다. 두 값을 다 들고 있어야
     * 저장할 때 그대로 돌려보낼 수 있으므로 method로 하나만 고르지 않는다. 앱도 같은
     * 규칙이다 (core 의 entryFormFromItem).
     */
    method: entry.kind === 'card_payment' ? 'account' : entry.cardId ? 'card' : 'account',
    accountId: entry.accountId || '',
    cardId: entry.cardId || '',
    personId: entry.personId || '',
    type: entry.kind === 'card_payment' ? 'transfer' : entry.kind,
    mainCategoryId: category.mainCategoryId,
    subCategoryId: category.subCategoryId,
    /*
     * 금액과 통화.
     *
     * 서버는 목록 금액을 언제나 기준통화 환산액으로 준다. 외화 거래를 고칠 때
     * 환산액을 보여 주면 사용자가 입력했던 값과 달라 혼란스러우므로, 원 통화
     * 금액이 함께 왔으면 그것을 되돌려 놓는다.
     *
     * 유이자 할부의 이자는 전표 금액 안에 있다. 폼은 **산 값**을 든다. 갚을 돈 전부를
     * 금액 칸에 넣으면 회차 원금의 합과 어긋나 저장이 막히고, 사용자가 적은 적 없는
     * 숫자가 칸에 들어앉는다. 되빼는 규칙은 앱과 한 함수를 쓴다.
     */
    amount: foreign?.amount ?? withoutInterest(grossAmountOf(entry), interest.total, interest.total),
    currency: isCurrencyCode(entry.originalCurrency) ? entry.originalCurrency : ledgerCurrency,
    /*
     * 확정된 거래만 금액을 되돌려 놓는다 (billedPrefill 참고).
     *
     * 그대로 저장하면 금액이 한 푼도 움직이지 않는다. 잠정인 거래는 비워 두어,
     * 설명만 고쳐 저장해도 확정으로 넘어가지 않게 한다.
     */
    billedAmount: billedPrefill,
    // 결제수단 통화와 다른 통화로 기록된 거래다. 결제수단을 바꿔도 유지한다.
    currencyTouched:
      isCurrencyCode(entry.originalCurrency) &&
      entry.originalCurrency !== currencyOfMethod(entry.accountId, entry.cardId),
    description: entry.description || '',
    merchant: entry.merchant || '',
    detailedNote: entry.detailedNote || '',
    toAccountId: entry.toAccountId || '',
    // 받는 계좌 통화 그대로인 값을 쓴다. entry.amount는 기준통화 환산액이라
    // 통화가 다른 환전에서는 단위가 어긋난다.
    toAmount: entry.toAmount ?? '',
    // 수수료는 별도 다리라 예전에는 비워뒀다. 이제 목록 응답에 들어 있어 그대로 채운다.
    // 외화 통장의 이체면 수수료도 그 통화로 되돌린다. 목록의 수수료는 장부 통화다.
    transferFee: foreign ? foreign.fee : toNumber(entry.feeAmount) > 0 ? entry.feeAmount ?? '' : '',
    transferFeeMainCategoryId: fee.mainCategoryId,
    transferFeeSubCategoryId: fee.subCategoryId,
    date: dateKeyOf(entry.date, timeZone),
    time: timeInputOf(entry.date, timeZone),
    installmentMonths: entry.installmentMonths ? String(entry.installmentMonths) : '',
    /*
     * 옛 할부에는 이 값이 없다(null). 그때는 수수료 전표가 없다는 뜻이라 무이자로 연다 --
     * 고치려고 열었을 뿐인데 저장이 막히면 까닭을 알 수 없다.
     */
    installmentInterest: entry.installmentMonths
      ? entry.installmentInterest
        ? ('interest' as const)
        : ('free' as const)
      : ('' as const),
    // 적어 둔 값이 없으면 비워 둔다. 화면이 개월수로 나눈 기본값을 채워 보여 준다.
    installmentShares: entry.installmentShares ?? [],
    /*
     * 이자를 무엇으로 정했는지는 적어 둔 입력이 말해 준다. 둘 다 없으면 사용자가
     * 손으로 적은 이자라, 방식을 고르지 않은 채로 연다.
     */
    installmentInterestMode: (entry.installmentMonthlyPayment
      ? 'fixed'
      : entry.installmentAnnualRate
        ? 'rate'
        : '') as InstallmentInterestMode,
    installmentMonthlyPayment: entry.installmentMonthlyPayment ?? '',
    installmentAnnualRate: entry.installmentAnnualRate ?? '',
    installmentInterestShares: entry.installmentInterestShares ?? [],
    /*
     * 줄에 달린 값들. 분류 하나짜리 거래는 그 줄의 것을 그대로 든다.
     *
     * 차감은 목록의 금액이 이미 차감된 뒤이므로 위 `amount` 와 짝으로 되돌린다. 통화는
     * 위 `amount` 와 같다 -- 외화 거래면 둘 다 그 외화다.
     *
     * 나눈 거래는 아래 `splits` 가 줄마다 들고, 여기 담긴 것은 줄을 새로 더할 때 쓰는
     * 기본값으로만 남는다. 이체와 카드 대금 결제에는 분류 줄이 없어 빈 값이다.
     */
    lineKey: only?.lineKey ?? newLineKey(),
    discountAmount: only?.discountAmount ?? '',
    // 실적 두 칸은 거래에 하나씩이다. 분할이어도 여기서 든다.
    countsPerformance: entry.countsPerformance,
    discountCountsPerformance: entry.discountCountsPerformance,
    tagIds: isSplitEntry(entry) ? [] : (only?.tags ?? entry.tags).map((tag) => tag.id),
    /*
     * 나눈 줄.
     *
     * 대표 분류(`categoryId`)는 그중 첫 줄이라, 그것만 폼에 담아 저장하면 나머지
     * 줄이 조용히 사라진다. 줄이 실려 오지 않은 분할은 아예 열지 않는다
     * (`handleEditClick`).
     */
    splits: isSplitEntry(entry)
      ? entry.lines.map((line, index) => ({
          ...splitCategoryOf(categories, line.categoryId),
          // 폼은 정가를 든다. 목록의 금액은 차감을 뺀 뒤의 값이고 이자를 품는다.
          amount: withoutInterest(grossOfLine(line), interest.lineShares[index], interest.total),
          lineKey: line.lineKey,
          discountAmount: line.discountAmount ?? '',
          tagIds: line.tags.map((tag) => tag.id),
        }))
      : [],
  };
}

/**
 * 보관함의 후보로 폼을 채운다.
 *
 * 앱은 core 의 `entryFormFromDraft` 가 같은 일을 한다. 읽은 것만 덮어쓰고 나머지는
 * 기본값이다 -- 없는 칸을 비우면 오늘 날짜와 "나" 같은 기본값까지 지워진다.
 */
export function formValuesOfDraft(
  draft: EntryDraftDto.Response,
  {
    categories,
    ledgerCurrency,
    timeZone,
    myPersonId,
  }: Omit<FormValueContext, 'currencyOfMethod'> & { myPersonId: string | null | undefined },
): EntryFormValues {
  const category = splitCategoryOf(categories, draft.categoryId);
  const when = draft.occurredAt ? new Date(draft.occurredAt) : null;
  const hasWhen = when !== null && !Number.isNaN(when.getTime());
  const type = draft.kind === 'income' || draft.kind === 'transfer' ? draft.kind : 'expense';

  return {
    ...emptyEntryForm(timeZone, ledgerCurrency),
    time: nowTimeKey(timeZone),
    type,
    // 카드가 있으면 카드로 낸 것이다. 없으면 통장이고, 둘 다 없으면 사람이 고른다.
    method: draft.cardId ? 'card' : 'account',
    cardId: draft.cardId ?? '',
    accountId: draft.accountId ?? '',
    personId: draft.personId || myPersonId || '',
    amount: draft.amount ?? '',
    /*
     * 통화. 장부 통화와 같으면 그대로 둔다.
     *
     * 후보에는 "12,000원"에서 읽은 'KRW' 가 담기는데, 장부 통화가 원화인 가계부에서
     * 그 값을 넣으면 환율·청구액 칸이 열린다. 같은 통화면 환산할 것이 없다.
     */
    currency: draft.currency && isCurrencyCode(draft.currency) ? draft.currency : ledgerCurrency,
    currencyTouched: Boolean(draft.currency && draft.currency !== ledgerCurrency),
    description: draft.description ?? draft.merchant ?? '',
    merchant: draft.merchant ?? '',
    mainCategoryId: type === 'transfer' ? '' : category.mainCategoryId,
    subCategoryId: type === 'transfer' ? '' : category.subCategoryId,
    /*
     * 이체의 받는 통장과 수수료. 반복에 적어 둔 것이 후보를 지나 여기까지 온다.
     *
     * 알림 이체에는 비어 있다(문구에서 받는 쪽을 알 수 없다). 앱은 core 의
     * `entryFormFromDraft` 가 같은 일을 한다.
     */
    ...(type === 'transfer'
      ? {
          toAccountId: draft.toAccountId ?? '',
          ...(toNumber(draft.feeAmount) > 0
            ? (() => {
                const fee = splitCategoryOf(categories, draft.feeCategoryId ?? null);
                return {
                  transferFee: draft.feeAmount ?? '',
                  transferFeeMainCategoryId: fee.mainCategoryId,
                  transferFeeSubCategoryId: fee.subCategoryId,
                };
              })()
            : {}),
        }
      : {}),
    /*
     * 태그. 반복에 붙여 둔 것이 후보를 지나 여기까지 온다.
     *
     * 알림·캡처 후보에는 비어 있다 -- 문구에서 태그를 읽어 낼 방법이 없다. 지운
     * 태그의 id 가 섞일 자리는 없다(서버가 다리 표로 들고 있어 함께 사라진다).
     */
    tagIds: draft.tagIds ?? [],
    installmentMonths:
      type === 'expense' && draft.installmentMonths ? String(draft.installmentMonths) : '',
    // 후보에는 수수료 여부가 없다. 문자 한 줄로는 알 수 없어 사용자가 고른다.
    installmentInterest: '' as const,
    installmentShares: [] as string[],
    installmentInterestMode: '' as InstallmentInterestMode,
    installmentMonthlyPayment: '',
    installmentAnnualRate: '',
    installmentInterestShares: [] as string[],
    ...(hasWhen
      ? {
          date: dateKeyOf(when as Date, timeZone),
          time: timeInputOf(when as Date, timeZone),
        }
      : {}),
  };
}
