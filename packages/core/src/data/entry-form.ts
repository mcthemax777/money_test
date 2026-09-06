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
  type CardTransferDirection,
  type EntryDto,
  type EntryListItem,
  zonedFormValueToUtc,
} from '@money/types';

import { dateKeyOf, isDateKey, nowTimeKey, timeInputOf, todayKey } from '../lib/datetime';

/** 이 폼이 다루는 갈래. 조정(adjustment)은 잔액 맞추기가 만드는 것이라 여기 없다. */
export type EntryFormKind = 'expense' | 'income' | 'transfer' | 'card_payment';

/**
 * 분할의 한 줄.
 *
 * 금액은 줄마다 따로 적고, 합이 전체 금액과 같아야 한다. 남는 것을 마지막 줄에 자동으로
 * 몰아주지 않는다 -- 사용자가 적은 숫자와 저장되는 숫자가 달라지면 안 된다.
 */
export interface EntryFormSplit {
  categoryId: string;
  amount: string;
  /** 빈 문자열은 "정하지 않았다"이고, 그때는 그 분류의 기본값을 따른다. */
  extraAmount: string;
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
  /**
   * 과소비(지출)·추가 수입(수입)으로 셀 금액.
   *
   * 빈 문자열은 "정하지 않았다"이고, 그때는 카테고리의 기본값을 따른다. "0"과 다르다 --
   * 0 은 "일반 거래로 세겠다"는 사용자의 선택이다.
   */
  extraAmount: string;
  /** 지출의 결제수단. 수입은 계좌만 고를 수 있다. */
  method: PaymentMethodValue;
  /** 이체에서 받는 계좌 */
  toAccountId: string;
  /** 할부 개월수. 빈 문자열이 일시불이다. */
  installmentMonths: string;
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
   * 카드사 대금 이동의 카드.
   *
   * 이 갈래만 결제수단을 둘 잡는다 -- 통장에서 돈이 나가고 그만큼 카드 부채가 준다.
   * 그래서 `method`(통장) 와 별개로 카드를 따로 든다. 다른 갈래에서는 쓰이지 않는다.
   */
  cardId: string;
  /** 카드사 대금 이동의 방향. 대금 결제인지 환불 입금인지. */
  cardDirection: CardTransferDirection;
  /**
   * 이 거래에 붙일 태그. 카테고리와 달리 여럿을 고를 수 있다.
   *
   * 갈래(지출·수입·이체)를 가리지 않는다. 태그는 "무엇에 쓴 돈인가"가 아니라 "어느 일에
   * 딸린 거래인가"라, 여행에는 항공권 지출과 환불 수입이 함께 든다.
   */
  tagIds: string[];
}

