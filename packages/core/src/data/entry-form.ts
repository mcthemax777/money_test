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
 */

import {
  Dec,
  type EntryDto,
  type EntryListItem,
  newLineKey,
  zonedFormValueToUtc,
} from '@money/types';

import { dateKeyOf, isDateKey, nowTimeKey, timeInputOf, todayKey } from '../lib/datetime';

/**
 * 이 폼이 다루는 갈래. 셋뿐이다.
 *
 * **카드대금 결제는 이체다.** 통장과 카드 부채 계정 사이를 돈이 오가는 일이라 규칙이
 * 이체와 같고, 갈래를 따로 두면 계좌를 고르는 칸이 한 벌 더 생긴다. 저장된 전표는
 * `classifyEntry` 가 `card_payment` 로 되읽으므로 목록과 집계는 그대로다.
 *
 * 조정(adjustment)은 잔액 맞추기가 만드는 것이라 여기 없다.
 */
export type EntryFormKind = 'expense' | 'income' | 'transfer';

/**
 * 분할의 한 줄.
 *
 * 금액은 줄마다 따로 적고, 합이 전체 금액과 같아야 한다. 남는 것을 마지막 줄에 자동으로
 * 몰아주지 않는다 -- 사용자가 적은 숫자와 저장되는 숫자가 달라지면 안 된다.
 */
export interface EntryFormSplit {
  categoryId: string;
  /** 정가. 차감을 빼기 전의 값이다. */
  amount: string;
  /**
   * 이 줄의 신원. 줄을 더하는 순간 화면이 만들고, 편집 내내 들고 다닌다.
   *
   * 저장할 때마다 서버가 다리를 지우고 새로 만들기 때문에 다리 id 로는 줄을 가리킬 수
   * 없다. 줄에 붙는 것(태그·차감)이 이 키에 매달린다. 서버는 키 없는 요청을 거절한다.
   */
  lineKey: string;
  /**
   * 이 줄에서 깎인 금액. **정가보다 작아야 한다** -- 같으면 그 줄이 0원이 된다.
   *
   * 여행경비만 환불받았다면 그 줄에만 값이 실린다. 예전에는 전표에 하나만 두고 줄마다
   * 비율로 나눠서, 식비 줄까지 함께 깎였다.
   */
  discountAmount: string;
  /** 이 줄에 붙일 태그. 분할된 두 줄이 서로 다른 태그를 가질 수 있다. */
  tagIds: string[];
}

/** 분할 줄 하나를 새로 만든다. 줄 키는 여기서 붙는다. */
export function newSplitLine(values: Partial<EntryFormSplit> = {}): EntryFormSplit {
  return {
    categoryId: '',
    amount: '',
    discountAmount: '',
    tagIds: [],
    ...values,
    lineKey: values.lineKey ?? newLineKey(),
  };
}

/**
 * 결제수단 한 칸.
 *
 * 계좌와 카드를 한 목록에서 고르게 하려고 접두사를 붙인 문자열로 담는다. 둘을 따로 두면
 * 화면이 "계좌를 골랐다가 카드를 고르면 계좌를 비운다"를 따로 관리해야 한다.
 */
export type PaymentMethodValue = string;

export const accountValue = (id: string): PaymentMethodValue => `account:${id}`;
export const cardValue = (id: string): PaymentMethodValue => `card:${id}`;

export function parseMethod(value: PaymentMethodValue): {
  accountId?: string;
  cardId?: string;
} {
  if (value.startsWith('card:')) return { cardId: value.slice(5) };
  if (value.startsWith('account:')) return { accountId: value.slice(8) };
  return {};
}

