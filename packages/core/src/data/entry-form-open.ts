/**
 * 이미 있는 것에서 폼을 연다.
 *
 * 목록 한 줄(`entryFormFromItem`), 페이백의 원거래(`paybackFormFrom`), 보관함의 후보
 * (`entryFormFromDraft`)를 폼 값으로 옮긴다. 목록의 금액은 차감·이자·환산을 거친 값이라
 * 사용자가 적었던 값으로 되돌리는 규칙(`foreignEditAmounts`, `interestInAmount`)도 함께 둔다.
 */

import {
  Dec,
  type EntryListItem,
  newLineKey,
  adjustTotals,
  allocateByWeight,
  currencyDecimals,
} from '@money/types';

import { dateKeyOf, timeInputOf } from '../lib/datetime';
import {
  type EntryFormDefaults,
  type EntryFormKind,
  type EntryFormValues,
  type PaymentMethodValue,
  accountValue,
  defaultCountsPerformance,
  emptyEntryForm,
  methodValueOf,
  newSplitLine,
  parseMethod,
  toDec,
  transferBasisOf,
} from './entry-form-values';

/**
 * 목록 한 줄의 금액을 폼이 드는 정가로 되돌린다.
 *
 * 목록의 금액은 차감을 뺀 뒤의 값이고(실제로 나간 돈), 되돌린 결제는 음수다. 폼의
 * 금액 칸은 언제나 "깎이기 전의 값을 양수로" 이므로 둘을 여기서 되돌린다.
 */
