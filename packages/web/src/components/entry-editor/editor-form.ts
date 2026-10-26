/*
 * 거래 입력 폼의 값 모양과 그것을 다루는 순수 함수.
 *
 * 편집기(EntryEditor)와 그 칸들(entry-editor/*)이 같은 모양을 본다. 화면 상태를 들지
 * 않으므로 여기 있는 것은 모두 값만 받아 값을 돌려준다.
 */
import type { Dispatch, SetStateAction } from 'react';
import type { MessageKey } from '@money/core/lib/i18n';
import type { Category } from '@money/core/lib/types';
import { toAmountString } from '@money/core/lib/money';
import { todayKey } from '@money/core/lib/datetime';
import type { InstallmentInterestMode } from '@money/core/lib/period-ledger';
import { Dec, newLineKey, type CurrencyCode } from '@money/types';
import type { EntryListItem } from '@/components/TransactionItem';

/** 금액을 센트(소수 둘째 자리) 정수로. 실수로 더한 금액을 견줄 때 쓴다 -- 0.1 + 0.2 가 0.3 이 아니다. */
export const toCents = (amount: number) => Math.round(amount * 100);

/**
 * 분류를 나눈 한 줄.
 *
 * 폼은 대분류·소분류를 나눠 들고(웹의 분류 칸이 두 개다), 저장 직전에 가장 구체적인
 * 것 하나로 합쳐 보낸다. 서버는 줄마다 카테고리 하나와 금액만 받는다.
 */
export interface EntryFormSplitRow {
  mainCategoryId: string;
  subCategoryId: string;
  /** 정가. 차감을 빼기 전의 값이다. */
  amount: string;
  /**
   * 이 줄의 신원. 줄을 더하는 순간 붙고, 편집 내내 바뀌지 않는다.
   *
   * 저장할 때마다 서버가 다리를 지우고 새로 만들기 때문에 다리 id 로는 줄을 가리킬 수
   * 없다. 줄에 붙는 것(태그·차감)이 이 키에 매달리고, 서버는 키 없는 요청을 거절한다.
   */
  lineKey: string;
  /** 이 줄에서 깎인 금액. 정가보다 클 수 없다. 같으면 그 줄이 0원으로 남는다. */
  discountAmount: string;
  /** 이 줄에 붙일 태그. 나눈 두 줄이 서로 다른 태그를 가질 수 있다. */
  tagIds: string[];
}

/** 나눈 거래인가. 줄이 둘 이상인 지출·수입이다. */
export function isSplitEntry(entry: EntryListItem): boolean {
  return (entry.kind === 'expense' || entry.kind === 'income') && entry.splitCount > 1;
}

/** 빈 분할 줄. 줄 키는 여기서 붙는다. */
export function blankSplitRow(): EntryFormSplitRow {
  return {
    mainCategoryId: '',
    subCategoryId: '',
    amount: '',
    lineKey: newLineKey(),
    discountAmount: '',
    tagIds: [],
  };
}

/**
 * 분할 줄의 금액. 비었거나 0 이하면 null 이다.
 *
 * 화면 값은 문자열이라 숫자로 바꿔 더하면 원 단위가 어긋난다. Dec 로 받아 두면 줄들의
 * 합이 전체 금액과 같은지 정확히 견줄 수 있다.
 */
export function splitAmountOf(value: string): Dec | null {
  const amount = Dec.of(toAmountString(value));
  return amount.isPositive() ? amount : null;
}

/**
 * 빈 거래 입력 폼.
 *
 * 처음 상태, 저장한 뒤, 팝업을 닫을 때 모두 이 값으로 되돌린다.
 *
 * 예전에는 같은 객체를 세 곳에 따로 적어 두어 서로 어긋났다. 저장 뒤 되돌리는 쪽만
 * method가 'card'로 남아 있어서, 거래를 수정하고 나서 거래 추가를 열면 수입·이체 탭이
 * 잠겨 있었다(카드로는 지출만 만들 수 있어 탭을 잠근다). 팝업을 닫으면 다른 쪽 초기화가
 * 돌아 그때는 풀렸다.
 */