export interface EntryFormValues {
  kind: EntryFormKind;
  personId: string;
  /** 프로젝트 타임존의 달력 날짜 'YYYY-MM-DD' */
  dateKey: string;
  /** 'HH:mm' */
  timeKey: string;
  description: string;
  amount: string;
  categoryId: string;
  /** 지출의 결제수단. 수입은 계좌만 고를 수 있다. */
  method: PaymentMethodValue;
  /** 이체에서 받는 계좌 */
  toAccountId: string;
  /** 할부 개월수. 빈 문자열이 일시불이다. */
  installmentMonths: string;
  /**
   * 분류 하나짜리 거래의 줄 키. 분할이면 `splits[].lineKey` 가 쓰인다.
   *
   * 폼을 열 때 정해지고 저장할 때까지 바뀌지 않는다. 이 값이 이어져야 그 줄에 붙은
   * 태그와 차감이 수정을 건너 살아남는다 (서버는 키 없는 요청을 거절한다).
   */
  lineKey: string;
  /**
   * 결제 자리에서 깎인 금액. 포인트 사용, 자동할인, 그리고 **취소**가 모두 이 칸이다.
   *
   * 셋은 전표에서 같은 모양이다 -- 정가(`amount`)는 그대로인데 계좌에서 빠지는 돈만
   * 적다. 둘의 차이가 실제로 나가는 금액이고, 같으면 0원 거래로 남는다.
   *
   * 통화는 `amount` 와 같다. 지출에만 뜻이 있고, 빈 문자열이면 차감이 없다.
   */
  discountAmount: string;
  /**
   * 이 거래를 카드 실적에 셀지. 카드를 골랐을 때만 화면에 뜬다.
   *
   * 기본값이 갈래마다 다르다 -- 지출은 켜짐, 카드로 들어온 수입은 꺼짐이다. 갈래를
   * 바꾸면 그 갈래의 기본값으로 되돌린다(`defaultCountsPerformance`).
   *
   * 꺼도 갚을 대금은 그대로다. 실적과 청구액은 다른 값이다.
   */
  countsPerformance: boolean;
  /**
   * 차감·취소 금액을 카드 실적에서도 뺄지. 차감을 적은 카드 지출에만 화면에 뜬다.
   *
   * **기본은 뺀다.** 다리에 이미 깎인 금액이 들어가 있어 그것이 지금까지의 동작이다.
   * 끄면 실적만 정가로 세고, 갚을 대금은 어느 쪽이든 깎인 금액 그대로다.
   *
   * 거래 자체를 실적에서 뺐으면(`countsPerformance` 가 꺼짐) 물을 것이 없다.
   */
  discountCountsPerformance: boolean;
  transferFee: string;
  transferFeeCategoryId: string;
  /**
   * 분할의 줄들. 비어 있으면 분류 하나짜리 거래다.
   *
   * 지출과 수입에만 뜻이 있다. 줄이 하나뿐이면 굳이 분할로 두지 않고 `categoryId` 를 쓴다
   * -- 저장되는 전표는 어차피 같고, 화면도 단순해진다.
   */
  splits: EntryFormSplit[];
  /**
   * 적은 금액의 통화. 기준통화(장부 통화)면 환산할 것이 없다.
   *
   * 빈 문자열은 "기준통화"다. 화면이 프로젝트의 기준통화를 알기 전에 폼을 만들 수 있어
   * 그 값을 여기 박아 두지 않는다.
   */
  currency: string;
  /** 1 currency = exchangeRate 기준통화. 통화가 기준통화면 쓰이지 않는다. */
  exchangeRate: string;
  /**
   * 이 거래에 붙일 태그. 카테고리와 달리 여럿을 고를 수 있다.
   *
   * 갈래(지출·수입·이체)를 가리지 않는다. 태그는 "무엇에 쓴 돈인가"가 아니라 "어느 일에
   * 딸린 거래인가"라, 여행에는 항공권 지출과 환불 수입이 함께 든다.
   */
  tagIds: string[];
  /**
   * 이 폼이 딛고 선 판. 고칠 거래를 열 때 받은 시계이고, 새로 적는 중이면 null 이다.
   *
   * 저장할 때 그대로 되돌려 준다(`EntryDto.UpdateRequest.baseHlc`). 폼을 열어 둔 사이에
   * 다른 사람이 같은 거래를 고쳤으면 서버가 그 값으로 알아채고 저장을 거절한다 --
   * 그러지 않으면 그 사람의 편집이 아무 말 없이 사라진다 (설계 문서의 D6).
   */
  baseHlc: string | null;
}

