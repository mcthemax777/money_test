/**
 * 거래 입력 폼의 값 모양과 기본값.
 *
 * 폼이 드는 칸(`EntryFormValues`)과 빈 폼, 결제수단 글자, 그리고 화면·검사·조립이 함께 쓰는
 * 작은 규칙(실적 기본값, 할부 기준 금액, 차감 합)이 여기 있다. 바깥에서는 `entry-form` 으로
 * 가져다 쓴다.
 */

import {
  Dec,
  type PaybackType,
  newLineKey,
  paybackCountsPerformance,
} from '@money/types';

import { dateKeyOf, nowTimeKey, timeInputOf, todayKey } from '../lib/datetime';
import { type InstallmentInterestMode } from '../lib/period-ledger';

/**
 * 이 폼이 다루는 갈래. 셋뿐이다.
 *
 * **카드대금 결제는 이체다.** 통장과 카드 부채 계정 사이를 돈이 오가는 일이라 규칙이
 * 이체와 같고, 갈래를 따로 두면 계좌를 고르는 칸이 한 벌 더 생긴다. 저장된 전표는
 * `classifyEntry` 가 `card_payment` 로 되읽으므로 목록과 집계는 그대로다.
 *
 * 조정(adjustment)은 잔액 맞추기가 만드는 것이라 여기 없다.
 *
 * 페이백(payback)은 갈래 고르기에 서지 않는다. 원거래의 상세에서 "페이백 추가"로만 열리고
 * (`paybackFormFrom`), 화면은 이 갈래일 때 페이백 칸만 그린다 (PAYBACK_DESIGN.md).
 */
export type EntryFormKind = 'expense' | 'income' | 'transfer' | 'payback';

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

/** 카드가 있으면 카드, 없으면 계좌, 둘 다 없으면 빈 칸. 저장된 거래·후보를 폼으로 옮길 때 쓴다. */
export function methodValueOf(cardId: string | null | undefined, accountId: string | null | undefined): PaymentMethodValue {
  return cardId ? cardValue(cardId) : accountId ? accountValue(accountId) : '';
}

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
  /** 거래한 사람. 빈 글자면 미지정이다. */
  personId: string;
  /** 프로젝트 타임존의 달력 날짜 'YYYY-MM-DD' */
  dateKey: string;
  /** 'HH:mm' */
  timeKey: string;
  description: string;
  /**
   * 거래처와 메모 (2026-10-16 -- 앱 폼에도 두었다). 폼이 이 둘을 들지 않으면 고치기가 전표를 통째로
   * 갈아 끼우면서 웹에서 적어 둔 값을 지운다. 빈 글자면 없는 것이다.
   */
  merchant: string;
  detailedNote: string;
  amount: string;
  categoryId: string;
  /** 지출의 결제수단. 수입은 계좌만 고를 수 있다. */
  method: PaymentMethodValue;
  /** 이체에서 받는 계좌 */
  toAccountId: string;
  /** 할부 개월수. 빈 문자열이 일시불이다. */
  installmentMonths: string;
  /**
   * 할부에 수수료가 붙는가. `''` 는 아직 고르지 않았다는 뜻이다.
   *
   * 기본값을 두지 않는다. 무이자로 두면 유이자 할부가 조용히 수수료 없이 지나가고,
   * 유이자로 두면 무이자 결제마다 "수수료 미입력"이 쌓인다. 할부는 자주 적는 것이
   * 아니라, 개월수를 고른 사람에게 한 번 묻는 편이 양쪽보다 낫다.
   */
  installmentInterest: '' | 'free' | 'interest';
  /**
   * 회차별 원금. 비어 있으면 개월수로 나눈 기본값을 쓴다.
   *
   * 끝수를 어느 회차에 몰아주는지가 카드사마다 다르다. 1,000원 3개월이 334/333/333 일
   * 수도 334/334/332 일 수도 있어, 명세서와 다르면 사람이 고쳐 적는다.
   */
  installmentShares: string[];
  /**
   * 유이자 할부의 이자를 어떻게 정하는가. `''` 는 아직 고르지 않았다는 뜻이다.
   *
   * 고정형은 매달 같은 금액을 내고, 변동형은 연이율만 정해져 있다. 고르지 않으면
   * 이자 칸이 비어 있고 사용자가 명세서를 보고 회차마다 적는다.
   */
  installmentInterestMode: InstallmentInterestMode;
  /** 고정형의 월 납입액. */
  installmentMonthlyPayment: string;
  /** 변동형의 연이율 (퍼센트). */
  installmentAnnualRate: string;
  /**
   * 회차별 이자. 비어 있으면 고른 방식으로 계산한 기본값을 쓴다.
   *
   * 원금과 같은 규칙이다 -- 계산이 채워 주고, 명세서와 다르면 사람이 고친다.
   */
  installmentInterestShares: string[];
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
   * 고치는 이체가 받는 계좌에 실제로 넣은 금액(받는 계좌 통화)과, 그 값을 읽었을 때의 폼 모양.
   *
   * 칸으로 보이지 않는다. 통화가 다른 이체를 메모만 고쳐 저장해도 받은 금액이 그날 환율로 다시
   * 매겨지지 않게 들고 있다가, 금액·계좌·통화·환율·수수료가 그대로일 때만 되돌려 보낸다
   * (`transferBasisOf`). 하나라도 바꿨으면 조립이 새로 계산한다.
   */
  toAmount: string;
  toAmountBasis: string;
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
  /**
   * 페이백의 원거래와 그 줄. 페이백이 아니면 빈 글자다.
   *
   * 분할된 원거래면 줄을 골라야 하고, 고른 줄의 분류가 `categoryId` 가 된다
   * (`useEntryForm` 의 `choosePaybackLine`). 고칠 때는 줄을 바꾸지 않는다 -- 화면이 원거래의
   * 줄을 들고 있지 않다.
   */
  paybackOfEntryId: string;
  paybackOfLineKey: string;
  /** 돌아온 돈의 종류. 페이백 갈래에만 뜻이 있다. 바꾸면 실적 칸이 그 종류의 기본값으로 돌아간다. */
  paybackType: PaybackType;
  /**
   * 할부 원거래의 환불이면 회차마다 줄일 원금 (PAYBACK_DESIGN.md 7-9). 그 밖에는 빈 배열이다.
   *
   * 화면이 `useInstallmentRefund` 로 채운다 -- 고르지 않았으면 환불 금액을 남은 회차에 고르게
   * 나눈 기본값이 따라가고, 회차를 손대면(`installmentCutTouched`) 그 값이 남는다.
   */
  installmentCut: string[];
  installmentCutTouched: boolean;
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
    merchant: '',
    detailedNote: '',
    amount: '',
    categoryId: '',
    method: '',
    toAccountId: '',
    installmentMonths: '',
    installmentInterest: '',
    installmentShares: [],
    installmentInterestMode: '',
    installmentMonthlyPayment: '',
    installmentAnnualRate: '',
    installmentInterestShares: [],
    // 분류 하나짜리 거래의 줄 키. 폼을 여는 자리에서 한 번 정해진다.
    lineKey: newLineKey(),
    discountAmount: '',
    countsPerformance: true,
    discountCountsPerformance: true,
    transferFee: '',
    transferFeeCategoryId: '',
    toAmount: '',
    toAmountBasis: '',
    splits: [],
    currency: '',
    exchangeRate: '',
    tagIds: [],
    // 새로 적는 중이라 딛고 설 판이 없다. 만들기는 겹칠 대상 자체가 없다.
    baseHlc: null,
    paybackOfEntryId: '',
    paybackOfLineKey: '',
    paybackType: 'payback',
    installmentCut: [],
    installmentCutTouched: false,
    ...(now ? { dateKey: dateKeyOf(now, timeZone), timeKey: timeInputOf(now, timeZone) } : {}),
  };
}

