/**
 * 폼 값을 서버(또는 아웃박스)가 받는 요청으로 조립한다.
 *
 * 할부의 회차 원금·이자를 실을지 말지, 실적 값을 실을지 말지도 여기서 정한다.
 */

import { type EntryDto, zonedFormValueToUtc } from '@money/types';

import { installmentInterestInputs, installmentShareInputs } from '../lib/period-ledger';
import {
  type EntryFormValues,
  defaultCountsPerformance,
  installmentBaseAmount,
  parseMethod,
  showDiscountPerformance,
  toDec,
  totalDiscountOf,
  transferBasisOf,
} from './entry-form-values';

/**
 * 손대지 않은 회차 원금을 실어야 하는가. 실어야 하면 그 값, 아니면 null (웹·앱 저장이 함께 쓴다).
 *
 * 장부 통화의 자릿수로 나눈 기본값(화면에 보이고 이자가 딛는 값)이 서버가 금액 글자만 보고 나눌 값과 다를
 * 때만 싣는다. 소수가 없는 달러 금액 100 이 그렇다(33.34·33.33·33.33 과 34·33·33). 원화는 같아 싣지 않는다 --
 * 실어 두면 나중에 금액을 고쳤을 때 회차가 함께 다시 나뉘지 않는다.
 */
export function defaultSharesToSend(base: string, months: number, ledgerCurrency?: string): string[] | null {
  if (!ledgerCurrency) return null;
  const byCurrency = installmentShareInputs(base, months, null, ledgerCurrency);
  const byText = installmentShareInputs(base, months, null);
  return byCurrency.length > 0 && byCurrency.join('|') !== byText.join('|') ? byCurrency : null;
}

/**
 * 회차 금액을 짐에 싣는다. 손대지 않았으면 싣지 않는다.
 *
 * 비어 있으면 서버가 개월수로 나눈다. 그래야 나중에 금액을 고쳤을 때 회차도 함께
 * 다시 나뉜다 -- 한 번 채워 보내 두면 옛 금액의 회차가 남는다.
 */
function installmentSharesPayload(
  values: EntryFormValues,
  ledgerCurrency?: string,
): { installmentShares?: string[] } {
  /*
   * 한 칸도 손대지 않았으면 싣지 않는다. 그때는 서버가 개월수로 나눈다.
   *
   * 단 장부 통화의 자릿수로 나눈 값이 서버가 금액 글자만 보고 나눌 값과 다르면 싣는다 (2026-10-21). 소수가
   * 없는 달러 금액(100)은 서버가 34·33·33 달러로 나누는데 화면과 이자는 33.34·33.33·33.33 을 딛는다 --
   * 싣지 않으면 청구 회차와 화면이 갈린다. 원화는 두 값이 같아 지금처럼 싣지 않는다.
   */
  if (values.installmentShares.every((share) => share.trim() === '')) {
    const shares = defaultSharesToSend(
      installmentBaseAmount(values.amount, totalDiscountOf(values)),
      Number(values.installmentMonths),
      ledgerCurrency,
    );
    return shares ? { installmentShares: shares } : {};
  }

  // 비운 칸은 0 이다. 개수를 줄여 보내면 서버가 "개수가 다르다"로 거절해 까닭이 흐려진다.
  return {
    installmentShares: values.installmentShares.map((share) =>
      share.trim() === '' ? '0' : share.trim(),
    ),
  };
}

/**
 * 이자 쪽을 짐에 싣는다. 유이자 할부에만 실린다.
 *
 * 무이자면 아무것도 싣지 않는다 -- 서버가 계획의 이자 칸을 비우므로, 유이자로 적었다가
 * 되돌린 할부에 옛 이자가 남지 않는다.
 *
 * **화면에 보이는 값을 그대로 싣는다.** 계산으로 채워 준 기본값도 사용자가 손대지
 * 않았다고 버리지 않는다 -- 이자는 전표 금액 안에 들어가는 값이라, 보이는 대로 저장하지
 * 않으면 고쳐 저장하는 순간 갚을 돈이 원금만 남는다. 서버는 이자를 계산하지 않으므로
 * 여기서 싣지 않으면 되살릴 자리가 없다.
 *
 * 방식을 고르지 않아 칸이 비어 있으면 아무것도 싣지 않는다. 0 이 스물넉 줄 저장되면
 * "아직 모른다"와 "이자가 없다"가 구별되지 않는다.
 */