export interface EntryFormDefaults {
  personId?: string;
  timeZone: string;
  now?: Date;
  /**
   * 이 가계부의 장부 통화. 보관함의 후보를 폼으로 옮길 때만 쓴다.
   *
   * 후보에는 "12,000원"에서 읽은 'KRW' 가 그대로 담기는데, 장부 통화가 원화인
   * 가계부에서 그 값을 폼에 넣으면 환율 칸이 열린다. 같은 통화면 비워 두어야 한다.
   */
  ledgerCurrency?: string;
}

/** 빈 폼. 새로 열 때와 저장한 뒤 되돌릴 때 모두 이 값을 쓴다. */
export function emptyEntryForm({ personId = '', timeZone, now }: EntryFormDefaults): EntryFormValues {
  return {
    kind: 'expense',
    personId,
    dateKey: todayKey(timeZone),
    timeKey: nowTimeKey(timeZone),
    description: '',
    amount: '',
    categoryId: '',
    method: '',
    toAccountId: '',
    installmentMonths: '',
    // 분류 하나짜리 거래의 줄 키. 폼을 여는 자리에서 한 번 정해진다.
    lineKey: newLineKey(),
    discountAmount: '',
    countsPerformance: true,
    discountCountsPerformance: true,
    transferFee: '',
    transferFeeCategoryId: '',
    splits: [],
    currency: '',
    exchangeRate: '',
    tagIds: [],
    // 새로 적는 중이라 딛고 설 판이 없다. 만들기는 겹칠 대상 자체가 없다.
    baseHlc: null,
    ...(now ? { dateKey: dateKeyOf(now, timeZone), timeKey: timeInputOf(now, timeZone) } : {}),
  };
}

/**
 * 목록 한 줄의 금액을 폼이 드는 정가로 되돌린다.
 *
 * 목록의 금액은 차감을 뺀 뒤의 값이고(실제로 나간 돈), 되돌린 결제는 음수다. 폼의
 * 금액 칸은 언제나 "깎이기 전의 값을 양수로" 이므로 둘을 여기서 되돌린다.
 */
function grossOf(item: EntryListItem): string {
  const magnitude = item.amount.startsWith('-') ? item.amount.slice(1) : item.amount;
  if (!item.discountAmount) return magnitude;

  const net = toDec(magnitude);
  const discount = toDec(item.discountAmount);
  // 숫자가 아니면 손대지 않는다. 검증이 그 값을 막는다.
  if (!net || !discount) return magnitude;
  return net.plus(discount).toString();
}

/**
 * 이미 있는 거래를 폼으로 되돌린다.
 *
 * 목록 한 줄(`EntryListItem`)은 서버가 전표를 펴 준 값이라 폼에 필요한 것이 다 들어 있다.
 * 이 폼이 다루지 않는 갈래(잔액 맞추기가 만든 조정)는 null 을 돌려주고, 부르는 쪽이
 * "웹에서 고쳐 주세요"로 안내한다.
 *
 * **분할은 줄 전부가 있어야 되돌릴 수 있다.** 대표 분류 하나만 보고 저장하면 나머지가
 * 조용히 사라진다 -- 금액은 그대로인데 분류별 합계만 바뀌는, 알아채기 어려운 손실이다.
 * 그래서 줄이 여럿인데 `splits` 가 실려 오지 않았으면 열지 않는다(옛 서버가 그렇다).
 */