export interface EntryFormDefaults {
  personId?: string;
  timeZone: string;
  now?: Date;
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
    extraAmount: '',
    method: '',
    toAccountId: '',
    installmentMonths: '',
    transferFee: '',
    transferFeeCategoryId: '',
    splits: [],
    currency: '',
    exchangeRate: '',
    cardId: '',
    cardDirection: 'payment',
    tagIds: [],
    ...(now ? { dateKey: dateKeyOf(now, timeZone), timeKey: timeInputOf(now, timeZone) } : {}),
  };
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

  const isSplit = (item.kind === 'expense' || item.kind === 'income') && item.splitCount > 1;
  if (isSplit && !item.splits?.length) return null;

  return {
    kind: item.kind,
    personId: item.personId,
    dateKey: dateKeyOf(item.date, timeZone),
    timeKey: timeInputOf(item.date, timeZone),
    description: item.description,
    /*
     * 사용자가 적었던 금액으로 되돌린다.
     *
     * 목록의 `amount` 는 표시 통화로 환산한 값이다. 외화 거래를 그 값으로 열면 "$50"
     * 자리에 "70,000"이 들어앉고, 그대로 저장하면 50달러가 70,000달러가 된다.
     */
    amount: item.originalAmount ?? item.amount,
    // 소분류가 있으면 그것이 고른 값이다. 목록은 가장 구체적인 분류를 준다.
    categoryId: item.categoryId ?? '',
    extraAmount: item.extraAmount ?? '',
    /*
     * 결제수단. 카드사 대금 이동만 다르다.
     *
     * 그 갈래는 통장과 카드를 함께 들므로 여기에는 **통장**이 온다. 카드를 여기 넣으면
     * 돈이 어디서 나갔는지 잃는다.
     */
    method:
      item.kind === 'card_payment'
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
      ? (item.splits ?? []).map((split) => ({
          categoryId: split.categoryId,
          amount: split.amount,
          // "0"도 사용자가 고른 값이라 그대로 되돌린다. 빈 문자열만 "정하지 않았다"다.
          extraAmount: split.extraAmount ?? '',
        }))
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
    // 카드사 대금 이동은 통장과 카드를 함께 든다. 그 밖의 갈래에서는 method 가 카드를 든다.
    cardId: item.kind === 'card_payment' ? item.cardId ?? '' : '',
    cardDirection: item.cardTransferDirection ?? 'payment',
    tagIds: item.tags.map((tag) => tag.id),
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
export function checkEntryForm(values: EntryFormValues): EntryFormViolation | null {
  if (!values.personId) return { field: 'personId', code: 'PERSON_REQUIRED' };
  if (!values.description.trim()) return { field: 'description', code: 'DESCRIPTION_REQUIRED' };

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

  if (values.kind === 'card_payment') {
    const account = parseMethod(values.method).accountId;
    if (!account) return { field: 'method', code: 'ACCOUNT_REQUIRED' };
    if (!values.cardId) return { field: 'cardId', code: 'CARD_REQUIRED' };
    return null;
  }

  if (values.kind === 'transfer') {
    const from = parseMethod(values.method).accountId;
    if (!from) return { field: 'method', code: 'FROM_ACCOUNT_REQUIRED' };
    if (!values.toAccountId) return { field: 'toAccountId', code: 'TO_ACCOUNT_REQUIRED' };
    if (from === values.toAccountId) return { field: 'toAccountId', code: 'TRANSFER_SAME_ACCOUNT' };

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

      if (split.extraAmount !== '') {
        const extra = toDec(split.extraAmount);
        if (!extra || extra.isNegative()) return { field: 'splits', code: 'SPLIT_EXTRA_INVALID' };
        if (extra.gt(line)) return { field: 'splits', code: 'SPLIT_EXTRA_EXCEEDS' };
      }
      total = total.plus(line);
    }
    if (!total.eq(amount)) return { field: 'splits', code: 'SPLIT_SUM_MISMATCH' };

    // 분할이 있으면 대표 분류와 전체 과소비는 쓰이지 않는다. 줄마다 따로 있기 때문이다.
    const method = parseMethod(values.method);
    if (values.kind === 'income' && !method.accountId) {
      return { field: 'method', code: 'ACCOUNT_REQUIRED' };
    }
    if (values.kind === 'expense' && !method.accountId && !method.cardId) {
      return { field: 'method', code: 'METHOD_REQUIRED' };
    }
    return null;
  }

  if (!values.categoryId) return { field: 'categoryId', code: 'CATEGORY_REQUIRED' };

  const method = parseMethod(values.method);
  if (values.kind === 'income' && !method.accountId) {
    return { field: 'method', code: 'ACCOUNT_REQUIRED' };
  }
  if (values.kind === 'expense' && !method.accountId && !method.cardId) {
    return { field: 'method', code: 'METHOD_REQUIRED' };
  }

  if (values.extraAmount !== '') {
    const extra = toDec(values.extraAmount);
    if (!extra || extra.isNegative()) return { field: 'extraAmount', code: 'EXTRA_INVALID' };
    if (extra.gt(amount)) return { field: 'extraAmount', code: 'EXTRA_EXCEEDS_AMOUNT' };
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

  if (values.kind === 'card_payment') {
    return {
      ...base,
      accountId: method.accountId,
      cardId: values.cardId,
      cardTransferDirection: values.cardDirection,
    };
  }

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
          }
        : {}),
    };
  }

  const months = Number(values.installmentMonths);

  /*
   * 분할이면 줄들을 싣고 대표 분류는 싣지 않는다.
   *
   * 조립이 둘을 함께 받으면 분할을 쓰고 분류는 버린다(`resolveRequestLines`). 그래도
   * 보내지 않는 편이 낫다 -- 짐만 보고도 이 거래가 분할이라는 것이 드러난다.
   */
  if (values.splits.length > 0) {
    return {
      ...base,
      splits: values.splits.map((split) => ({
        categoryId: split.categoryId,
        amount: split.amount,
        ...(split.extraAmount === '' ? {} : { extraAmount: split.extraAmount }),
      })),
      ...(method.accountId ? { accountId: method.accountId } : {}),
      ...(method.cardId ? { cardId: method.cardId } : {}),
      ...(values.kind === 'expense' && method.cardId && Number(values.installmentMonths) >= 2
        ? { installmentMonths: Number(values.installmentMonths) }
        : {}),
    };
  }

  return {
    ...base,
    categoryId: values.categoryId,
    /*
     * 빈 문자열은 보내지 않는다. 값을 보내지 않아야 카테고리의 기본값이 적용된다.
     * "0" 은 보낸다 -- 기본이 과소비인 분류를 이 거래에서만 일반으로 세겠다는 뜻이다.
     */
    ...(values.extraAmount === '' ? {} : { extraAmount: values.extraAmount }),
    ...(method.accountId ? { accountId: method.accountId } : {}),
    ...(method.cardId ? { cardId: method.cardId } : {}),
    // 할부는 신용카드 지출에만 붙는다. 그 판단은 조립이 다시 한다.
    ...(values.kind === 'expense' && method.cardId && months >= 2
      ? { installmentMonths: months }
      : {}),
  };
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