/**
 * 이체의 받은 금액이 기대는 폼 값. 이 글자가 그대로면 받은 금액도 그대로 쓸 수 있다.
 */
export function transferBasisOf(values: EntryFormValues): string {
  return [
    values.amount,
    values.method,
    values.toAccountId,
    values.currency,
    values.exchangeRate,
    values.transferFee,
  ].join('|');
}

/**
 * 그 갈래에서 카드 실적에 세는 것이 기본인가.
 *
 * 지출은 쓴 돈이라 센다. 카드로 들어온 돈은 캐시백이나 이벤트 지급이 흔해 세지 않는
 * 것을 기본으로 둔다 -- 결제를 되돌려 받은 환급이라면 사용자가 켜서 함께 뺀다.
 *
 * 화면과 조립이 같은 답을 내야 해서 여기 한 곳에 둔다.
 */
export function defaultCountsPerformance(kind: EntryFormKind, paybackType?: PaybackType | ''): boolean {
  /*
   * 돌아온 돈은 종류가 정한다 -- 환불은 산 것을 되돌린 것이라 실적도 깎고, 캐시백은 쓴 돈이
   * 아니라 깎지 않는다 (`paybackCountsPerformance`, 조립과 같은 함수다).
   */
  if (kind === 'payback') return paybackCountsPerformance(paybackType || 'payback');
  // 수입은 쓴 돈이 아니다. 조립의 기본값과 같다 (entry-build).
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
 * 할부가 나누는 금액 = 금액 칸 − 차감 (분할이면 줄 차감의 합).
 *
 * 차감은 결제 순간에 깎인 몫이라 카드에 청구되는 것은 그 뒤의 금액이다. 서버도 카드 다리
 * (이미 순액)를 나눠 회차 원금의 합과 견준다(`installmentSharesOf`). 폼이 금액 칸을 그대로
 * 나누면 회차가 차감만큼 크게 보이고, 고친 회차는 폼과 서버 어느 한쪽에서 반드시 거절된다.
 * 이자 기본값(고정형·연이율)도 같은 금액을 딛는다.
 *
 * 차감이 비었거나 읽을 수 없으면 금액 칸 그대로다. 차감이 금액보다 크면 그대로 둔다 --
 * 그 값은 차감 검사(DISCOUNT_TOO_LARGE)가 따로 막는다.
 */
export function installmentBaseAmount(amount: string, discount: string): string {
  const gross = toDec(amount);
  const cut = toDec(discount);
  if (!gross || !cut || !cut.isPositive() || cut.gt(gross)) return amount;
  return gross.minus(cut).toString();
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

/** 'HH:mm' 인가. */
export function isTimeKey(value: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;

  const [hour, minute] = value.split(':').map(Number);
  return hour < 24 && minute < 60;
}

/** 금액 문자열을 Dec 로. 숫자가 아니면 null. 폼 모듈끼리 쓰고 `entry-form` 밖으로는 내보내지 않는다. */
export function toDec(value: string): Dec | null {
  const text = value.trim();
  if (!text) return null;
  try {
    return Dec.of(text);
  } catch {
    return null;
  }
}