export function entryFormFromItem(
  item: EntryListItem,
  timeZone: string,
): EntryFormValues | null {
  if (
    item.kind !== 'expense' &&
    item.kind !== 'income' &&
    item.kind !== 'transfer' &&
    item.kind !== 'card_payment'
  ) {
    return null;
  }

  /*
   * 카드대금 결제는 이체 폼으로 편다.
   *
   * 저장된 전표는 통장 다리와 카드 부채 다리 둘뿐이라 이체와 같은 모양이다. 목록이
   * 나간 쪽을 `accountId`, 들어온 쪽을 `toAccountId` 로 주므로 방향도 그대로 살아난다
   * (대금 결제는 통장 -> 카드, 환불 입금은 카드 -> 통장).
   */
  const kind: EntryFormKind = item.kind === 'card_payment' ? 'transfer' : item.kind;

  const isSplit = (item.kind === 'expense' || item.kind === 'income') && item.splitCount > 1;
  /*
   * 분할은 줄 전부가 있어야 되돌릴 수 있다.
   *
   * 대표 분류 하나만 보고 저장하면 나머지가 조용히 사라진다 -- 금액은 그대로인데
   * 분류별 합계만 바뀌는, 알아채기 어려운 손실이다.
   */
  if (isSplit && item.lines.length !== item.splitCount) return null;

  // 분류 하나짜리 거래의 그 줄. 이체·카드 대금 결제에는 없다.
  const only = isSplit ? null : item.lines[0] ?? null;

  return {
    kind,
    personId: item.personId,
    // 이 줄을 본 시점의 판. 저장할 때 그대로 되돌려 주어 그 사이의 편집을 알아채게 한다.
    baseHlc: item.updatedHlc,
    dateKey: dateKeyOf(item.date, timeZone),
    timeKey: timeInputOf(item.date, timeZone),
    description: item.description,
    /*
     * 사용자가 적었던 금액으로 되돌린다.
     *
     * 목록의 `amount` 는 표시 통화로 환산한 값이다. 외화 거래를 그 값으로 열면 "$50"
     * 자리에 "70,000"이 들어앉고, 그대로 저장하면 50달러가 70,000달러가 된다.
     */
    /*
     * 목록의 금액은 차감한 뒤의 값이고, 되돌린 결제는 음수다. 폼은 정가를 양수로 든다.
     *
     * 외화 거래에는 차감이 붙을 수 없어(조립이 막는다) 두 보정이 겹치지 않는다.
     */
    amount: item.originalAmount ?? grossOf(item),
    /*
     * 줄에 달린 값들. 분류 하나짜리 거래는 그 줄의 것을 그대로 든다.
     *
     * 분할이면 아래 `splits` 가 줄마다 들고, 여기는 새 줄을 더할 때 쓰는 기본값으로
     * 남는다. 이체·카드 대금 결제에는 분류 줄이 없어 빈 값이다.
     */
    lineKey: only?.lineKey ?? newLineKey(),
    discountAmount: only?.discountAmount ?? '',
    // 실적 두 칸은 거래에 하나씩이다. 분할이어도 여기서 든다.
    countsPerformance: item.countsPerformance,
    discountCountsPerformance: item.discountCountsPerformance,
    // 소분류가 있으면 그것이 고른 값이다. 목록은 가장 구체적인 분류를 준다.
    categoryId: item.categoryId ?? '',
    /*
     * 결제수단. 이체에서는 **보내는 쪽**이다.
     *
     * 이체(카드대금 포함)는 계좌 사이의 이동이라 카드가 아니라 계좌를 든다. 카드로
     * 낸 지출만 카드를 든다.
     */
    method:
      kind === 'transfer'
        ? item.accountId
          ? accountValue(item.accountId)
          : ''
        : item.cardId
          ? cardValue(item.cardId)
          : item.accountId
            ? accountValue(item.accountId)
            : '',
    toAccountId: item.toAccountId ?? '',
    installmentMonths: item.installmentMonths ? String(item.installmentMonths) : '',
    transferFee: item.feeAmount && item.feeAmount !== '0' ? item.feeAmount : '',
    transferFeeCategoryId: item.feeCategoryId ?? '',
    splits: isSplit
      ? item.lines.map((line) =>
          newSplitLine({
            categoryId: line.categoryId,
            // 폼은 정가를 든다. 목록의 금액은 차감을 뺀 뒤의 값이다.
            amount: grossOfLine(line),
            lineKey: line.lineKey,
            discountAmount: line.discountAmount ?? '',
            tagIds: line.tags.map((tag) => tag.id),
          }),
        )
      : [],
    /*
     * 외화. 원래 통화가 실려 있으면 그것으로 적은 거래다.
     *
     * 환율은 목록이 준 값을 그대로 쓴다. 그 값은 **실제로 기록된 환산액에서 되돌린 것**
     * 이라(entry-view 의 deriveRate), 청구액으로 확정된 거래도 이 셋만으로 같은 금액이
     * 다시 나온다. 청구액 칸을 두지 않는 이유가 그것이다 -- 그 값을 정하는 것은 카드
     * 청구서이고, 그 자리는 웹의 카드 대조 화면이다.
     */
    currency: item.originalCurrency ?? '',
    exchangeRate: item.originalCurrency ? item.exchangeRate ?? '' : '',
    /*
     * 태그. 분류 하나짜리 거래는 그 줄의 것, 이체와 카드 대금 결제는 거래 자체의 것이다.
     *
     * 분할이면 줄마다 다를 수 있어 여기 담지 않는다 (`splits[].tagIds`).
     */
    tagIds: isSplit ? [] : (only?.tags ?? item.tags).map((tag) => tag.id),
  };
}