function grossOf(item: EntryListItem): string {
  const magnitude = item.amount.startsWith('-') ? item.amount.slice(1) : item.amount;
  return grossOfLine({ amount: magnitude, discountAmount: item.discountAmount });
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
  shown: EntryListItem,
  timeZone: string,
): EntryFormValues | null {
  // 표시 통화로 옮긴 줄이면 옮기기 전의 것으로 연다 (`editSource`). 폼은 적었던 통화의 값을 든다.
  const item = shown.editSource ?? shown;
  if (
    item.kind !== 'expense' &&
    item.kind !== 'income' &&
    item.kind !== 'transfer' &&
    item.kind !== 'card_payment' &&
    item.kind !== 'payback'
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
  /*
   * 외화 분할도 열지 않는다.
   *
   * 목록의 줄 금액은 기준통화 환산액이다(42,001원 / 28,000원). 폼은 줄 금액을 입력 통화로
   * 들므로 그대로 펴면 "$42,001"이 되고, 줄 합이 전체($50)와 맞지 않아 저장이 막힌다.
   * 환율로 되돌리면 끝수가 원래 값과 어긋나 이번에는 조용히 틀린다. 줄마다 원래 금액을
   * 목록이 싣기 전까지는 열지 않는 쪽이 안전하다.
   */
  if (isSplit && item.originalCurrency) return null;

  // 분류 하나짜리 거래의 그 줄. 이체·카드 대금 결제에는 없다.
  const only = isSplit ? null : item.lines[0] ?? null;

  /*
   * 유이자 할부의 이자는 전표 금액 안에 들어 있다. 폼은 **산 값**을 든다.
   *
   * 금액 칸에 갚을 돈 전부를 넣으면 회차 원금의 합과 어긋나 저장이 막히고, 사용자가
   * 적은 적 없는 숫자가 칸에 들어앉는다. 그래서 여기서 이자를 되뺀다 -- 저장할 때
   * 조립이 다시 얹는다.
   */
  const interest = interestInAmount(item);
  const foreign = foreignEditAmounts(item);

  const values: EntryFormValues = {
    kind,
    // 미지정 거래는 빈 칸으로 연다.
    personId: item.personId ?? '',
    // 이 줄을 본 시점의 판. 저장할 때 그대로 되돌려 주어 그 사이의 편집을 알아채게 한다.
    baseHlc: item.updatedHlc,
    dateKey: dateKeyOf(item.date, timeZone),
    timeKey: timeInputOf(item.date, timeZone),
    description: item.description,
    merchant: item.merchant ?? '',
    detailedNote: item.detailedNote ?? '',
    /*
     * 사용자가 적었던 금액으로 되돌린다.
     *
     * 목록의 `amount` 는 표시 통화로 환산한 값이다. 외화 거래를 그 값으로 열면 "$50"
     * 자리에 "70,000"이 들어앉고, 그대로 저장하면 50달러가 70,000달러가 된다.
     */
    /*
     * 목록의 금액은 차감한 뒤의 값이고, 되돌린 결제는 음수다. 폼은 정가를 양수로 든다.
     * 외화 거래도 같다 -- 원래 금액은 차감 뒤의 값이고, 외화 통장의 이체는 수수료를 품는다
     * (`foreignEditAmounts`).
     */
    amount:
      foreign?.amount ??
      (item.installmentAdjust
        ? /*
           * 할부 환불의 다리는 `돌려받은 돈 + 사라진 이자` 다. 폼의 금액 칸은 돌려받은 돈이라
           * 이자를 덜어 낸다 (조립이 저장할 때 다시 얹는다).
           */
          Dec.of(grossOf(item))
            .minus(adjustTotals(item.installmentAdjust).interest)
            .toString()
        : withoutInterest(grossOf(item), interest.total, interest.total)),
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
    method: kind === 'transfer' ? methodValueOf(null, item.accountId) : methodValueOf(item.cardId, item.accountId),
    toAccountId: item.toAccountId ?? '',
    installmentMonths: item.installmentMonths ? String(item.installmentMonths) : '',
    /*
     * 옛 할부에는 이 값이 없다(null). 그때는 수수료 전표가 없다는 뜻이라 무이자로 연다 --
     * 고치려고 열었을 뿐인데 저장이 막히면 까닭을 알 수 없다.
     */
    installmentInterest: item.installmentMonths
      ? item.installmentInterest
        ? 'interest'
        : 'free'
      : '',
    // 적어 둔 값이 없으면 비워 둔다. 화면이 개월수로 나눈 기본값을 채워 보여 준다.
    installmentShares: item.installmentShares ?? [],
    /*
     * 이자를 무엇으로 정했는지는 적어 둔 입력이 말해 준다. 둘 다 없으면 사용자가
     * 손으로 적은 이자라, 방식을 고르지 않은 채로 연다.
     */
    installmentInterestMode: item.installmentMonthlyPayment
      ? 'fixed'
      : item.installmentAnnualRate
        ? 'rate'
        : '',
    installmentMonthlyPayment: item.installmentMonthlyPayment ?? '',
    installmentAnnualRate: item.installmentAnnualRate ?? '',
    installmentInterestShares: item.installmentInterestShares ?? [],
    // 외화 통장의 이체면 수수료도 그 통화로 되돌린다. 목록의 수수료는 장부 통화다.
    transferFee: foreign ? foreign.fee : item.feeAmount && item.feeAmount !== '0' ? item.feeAmount : '',
    transferFeeCategoryId: item.feeCategoryId ?? '',
    splits: isSplit
      ? item.lines.map((line, index) =>
          newSplitLine({
            categoryId: line.categoryId,
            // 폼은 정가를 든다. 목록의 금액은 차감을 뺀 뒤의 값이고 이자를 품는다.
            amount: withoutInterest(grossOfLine(line), interest.lineShares[index], interest.total),
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
    // 페이백의 링크. 고쳐 저장할 때 그대로 되돌려 보내야 링크가 비지 않는다 (수정은 전체 교체다).
    paybackOfEntryId: item.paybackOfEntryId ?? '',
    paybackOfLineKey: item.paybackOfLineKey ?? '',
    paybackType: item.paybackType ?? 'payback',
    // 할부 환불이 줄인 회차. 고칠 때는 적어 둔 값을 그대로 연다 (기본값으로 덮지 않는다).
    installmentCut: item.installmentAdjust?.principal ?? [],
    installmentCutTouched: Boolean(item.installmentAdjust),
    toAmount: '',
    toAmountBasis: '',
  };

  // 이체가 받는 계좌에 넣은 금액. 폼이 그대로면 되돌려 보낸다 (`toAmount` 참고).
  if (kind === 'transfer' && item.toAmount) {
    values.toAmount = item.toAmount;
    values.toAmountBasis = transferBasisOf(values);
  }
  return values;
}

/**
 * 외화로 적은 거래를 고칠 때 폼에 넣을 금액과 수수료. 둘 다 적은 통화다. 외화가 아니면 null.
 *
 *   지출·수입  원래 금액은 차감 뒤의 값이라 차감을 더해 정가로 되돌린다. 차감도 적은 통화로
 *              실려 온다 (entry-view 의 `showDiscount`). 예전에는 차감을 한 번 더 빼, 저장할
 *              때마다 금액이 줄었다 ($50 − $5 → 45 − 5 → 40).
 *   이체      외화 통장에서 나간 다리는 보낸 돈 + 수수료다. 수수료는 다리에 적힌 보낸 통화 금액
 *              (`feeEnteredAmount`)을 쓰고, 그것이 없는 옛 이체만 장부 통화 수수료를 환율로 되짚는다. 예전에는 USD 50 + 1 이
 *              금액 51, 수수료 1,380 으로 열려 USD 1,431 이 나간 것으로 저장됐다.
 *
 * 유이자 할부는 외화로 적을 수 없어(조립의 INSTALLMENT_INTEREST_CURRENCY) 이자를 볼 일이 없다.
 * 웹 편집기도 이 함수를 쓴다.
 */
export function foreignEditAmounts(item: EntryListItem): { amount: string; fee: string } | null {
  if (!item.originalAmount || !item.originalCurrency) return null;
  const original = toDec(item.originalAmount);
  if (!original) return null;

  if (item.kind === 'transfer' || item.kind === 'card_payment') {
    // 보낸 통화로 적힌 수수료가 있으면 그대로 쓴다 (2026-10-21 부터 조립이 적는다). 옛 이체만 환율로 되짚는다.
    const entered = item.feeEnteredAmount ? toDec(item.feeEnteredAmount) : null;
    if (entered) return { amount: original.minus(entered).toString(), fee: entered.isZero() ? '' : entered.toString() };
    const feeBase = item.feeAmount ? toDec(item.feeAmount) : null;
    const rate = item.exchangeRate ? toDec(item.exchangeRate) : null;
    if (!feeBase || feeBase.isZero() || !rate || !rate.isPositive()) {
      return { amount: original.toString(), fee: '' };
    }
    const fee = feeBase.dividedBy(rate, currencyDecimals(item.originalCurrency));
    return { amount: original.minus(fee).toString(), fee: fee.toString() };
  }

  const discount = item.discountAmount ? toDec(item.discountAmount) : null;
  return { amount: (discount ? original.plus(discount) : original).toString(), fee: '' };
}

/** 페이백의 들어온 곳을 정하는 데 필요한 카드의 모양. */
export interface PaybackCard {
  id: string;
  paymentAccountId: string;
}

/**
 * 새 환불·페이백의 기본 들어온 곳.
 *
 * 카드로 낸 것이면 그 카드에 연결된 통장(`paymentAccountId`)이다 -- 돌려받은 돈은 대개 통장에
 * 찍힌다. 통장이나 빈 값은 그대로다. 사용자는 폼에서 카드로 바꿀 수 있다.
 *
 * 카드를 그대로 두는 때: 카드를 목록에서 찾지 못했을 때(목록을 아직 읽지 못했거나 지운 카드),
 * 그리고 연결된 통장을 폼에서 고를 수 없을 때(`isSelectable` 이 거절 -- 쓰지 않는 통장).
 * 고를 수 없는 값을 기본으로 두면 화면에 보이는 것과 저장되는 것이 갈린다.
 */
export function paybackMethodOf(
  method: PaymentMethodValue,
  cards: readonly PaybackCard[],
  isSelectable: (value: PaymentMethodValue) => boolean,
): PaymentMethodValue {
  const { cardId } = parseMethod(method);
  if (!cardId) return method;
  const card = cards.find((item) => item.id === cardId);
  if (!card?.paymentAccountId) return method;
  const account = accountValue(card.paymentAccountId);
  return isSelectable(account) ? account : method;
}

/**
 * 원거래에서 새 페이백 폼을 채운다.
 *
 * 들어온 날짜는 오늘이다(페이백은 대개 나중에 들어온다). 사람과 설명은 원거래의 것을,
 * 들어온 수단은 원거래가 쓴 수단에 연결된 통장을 기본으로 둔다(`paybackMethodOf`).
 * 원거래 줄이 하나면 그 줄을 고르고, 분할이면 비워 두어 화면이 고르게 한다.
 */
export function paybackFormFrom(
  original: EntryListItem,
  timeZone: string,
  cards: readonly PaybackCard[],
  isSelectable: (value: PaymentMethodValue) => boolean,
): EntryFormValues {
  const only = original.lines.length === 1 ? original.lines[0] : null;
  return {
    ...emptyEntryForm({ personId: original.personId ?? '', timeZone }),
    kind: 'payback',
    description: original.description,
    method: paybackMethodOf(methodValueOf(original.cardId, original.accountId), cards, isSelectable),
    categoryId: only?.categoryId ?? '',
    // 카드로 들어온 돈은 실적에서 빼는 것이 기본이다 (`defaultCountsPerformance`).
    countsPerformance: defaultCountsPerformance('payback', 'payback'),
    paybackOfEntryId: original.id,
    paybackOfLineKey: only?.lineKey ?? '',
  };
}

/**
 * 이 거래의 금액에 들어 있는 할부 이자.
 *
 * 분할이면 줄마다의 몫도 낸다(`lineShares`, `item.lines` 와 같은 차례). 조립은 이자를 **원금**
 * 비율로 나누고(`allocateByWeight`, 끝수는 첫 줄) 장부 통화의 자릿수로 자른다. 목록에는 이자가
 * 얹힌 줄 금액만 오므로 그 나눔을 거꾸로 푼다 -- 원금을 어림하고, 그 원금으로 다시 나눠 같은 줄
 * 금액이 나올 때까지 고친다. 예전에는 얹힌 금액 비율로 0자리에서 잘라, 원금 4,999·5,000 에 이자
 * 999 인 분할이 4,999·4,999 로 열려 저장이 SPLIT_SUM_MISMATCH 로 막혔다.
 *
 * 자릿수는 줄 금액을 정확히 되살리는 것을 고른다 (목록 줄에는 장부 통화가 실리지 않는다).
 *
 * **폼을 스스로 채우는 화면도 이 함수를 쓴다.** 웹 편집기는 자기 모양의 상태를 들고
 * 있어 `entryFormFromItem` 을 거치지 않는데, 되빼는 규칙이 두 벌이면 같은 거래를
 * 웹에서 열 때와 앱에서 열 때 금액 칸이 갈린다.
 */
export function interestInAmount(item: EntryListItem): {
  total: Dec;
  lineShares: Dec[];
} {
  const months = item.installmentMonths ?? 0;
  const shares = item.installmentInterestShares;
  const none = { total: Dec.of(0), lineShares: item.lines.map(() => Dec.of(0)) };
  if (months < 2 || !shares || shares.length !== months) return none;

  let total: Dec;
  let charged: Dec[];
  try {
    total = shares.reduce<Dec>((acc, share) => acc.plus(Dec.of(share)), Dec.of(0));
    charged = item.lines.map((line) => Dec.of(line.amount).abs());
  } catch {
    return none;
  }
  if (total.isZero()) return none;
  if (charged.length <= 1) return { total, lineShares: charged.map(() => total) };

  return { total, lineShares: unspreadInterest(total, charged) };
}

/** 조립의 이자 나눔(`allocateByWeight`)을 거꾸로 푼다. 줄마다 얹힌 이자를 돌려준다. */
function unspreadInterest(total: Dec, charged: readonly Dec[]): Dec[] {
  const chargedSum = Dec.sum([...charged]);
  const principalSum = chargedSum.minus(total);
  // 원금이 남지 않으면 비율이 없다. 조립과 같이 첫 줄에 모두 둔다.
  if (!principalSum.isPositive()) return charged.map((_, index) => (index === 0 ? total : Dec.of(0)));

  /*
   * 금액에 실제로 적힌 소수 자릿수보다 적은 자리로는 풀지 않는다. 0자리로 풀면 끝수가 첫 줄에 몰린
   * 다른 해가 나와도 줄 금액은 맞아 보여, 2자리 장부의 원금이 엉뚱하게 갈렸다.
   */
  const least = Math.max(...[total, ...charged].map(fractionDigits));
  for (const decimals of [0, 1, 2, 3, 4].filter((value) => value >= least)) {
    let principals = charged.map((line) => line.times(principalSum).dividedBy(chargedSum, decimals, 'down'));
    for (let round = 0; round < 6; round += 1) {
      const spread = allocateByWeight(total, principals, decimals);
      const next = charged.map((line, index) => line.minus(spread[index]));
      if (next.every((value, index) => value.eq(principals[index]))) return spread;
      principals = next;
    }
  }

  // 풀리지 않으면(손으로 고친 옛 전표) 얹힌 금액 비율로 어림한다.
  return allocateByWeight(total, [...charged], least);
}

/** 소수점 아래 자릿수. "12.30" 처럼 끝의 0 은 세지 않는다. */
function fractionDigits(value: Dec): number {
  const [, fraction = ''] = value.toString().split('.');
  return fraction.replace(/0+$/, '').length;
}

/** 금액에서 그 몫의 이자를 뺀다. 이자가 없으면 글자를 그대로 돌려준다. */
export function withoutInterest(amount: string, share: Dec, total: Dec): string {
  if (total.isZero() || share.isZero()) return amount;
  const value = toDec(amount);
  return value ? value.minus(share).toString() : amount;
}

/** 줄 하나의 정가. 목록이 주는 금액은 차감을 뺀 뒤의 값이다. */
function grossOfLine(line: { amount: string; discountAmount: string | null }): string {
  if (!line.discountAmount) return line.amount;
  const net = toDec(line.amount);
  const discount = toDec(line.discountAmount);
  // 숫자가 아니면 손대지 않는다. 검증이 그 값을 막는다.
  if (!net || !discount) return line.amount;
  return net.plus(discount).toString();
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
    /** 이체의 받는 통장. 반복에서 온 이체 후보만 채워 온다. 옛 사본에는 없다. */
    toAccountId?: string | null;
    /** 이체 수수료와 그 분류. 반복에서 온 이체 후보만 채워 온다. */
    feeAmount?: string | null;
    feeCategoryId?: string | null;
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
   * 이체는 이 값이 **보내는 쪽**이 된다. 받는 쪽은 반복에 적어 둔 것이 있으면 그것이고,
   * 알림·캡처는 문구에서 알 수 없어 비워 두고 사람이 고른다 (검증이 그 칸을 요구한다).
   */
  const method = methodValueOf(draft.cardId, draft.accountId);

  const when = draft.occurredAt ? new Date(draft.occurredAt) : null;
  const hasWhen = when !== null && !Number.isNaN(when.getTime());

  return {
    ...base,
    kind,
    method,
    toAccountId: kind === 'transfer' ? (draft.toAccountId ?? '') : '',
    // 수수료는 이체에만 있고, 0 이면 없는 것이다(폼의 빈 칸과 같은 뜻).
    ...(kind === 'transfer' && draft.feeAmount && Number(draft.feeAmount) > 0
      ? { transferFee: draft.feeAmount, transferFeeCategoryId: draft.feeCategoryId ?? '' }
      : {}),
    amount: draft.amount ?? '',
    /*
     * 통화. 장부 통화면 비워 둔다.
     *
     * 폼에서 빈 값이 곧 장부 통화이고(그때는 환산할 것이 없다), 원화 후보에 'KRW'를
     * 적어 넣으면 장부 통화가 원화인 가계부에서도 환율 칸이 열린다.
     */
    currency: draft.currency && draft.currency !== options.ledgerCurrency ? draft.currency : '',
    description: draft.description ?? draft.merchant ?? '',
    merchant: draft.merchant ?? '',
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
