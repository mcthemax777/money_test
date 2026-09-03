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
 * **여기서 다루지 않는 것**: 분할, 외화(통화·환율·청구액), 카드사 대금 이동. 앱의 입력
 * 화면이 아직 그것을 받지 않기 때문이고, 웹의 편집기가 그 자리를 맡고 있다. 필요해지면
 * 값을 더하는 자리는 이 파일 하나다.
 */

import { Dec, type EntryDto, type EntryListItem, zonedFormValueToUtc } from '@money/types';

import { dateKeyOf, isDateKey, nowTimeKey, timeInputOf, todayKey } from '../lib/datetime';

/** 앱 입력 화면이 다루는 갈래. 카드사 대금 이동은 카드 화면의 일이라 여기 없다. */
export type EntryFormKind = 'expense' | 'income' | 'transfer';

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
    ...(now ? { dateKey: dateKeyOf(now, timeZone), timeKey: timeInputOf(now, timeZone) } : {}),
  };
}

/**
 * 이미 있는 거래를 폼으로 되돌린다.
 *
 * 목록 한 줄(`EntryListItem`)은 서버가 전표를 펴 준 값이라 폼에 필요한 것이 다 들어 있다.
 * 카드사 대금 이동처럼 이 화면이 다루지 않는 갈래는 null 을 돌려주고, 부르는 쪽이 "웹에서
 * 고쳐 주세요"로 안내한다.
 */
export function entryFormFromItem(
  item: EntryListItem,
  timeZone: string,
): EntryFormValues | null {
  if (item.kind !== 'expense' && item.kind !== 'income' && item.kind !== 'transfer') {
    return null;
  }

  /*
   * 분할 거래는 이 폼이 다루지 못한다.
   *
   * 폼은 분류 하나만 담으므로 되돌려 저장하면 나머지 줄이 조용히 사라진다. 금액은
   * 그대로인데 분류별 합계만 바뀌는 종류의 손실이라 사용자가 알아채기 어렵다.
   * 감추지 않고 "웹에서 고쳐 주세요"로 말하는 편이 정직하다.
   */
  if ((item.kind === 'expense' || item.kind === 'income') && item.splitCount > 1) {
    return null;
  }

  return {
    kind: item.kind,
    personId: item.personId,
    dateKey: dateKeyOf(item.date, timeZone),
    timeKey: timeInputOf(item.date, timeZone),
    description: item.description,
    amount: item.amount,
    // 소분류가 있으면 그것이 고른 값이다. 목록은 가장 구체적인 분류를 준다.
    categoryId: item.categoryId ?? '',
    extraAmount: item.extraAmount ?? '',
    method: item.cardId ? cardValue(item.cardId) : item.accountId ? accountValue(item.accountId) : '',
    toAccountId: item.toAccountId ?? '',
    installmentMonths: item.installmentMonths ? String(item.installmentMonths) : '',
    transferFee: item.feeAmount && item.feeAmount !== '0' ? item.feeAmount : '',
    transferFeeCategoryId: item.feeCategoryId ?? '',
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
          }
        : {}),
    };
  }

  const months = Number(values.installmentMonths);

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