/** 줄 하나의 정가. 목록이 주는 금액은 차감을 뺀 뒤의 값이다. */
function grossOfLine(line: { amount: string; discountAmount: string | null }): string {
  if (!line.discountAmount) return line.amount;
  const net = toDec(line.amount);
  const discount = toDec(line.discountAmount);
  if (!net || !discount) return line.amount;
  return net.plus(discount).toString();
}

/**
 * 그 갈래에서 카드 실적에 세는 것이 기본인가.
 *
 * 지출은 쓴 돈이라 센다. 카드로 들어온 돈은 캐시백이나 이벤트 지급이 흔해 세지 않는
 * 것을 기본으로 둔다 -- 결제를 되돌려 받은 환급이라면 사용자가 켜서 함께 뺀다.
 *
 * 화면과 조립이 같은 답을 내야 해서 여기 한 곳에 둔다.
 */
export function defaultCountsPerformance(kind: EntryFormKind): boolean {
  return kind !== 'income';
}

/**
 * "차감을 실적에서도 뺀다" 칸을 띄울 자리인가.
 *
 * 넷이 모두 맞아야 뜻이 있다 -- 카드로 낸 지출이고, 차감을 적었고, 그 거래를 실적에
 * 세기로 했고, 장부 통화로 적었다. 마지막 조건은 집계가 되살릴 수 있는 범위다:
 * 차감액은 사용자가 적은 통화이고 카드 다리는 계좌 통화라, 원화 카드로 한 외화 결제
 * 에서는 더할 수 없어 서버와 사본 양쪽이 그 거래의 차감을 되살리지 않는다. 외화
 * 계좌로 그 통화를 결제한 거래는 되살릴 수 있지만 여기서는 함께 감춘다 -- 화면이
 * 카드의 계좌 통화를 들고 있지 않아서다.
 *
 * 화면과 조립이 같은 답을 내야 해서 여기 한 곳에 둔다.
 */
export function showDiscountPerformance(input: {
  kind: EntryFormKind;
  /** 차감·취소 금액. 비었거나 0이면 물을 것이 없다. */
  discountAmount: string;
  /** 그 거래를 실적에 세는가. 세지 않으면 차감이 실적을 움직일 일도 없다. */
  countsPerformance: boolean;
  /** 카드로 냈는가. 통장에서 나간 돈에는 실적이 없다. */
  isCard: boolean;
  /** 장부 통화로 적었는가. 웹과 앱이 이 값을 각자의 칸에서 만든다. */
  isLedgerCurrency: boolean;
}): boolean {
  if (!input.isCard || input.kind !== 'expense') return false;
  if (!input.countsPerformance || !input.isLedgerCurrency) return false;

  const discount = toDec(input.discountAmount);
  return Boolean(discount?.isPositive());
}