function installmentInterestPayload(values: EntryFormValues, ledgerCurrency?: string): {
  installmentInterestShares?: string[];
  installmentMonthlyPayment?: string;
  installmentAnnualRate?: string;
} {
  if (values.installmentInterest !== 'interest') return {};

  const months = Number(values.installmentMonths);
  // 화면이 채워 보여 주는 값과 같은 함수다 (`EntryEditor` 의 interestInputs).
  const base = installmentBaseAmount(values.amount, totalDiscountOf(values));
  const shown = installmentInterestInputs({
    total: base,
    months,
    principals: installmentShareInputs(base, months, values.installmentShares, ledgerCurrency),
    mode: values.installmentInterestMode,
    monthlyPayment: values.installmentMonthlyPayment,
    annualRate: values.installmentAnnualRate,
    saved: values.installmentInterestShares,
    currency: ledgerCurrency,
  });

  const filled = shown.some((share) => share.trim() !== '');
  const payment =
    values.installmentInterestMode === 'fixed' ? values.installmentMonthlyPayment.trim() : '';
  const rate =
    values.installmentInterestMode === 'rate' ? values.installmentAnnualRate.trim() : '';

  return {
    ...(filled
      ? {
          installmentInterestShares: shown.map((share) =>
            share.trim() === '' ? '0' : share.trim(),
          ),
        }
      : {}),
    ...(payment ? { installmentMonthlyPayment: payment } : {}),
    ...(rate ? { installmentAnnualRate: rate } : {}),
  };
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
  /** 장부 통화. 유이자 할부의 이자를 그 자릿수로 셈한다 (화면의 `installmentInterestInputs` 와 같은 값). */
  ledgerCurrency?: string,
): EntryDto.CreateRequest {
  const method = parseMethod(values.method);
  const base = {
    kind: values.kind,
    // 빈 칸은 미지정이다. 고치기도 통째로 바꾸므로 null 을 보내면 사람이 지워진다.
    personId: values.personId || null,
    date: zonedFormValueToUtc(values.dateKey, values.timeKey, timeZone).toISOString(),
    description: values.description.trim(),
    // 비었으면 싣지 않는다 -- 고치기에서 생략은 "비운다"로 읽혀, 지운 칸은 지운 대로 남는다.
    ...(values.merchant.trim() ? { merchant: values.merchant.trim() } : {}),
    ...(values.detailedNote.trim() ? { detailedNote: values.detailedNote.trim() } : {}),
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
      // 고치는 중이고 금액·계좌·통화가 그대로면 받은 금액도 그대로다 (`toAmount` 참고).
      ...(values.toAmount && values.toAmountBasis === transferBasisOf(values)
        ? { toAmount: values.toAmount }
        : {}),
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

  // 할부는 신용카드 지출에만 붙는다. 그 판단은 조립이 다시 한다. 분할이든 아니든 같은 값이다.
  const installment =
    values.kind === 'expense' && method.cardId && months >= 2
      ? {
          installmentMonths: months,
          installmentInterest: values.installmentInterest === 'interest',
          ...installmentSharesPayload(values, ledgerCurrency),
          ...installmentInterestPayload(values, ledgerCurrency),
        }
      : {};

  /*
   * 그 줄에서 깎인 금액. 분류 하나짜리와 분할이 같은 함수를 쓴다.
   *
   * 차감은 지출에만 싣는다. 갈래를 옮겨도 폼은 값을 들고 있으므로(이체로 갔다가
   * 돌아오면 그대로다) 여기서 갈래를 한 번 더 본다.
   */
  const lineDiscount = (discountAmount: string) =>
    values.kind === 'expense' && discountAmount.trim() ? { discountAmount } : {};

  /*
   * 카드 실적 두 칸. **분할이든 아니든 거래에 하나씩이다.**
   *
   * 기본값과 다를 때만 싣는다. 기본값은 조립이 갈래를 보고 정하므로 같은 값을 굳이
   * 보내지 않는다 -- 짐만 보고도 사용자가 손댄 자리가 드러난다.
   */
  const performanceExtra = {
    ...(method.cardId && values.countsPerformance !== defaultCountsPerformance(values.kind, values.paybackType)
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
      ...installment,
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
    ...installment,
    ...lineDiscount(values.discountAmount),
    ...performanceExtra,
    // 페이백의 원거래와 그 줄. 원거래가 없으면 조립이 링크를 비운다.
    ...(values.kind === 'payback' && values.paybackOfEntryId
      ? { paybackOfEntryId: values.paybackOfEntryId, paybackOfLineKey: values.paybackOfLineKey }
      : {}),
    // 돌아온 돈의 종류. 조립이 이것으로 실적의 기본값을 정한다.
    ...(values.kind === 'payback' ? { paybackType: values.paybackType } : {}),
    // 할부 환불의 회차별 줄일 원금. 비운 칸은 0 이다 (installment-refund).
    ...(values.kind === 'payback' && values.installmentCut.length > 0
      ? { installmentCut: values.installmentCut.map((value) => value.trim() || '0') }
      : {}),
  };
}