export function emptyEntryForm(timeZone: string, ledgerCurrency: CurrencyCode) {
  return {
    method: 'account',
    accountId: '',
    cardId: '',
    personId: '',
    type: 'expense',
    mainCategoryId: '',
    subCategoryId: '',
    amount: '',
    description: '',
    merchant: '',
    detailedNote: '',
    toAccountId: '',
    /** 통화가 다른 환전에서 실제로 받은 금액 (받는 계좌 통화) */
    toAmount: '',
    transferFee: '',
    transferFeeMainCategoryId: '',
    transferFeeSubCategoryId: '',
    date: todayKey(timeZone),
    time: '',
    /** 할부 개월수. 빈 값이거나 1이면 일시불 */
    installmentMonths: '',
    /** 할부에 수수료가 붙는가. '' 는 아직 고르지 않았다는 뜻이다 (기본값을 두지 않는다). */
    installmentInterest: '' as '' | 'free' | 'interest',
    /** 회차별 원금. 비어 있으면 개월수로 나눈 기본값을 쓴다. */
    installmentShares: [] as string[],
    /**
     * 유이자 할부의 이자를 어떻게 정하는가. '' 는 아직 고르지 않았다는 뜻이다.
     *
     * 고정형은 매달 같은 금액을 내고, 변동형은 연이율만 정해져 있다. 고르지 않으면
     * 이자 칸이 비어 있고 명세서를 보고 회차마다 적는다.
     */
    installmentInterestMode: '' as InstallmentInterestMode,
    /** 고정형의 월 납입액. */
    installmentMonthlyPayment: '',
    /** 변동형의 연이율 (퍼센트). */
    installmentAnnualRate: '',
    /** 회차별 이자. 비어 있으면 고른 방식으로 계산한 기본값을 쓴다. */
    installmentInterestShares: [] as string[],
    /**
     * 결제 자리에서 깎인 금액. 포인트 사용, 자동할인, 그리고 **취소**가 모두 이 칸이다.
     *
     * 셋은 전표에서 같은 모양이다 -- 정가(`amount`)는 그대로인데 계좌에서 빠지는 돈만
     * 적다. 전액을 적으면 0원 거래로 남는다. 통화는 `amount` 와 같다.
     */
    discountAmount: '',
    /**
     * 이 거래를 카드 실적에 셀지. 카드를 골랐을 때만 화면에 뜬다.
     *
     * 기본값이 갈래마다 다르다 -- 지출은 켜짐, 카드로 들어온 수입은 꺼짐이다.
     * 꺼도 갚을 대금은 그대로다. 실적과 청구액은 다른 값이다.
     */
    countsPerformance: true,
    /**
     * 차감·취소 금액을 카드 실적에서도 뺄지. 차감을 적은 카드 지출에만 화면에 뜬다.
     *
     * **기본은 뺀다.** 다리에 이미 깎인 금액이 들어가 있어 그것이 지금까지의 동작이다.
     * 끄면 실적만 정가로 세고, 갚을 대금은 어느 쪽이든 깎인 금액 그대로다.
     */
    discountCountsPerformance: true,
    /** 위 금액을 입력한 통화. 결제수단을 고르면 그 계좌 통화로 맞춰진다. */
    currency: ledgerCurrency,
    /**
     * 통장에서 실제로 빠진 기준통화 금액. 환율 대신 이것을 넣을 수 있다.
     *
     * 환율은 카드사가 결제일에 정하는 값이라 미리 알 수 없고, 명세서에 찍히는
     * 것도 대개 금액이다. 둘 중 하나만 채운다.
     */
    billedAmount: '',
    /**
     * 통화를 사용자가 직접 골랐는지.
     *
     * 결제수단을 바꿀 때 통화를 덮어쓸지 가르는 값이다. 자동으로 채워진 통화는
     * 덮어써도 되지만, 사용자가 고른 통화는 지우면 안 된다.
     */
    currencyTouched: false,
    /**
     * 이 거래에 붙일 태그. 카테고리와 달리 여럿을 고를 수 있다.
     *
     * 갈래(지출·수입·이체)를 가리지 않는다. 태그는 "무엇에 쓴 돈인가"가 아니라 "어느
     * 일에 딸린 거래인가"라, 여행에는 항공권 지출과 환불 수입이 함께 든다.
     */
    tagIds: [] as string[],
    /**
     * 분류를 나눈 줄들. 비어 있으면 분류 하나짜리 거래다.
     *
     * 줄이 있는 동안에는 위의 대분류·소분류를 쓰지 않는다. 저장도 줄들만 보낸다.
     */
    splits: [] as EntryFormSplitRow[],
    /**
     * 분류 하나짜리 거래의 줄 키. 나눈 거래는 줄마다 따로 든다.
     *
     * 폼을 열 때 정해지고 저장할 때까지 바뀌지 않는다. 이 값이 이어져야 그 줄에 붙은
     * 태그와 차감이 수정을 건너 살아남는다.
     */
    lineKey: newLineKey(),
  };
}

/** 거래 입력 폼의 값. 칸 컴포넌트들이 이 모양을 받아 고친다. */
export type EntryFormValues = ReturnType<typeof emptyEntryForm>;

/** 폼 값을 갈아 끼우는 함수. `useState` 의 setter 그대로다. */
export type SetEntryForm = Dispatch<SetStateAction<EntryFormValues>>;

/** 고르는 칸(CustomSelect)의 한 줄. */
export interface SelectOption {
  id: string;
  name: string;
  group?: string;
}

/** 거래 추가/수정 팝업 맨 위의 유형 탭 */
export const ENTRY_TYPE_TABS = [
  { id: 'expense', labelKey: 'editor.kind.expense' },
  { id: 'income', labelKey: 'editor.kind.income' },
  { id: 'transfer', labelKey: 'editor.kind.transfer' },
] as const;