/**
 * 보관함의 후보를 폼 값으로.
 *
 * 후보는 전표가 아니라 읽어 낸 값의 묶음이라 빈 칸이 있는 것이 정상이다. 그래서
 * **빈 폼에서 시작해 읽은 것만 덮어쓴다** -- 없는 칸을 null 로 채우면 폼의 기본값
 * (오늘 날짜, 내 이름)까지 지워진다.
 *
 * 갈래가 이 폼이 다루지 못하는 것이면 지출로 둔다. 후보의 갈래는 문구에서 짐작한
 * 값이고, 사람이 폼에서 보고 바꿀 수 있다 -- 열지 않고 물러나면 담아 둔 후보를
 * 쓸 방법이 아예 없어진다.
 */
export function entryFormFromDraft(
  draft: {
    kind: string | null;
    amount: string | null;
    currency: string | null;
    occurredAt: string | null;
    merchant: string | null;
    description: string | null;
    installmentMonths: number | null;
    personId: string | null;
    categoryId: string | null;
    accountId: string | null;
    cardId: string | null;
    /** 붙일 태그. 반복에서 온 후보만 채워 온다. */
    tagIds?: string[];
  },
  options: EntryFormDefaults,
): EntryFormValues {
  const base = emptyEntryForm(options);

  const kind: EntryFormKind =
    draft.kind === 'income' || draft.kind === 'transfer' ? draft.kind : 'expense';

  /*
   * 결제수단. 카드가 있으면 카드, 없으면 통장이다.
   *
   * 이체는 이 값이 **보내는 쪽**이 된다. 받는 쪽은 문구에서 알 수 없어 비워 두고,
   * 사람이 고른다 (검증이 그 칸을 요구한다).
   */
  const method = draft.cardId
    ? cardValue(draft.cardId)
    : draft.accountId
      ? accountValue(draft.accountId)
      : '';

  const when = draft.occurredAt ? new Date(draft.occurredAt) : null;
  const hasWhen = when !== null && !Number.isNaN(when.getTime());

  return {
    ...base,
    kind,
    method,
    amount: draft.amount ?? '',
    /*
     * 통화. 장부 통화면 비워 둔다.
     *
     * 폼에서 빈 값이 곧 장부 통화이고(그때는 환산할 것이 없다), 원화 후보에 'KRW'를
     * 적어 넣으면 장부 통화가 원화인 가계부에서도 환율 칸이 열린다.
     */
    currency: draft.currency && draft.currency !== options.ledgerCurrency ? draft.currency : '',
    description: draft.description ?? draft.merchant ?? '',
    categoryId: kind === 'expense' || kind === 'income' ? draft.categoryId ?? '' : '',
    personId: draft.personId ?? base.personId,
    /*
     * 태그. 반복에 붙여 둔 것이 여기까지 온다.
     *
     * 지운 태그의 id 가 섞일 자리는 없다 -- 서버에서 다리 표로 들고 있어 태그를 지우면
     * 그 연결이 함께 사라진다. 그러지 않으면 저장할 때 TAG_NOT_IN_PROJECT 로 거절당하고,
     * 사람은 폼에서 그 태그를 볼 수 없어 무엇을 빼야 할지 알 수 없다.
     */
    tagIds: draft.tagIds ?? base.tagIds,
    installmentMonths:
      kind === 'expense' && draft.installmentMonths ? String(draft.installmentMonths) : '',
    ...(hasWhen
      ? {
          dateKey: dateKeyOf(when as Date, options.timeZone),
          timeKey: timeInputOf(when as Date, options.timeZone),
        }
      : {}),
  };
}

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
  if (!values.personId) return { field: 'personId', code: 'PERSON_REQUIRED' };

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
    if (!parseMethod(values.method).accountId && !parseMethod(values.method).cardId) {
      return { field: 'method', code: 'METHOD_REQUIRED' };
    }
    return null;
  }

  if (!values.categoryId) return { field: 'categoryId', code: 'CATEGORY_REQUIRED' };

  /*
   * 지출도 수입도 통장과 카드 중 하나를 고른다.
   *
   * 수입에 카드를 여는 것은 카드사가 되돌려 주는 돈이 통장을 거치지 않고 다음 청구에서
   * 빠지는 일이 있어서다. 그때 돈이 들어오는 자리는 통장이 아니라 그 카드의 빚이다.
   */
  const method = parseMethod(values.method);
  if (!method.accountId && !method.cardId) {
    return { field: 'method', code: 'METHOD_REQUIRED' };
  }

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

/**
 * 폼을 서버(또는 아웃박스)가 받는 모양으로.
 *
 * 날짜는 프로젝트 타임존의 벽시계를 인스턴트로 되돌린다. 기기 시간대로 만들면 여행 중에
 * 적은 거래가 하루 밀린다.
 */
export function entryFormToRequest(
  values: EntryFormValues,
  timeZone: string,
): EntryDto.CreateRequest {
  const method = parseMethod(values.method);
  const base = {
    kind: values.kind,
    personId: values.personId,
    date: zonedFormValueToUtc(values.dateKey, values.timeKey, timeZone).toISOString(),
    description: values.description.trim(),
    amount: values.amount,
    /*
     * 태그는 언제나 싣는다. 비었어도 뺄 수 없다.
     *
     * 수정은 전표를 통째로 갈아 끼우고 생략은 "비운다"로 읽히므로(`EntryDto`), 여기서
     * 빈 배열을 빼면 "태그를 전부 뗀 수정"과 "태그를 건드리지 않은 수정"이 같아진다.
     */
    tagIds: values.tagIds,
    /*
     * 외화. 통화와 환율을 함께 싣는다.
     *
     * 환율을 빼면 재생하는 날의 환율로 값이 다시 매겨져, 기기가 보여 준 금액과 서버에
     * 남는 금액이 갈린다 (D7). 기준통화로 적었으면 실을 것이 없다.
     */
    ...(values.currency
      ? { currency: values.currency, exchangeRate: values.exchangeRate }
      : {}),
  };

  if (values.kind === 'transfer') {
    const fee = values.transferFee ? toDec(values.transferFee) : null;
    return {
      ...base,
      accountId: method.accountId,
      toAccountId: values.toAccountId,
      ...(fee && fee.isPositive()
        ? {
            transferFee: values.transferFee,
            transferFeeCategoryId: values.transferFeeCategoryId,
            // 수수료도 분류 줄이라 키를 갖는다. 폼의 줄 키를 그대로 쓴다.
            transferFeeLineKey: values.lineKey,
          }
        : {}),
    };
  }

  const months = Number(values.installmentMonths);

  /*
   * 줄에 달린 값들을 짐에 싣는 규칙. 분류 하나짜리와 분할이 같은 함수를 쓴다.
   *
   * 차감은 지출에만 싣는다. 갈래를 옮겨도 폼은 값을 들고 있으므로(이체로 갔다가
   * 돌아오면 그대로다) 여기서 갈래를 한 번 더 본다.
   *
   * 실적 값은 **기본값과 다를 때만** 싣는다. 기본값은 조립이 갈래를 보고 정하므로 같은
   * 값을 굳이 보내지 않는다 -- 짐만 보고도 사용자가 손댄 자리가 드러난다.
   */
  /** 그 줄에서 깎인 금액. 지출에만 싣는다. */
  const lineDiscount = (discountAmount: string) =>
    values.kind === 'expense' && discountAmount.trim() ? { discountAmount } : {};

  /*
   * 카드 실적 두 칸. **분할이든 아니든 거래에 하나씩이다.**
   *
   * 기본값과 다를 때만 싣는다. 기본값은 조립이 갈래를 보고 정하므로 같은 값을 굳이
   * 보내지 않는다 -- 짐만 보고도 사용자가 손댄 자리가 드러난다.
   */
  const performanceExtra = {
    ...(method.cardId && values.countsPerformance !== defaultCountsPerformance(values.kind)
      ? { countsPerformance: values.countsPerformance }
      : {}),
    /*
     * 차감을 실적에서 빼지 않기로 한 것. 그 칸이 화면에 떠 있었을 때만 싣는다.
     *
     * 화면이 보여 주지 않은 값을 실어 보내면, 지출에서 끈 뒤 차감을 지운 거래가
     * 사용자가 볼 수 없는 값을 들고 다니게 된다 (`showDiscountPerformance`).
     */
    ...(showDiscountPerformance({
      kind: values.kind,
      discountAmount: totalDiscountOf(values),
      countsPerformance: values.countsPerformance,
      isCard: Boolean(method.cardId),
      isLedgerCurrency: !values.currency,
    }) && !values.discountCountsPerformance
      ? { discountCountsPerformance: false }
      : {}),
  };

  /*
   * 분할이면 줄들을 싣고 대표 분류는 싣지 않는다.
   *
   * 조립이 둘을 함께 받으면 분할을 쓰고 분류는 버린다(`resolveRequestLines`). 그래도
   * 보내지 않는 편이 낫다 -- 짐만 보고도 이 거래가 분할이라는 것이 드러난다.
   *
   * 태그도 줄마다 싣는다. 비었어도 뺄 수 없다 -- 생략은 "비운다"가 아니라 "그대로
   * 둔다"로 읽히면 태그를 전부 뗀 수정을 표현할 길이 없다.
   */
  if (values.splits.length > 0) {
    return {
      ...base,
      // 분할은 줄마다 태그가 다르다. 전표 단위 목록은 싣지 않는다.
      tagIds: undefined,
      splits: values.splits.map((split) => ({
        categoryId: split.categoryId,
        amount: split.amount,
        lineKey: split.lineKey,
        tagIds: split.tagIds,
        ...lineDiscount(split.discountAmount),
      })),
      ...(method.accountId ? { accountId: method.accountId } : {}),
      ...(method.cardId ? { cardId: method.cardId } : {}),
      ...(values.kind === 'expense' && method.cardId && Number(values.installmentMonths) >= 2
        ? { installmentMonths: Number(values.installmentMonths) }
        : {}),
      ...performanceExtra,
    };
  }

  return {
    ...base,
    categoryId: values.categoryId,
    // 분류 하나짜리 거래의 줄 키. 이 값이 이어져야 그 줄의 태그와 차감이 살아남는다.
    lineKey: values.lineKey,
    ...(method.accountId ? { accountId: method.accountId } : {}),
    ...(method.cardId ? { cardId: method.cardId } : {}),
    // 할부는 신용카드 지출에만 붙는다. 그 판단은 조립이 다시 한다.
    ...(values.kind === 'expense' && method.cardId && months >= 2
      ? { installmentMonths: months }
      : {}),
    ...lineDiscount(values.discountAmount),
    ...performanceExtra,
  };
}