export const ENTRY_KIND_KEY: Record<string, MessageKey> = {
  expense: 'editor.kind.expense',
  income: 'editor.kind.income',
  payback: 'editor.kind.payback',
  transfer: 'editor.kind.transfer',
  card_payment: 'editor.kind.card_payment',
  adjustment: 'editor.kind.adjustment',
};

/**
 * 내용을 베껴 새로 적을 수 있는 거래.
 *
 * 두 가지를 뺀다. 잔액 맞추기가 만든 조정은 이 폼이 만드는 것이 아니고(계좌 잔액에서
 * 역산된다), 분할은 이 폼이 분류 하나만 다뤄 줄들이 합쳐진 한 건이 **새로** 남는다 --
 * 고치기는 원본이 그 자리에 있어 알아챌 수 있지만 새 거래는 그렇지 않다.
 *
 * 상세를 이 컴포넌트 밖에서 그리는 화면(거래)도 이것으로 단추를 그린다. 규칙을 그쪽에
 * 또 적으면 여기가 막는 거래에 단추가 남는다.
 */
export function isCopyableEntry(entry: EntryListItem): boolean {
  return entry.kind !== 'adjustment' && entry.kind !== 'payback' && entry.splitCount <= 1;
}

/**
 * 이 폼으로 고칠 수 있는 거래.
 *
 * 잔액 조정만 뺀다. 기초잔액 전표는 계좌 잔액에서 역산되는 값이라 거래 폼으로 고칠
 * 대상이 아니다 (자산 화면의 잔액 수정이 담당한다).
 *
 * 카드대금 결제는 연다. 결제일이 오기 전에 잘못 눌러 넣은 결제를 되돌리려면 금액이나
 * 날짜를 고쳐야 하고, 그것이 사용 내역을 건드리지 않고 바로잡는 가장 짧은 길이다.
 * 카드와 통장은 폼이 잠근다 (바꿀 일이면 삭제가 낫다).
 *
 * 분할 거래도 연다. 베끼기와 달리 원본이 그 자리에 있어 줄이 합쳐진 것을 알아챌 수 있다.
 *
 * 페이백도 연다. 다만 이 폼이 아니라 페이백 편집기(`PaybackEditor`)로 간다 -- 고르는 칸이
 * 달라서다 (`handleEditClick`). 베끼기는 두지 않는다(`isCopyableEntry`).
 *
 * 상세를 이 컴포넌트 밖에서 그리는 화면(거래)도 이것으로 단추를 그린다. 규칙을 그쪽에
 * 또 적으면 여기가 막는 거래에 단추가 남는다.
 */
export function isEditableEntry(entry: EntryListItem): boolean {
  return entry.kind !== 'adjustment';
}

/**
 * 대분류/소분류로 나눈다.
 *
 * 서버는 가장 구체적인 카테고리 하나만 들고 있다(대분류만 지정했으면 그게 곧 leaf다).
 * 폼은 두 칸으로 나뉘어 있으므로 parentId를 보고 되돌린다.
 */
export function splitCategoryOf(categories: Category[], categoryId: string | null) {
  if (!categoryId) return { mainCategoryId: '', subCategoryId: '' };
  const category = categories.find((c) => c.id === categoryId);
  return category?.parentId
    ? { mainCategoryId: category.parentId, subCategoryId: category.id }
    : { mainCategoryId: categoryId, subCategoryId: '' };
}

/** 고른 대분류에 딸린 소분류 고르기 목록. 대분류를 고르기 전에는 고를 것이 없다고 알린다. */
export function subCategoryOptionsOf(
  categories: Category[],
  mainCategoryId: string,
  noneLabel: string,
): SelectOption[] {
  return mainCategoryId
    ? categories
        .filter((c) => Boolean(c.parentId) && c.parentId === mainCategoryId)
        .map((cat) => ({ id: cat.id, name: cat.name }))
    : [{ id: '', name: noneLabel }];
}

/**
 * 목록 한 줄의 금액을 폼이 드는 정가로 되돌린다.
 *
 * 목록의 금액은 차감을 뺀 뒤의 값이고(실제로 나간 돈), 되돌린 결제는 음수다. 폼의
 * 금액 칸은 언제나 "깎이기 전의 값을 양수로" 이므로 둘을 여기서 되돌린다.
 */
export function grossAmountOf(entry: EntryListItem): string {
  const magnitude = Dec.of(toAmountString(entry.amount)).abs();
  if (!entry.discountAmount) return magnitude.toString();
  return magnitude.plus(toAmountString(entry.discountAmount)).toString();
}

/** 줄 하나의 정가. 목록이 주는 줄 금액도 차감을 뺀 뒤의 값이다. */
export function grossOfLine(line: { amount: string; discountAmount: string | null }): string {
  if (!line.discountAmount) return line.amount;
  return Dec.of(toAmountString(line.amount))
    .plus(toAmountString(line.discountAmount))
    .toString();
}