/**
 * 이 거래에서 깎인 금액의 합.
 *
 * 실적 칸을 띄울지 가리는 데 쓴다. 분할이면 줄마다 적은 값을 더한 것이 그 거래의
 * 차감이고, 아니면 칸 하나가 곧 그 값이다. 웹과 앱의 폼도 같은 것을 쓴다 -- "차감을
 * 실적에서 뺄지" 칸이 화면마다 다른 조건으로 뜨면 안 된다.
 */
export function totalDiscountOf(values: EntryFormValues): string {
  if (values.splits.length === 0) return values.discountAmount;

  const total = values.splits.reduce((acc, split) => {
    const amount = toDec(split.discountAmount);
    return amount ? acc.plus(amount) : acc;
  }, Dec.of(0));
  return total.isZero() ? '' : total.toString();
}

/** 'YYYY-MM-DD' 이고 실제로 있는 날인가. 2026-02-31 은 모양은 맞지만 없는 날이다. */
/** 'HH:mm' 인가. */
function isTimeKey(value: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;

  const [hour, minute] = value.split(':').map(Number);
  return hour < 24 && minute < 60;
}

/** 금액 문자열을 Dec 로. 숫자가 아니면 null. */
function toDec(value: string): Dec | null {
  const text = value.trim();
  if (!text) return null;
  try {
    return Dec.of(text);
  } catch {
    return null;
  }
}
