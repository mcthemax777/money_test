/**
 * 환불 편집기의 "할부 처리" (PAYBACK_DESIGN.md 7-9). 웹과 앱의 PaybackEditor 가 함께 쓴다.
 *
 * 할부로 산 거래를 환불하면 카드사는 아직 청구하지 않은 회차를 줄인다. 이 훅은 그 표를 만든다.
 *
 *   - **언제 서나.** 원거래가 할부이고, 종류가 환불이며, 들어온 곳이 원거래 카드일 때. 그 밖에는
 *     폼의 `installmentCut` 을 비운다 -- 조립이 회차를 줄이지 않고 환불한 달에 한꺼번에 센다.
 *   - **기본값.** 환불한 다음 달 회차부터, 환불 금액을 남은 회차에 고르게 나눈다
 *     (`defaultInstallmentCut`). 회차를 손대면 그 값이 남는다(`installmentCutTouched`).
 *   - **전액 취소.** 금액을 아직 돌려받지 않은 원금 전부로 채우고 남은 회차를 0 으로 만든다.
 *
 * 금액은 표시 통화다. 저장 통화와 다르면 회차를 줄이지 않는다(`currencyMismatch`) -- 조립은
 * 저장 통화로 검사하므로 환산 끝수 때문에 거절될 수 있다.
 */
import { useCallback, useEffect, useMemo } from 'react';
import {
  Dec,
  type EntryListItem,
  defaultInstallmentCut,
  effectiveLineSchedule,
  installmentCutStart,
  installmentLineSchedule,
  shiftYearMonth,
  zonedYearMonth,
} from '@money/types';
import { parseMethod, type EntryFormValues } from '../data/entry-form';

export interface InstallmentRefundRow {
  /** 회차 번호 (1부터). */
  index: number;
  /** 그 회차가 서는 달 ('YYYY-MM'). */
  yearMonth: string;
  /** 이번 환불 전에 남아 있던 원금 (다른 환불이 줄인 것을 뺀 값). */
  before: string;
  /** 이번 환불 뒤의 원금. */
  after: string;
  /** 환불한 달까지의 회차. 이미 나간 것으로 보고 기본값은 줄이지 않는다. */
  past: boolean;
}

export interface InstallmentRefund {
  /** 원거래가 할부라 이 상자를 세울 자리인가. 종류·들어온 곳과 상관없이 참일 수 있다. */
  isInstallment: boolean;
  /** 지금 회차를 줄이는가. 거짓이면 그 까닭이 `blockedBy` 에 있다. */
  applies: boolean;
  blockedBy: 'not-refund' | 'other-method' | 'currency' | null;
  rows: InstallmentRefundRow[];
  /** 환불한 달 ('YYYY-MM'). 다 줄이지 못한 몫이 이 달에 돌아온다. */
  refundYearMonth: string;
  /** 환불한 달에 한꺼번에 돌아오는 돈 = 환불 금액 − 줄인 원금의 합. */
  lump: string;
  /** 환불 뒤에도 남아 있는 회차 (원금이 0 보다 큰 미래 회차). */
  remaining: InstallmentRefundRow[];
  /** 줄인 회차의 합이 환불 금액보다 크다. 저장하면 조립이 거절한다 (INSTALLMENT_CUT_OVER_AMOUNT). */
  overAmount: boolean;
  /** 남은 원금보다 많이 줄인 회차가 있다 (INSTALLMENT_CUT_TOO_LARGE). */
  overShare: boolean;
  /** 한 회차의 "바뀐 뒤" 금액을 고친다. */
  setAfter: (index: number, text: string) => void;
  /** 전액 취소. */
  cancelAll: () => void;
}

export function useInstallmentRefund(input: {
  /** 원거래 (산 날의 것). 없으면 상자가 서지 않는다. */
  original: EntryListItem | null;
  /** 고치는 환불의 id. 그 환불이 이미 줄인 것은 "이번 환불 전"에 넣지 않는다. */
  editingId: string | null;
  values: EntryFormValues;
  setField: <K extends keyof EntryFormValues>(field: K, value: EntryFormValues[K]) => void;
  timeZone: string;
  /** 표시 통화가 저장 통화와 같은가. */
  sameCurrency: boolean;
}): InstallmentRefund {
  const { original, editingId, values, setField, timeZone, sameCurrency } = input;

  const plan = useMemo(() => {
    const months = original?.installmentMonths ?? 0;
    // 외화로 산 할부는 회차가 카드 통화라 줄이지 않는다 (조립의 sameCurrency 와 같다).
    if (!original || months < 2 || original.originalCurrency) return null;
    const line =
      original.lines.find((candidate) => candidate.lineKey === values.paybackOfLineKey) ??
      (original.lines.length === 1 ? original.lines[0] : null);
    if (!line) return null;
    const schedule = installmentLineSchedule({
      entryAmount: original.amount,
      lineAmount: line.amount,
      months,
      principals: original.installmentShares,
      interests: original.installmentInterestShares,
    });
    const others = (original.installmentCuts ?? []).filter(
      (cut) =>
        cut.entryId !== editingId && (original.lines.length === 1 || cut.lineKey === line.lineKey),
    );
    return {
      months,
      effective: effectiveLineSchedule(schedule, others),
      purchaseYearMonth: zonedYearMonth(new Date(original.date), timeZone),
      cardId: original.cardId,
    };
  }, [original, editingId, values.paybackOfLineKey, timeZone]);

  const refundYearMonth = values.dateKey.slice(0, 7);
  const from = plan ? installmentCutStart(plan.purchaseYearMonth, refundYearMonth) : 0;

  const blockedBy: InstallmentRefund['blockedBy'] = !plan
    ? null
    : values.paybackType !== 'refund'
      ? 'not-refund'
      : parseMethod(values.method).cardId !== plan.cardId
        ? 'other-method'
        : !sameCurrency
          ? 'currency'
          : null;
  const applies = Boolean(plan) && blockedBy === null;

  const amount = toDec(values.amount);
  const defaults = useMemo(
    () =>
      plan && applies
        ? defaultInstallmentCut(plan.effective, from, amount ?? Dec.of(0)).map((value) => value.toString())
        : [],
    [plan, applies, from, amount?.toString()],
  );

  /*
   * 폼 값을 맞춘다. 줄이지 않을 자리면 비우고, 손대지 않았으면 기본값을 따라간다.
   * 개수가 맞지 않으면(줄을 바꿨다) 손댄 값도 버리고 기본값으로 돌아간다.
   */
  useEffect(() => {
    if (!applies) {
      if (values.installmentCut.length > 0) setField('installmentCut', []);
      return;
    }
    const mismatch = values.installmentCut.length !== defaults.length;
    if (mismatch && values.installmentCutTouched) setField('installmentCutTouched', false);
    if ((mismatch || !values.installmentCutTouched) && !sameList(values.installmentCut, defaults)) {
      setField('installmentCut', defaults);
    }
  }, [applies, defaults, values.installmentCut, values.installmentCutTouched, setField]);

  const cut = applies && values.installmentCut.length === plan?.months ? values.installmentCut : defaults;
  const rows: InstallmentRefundRow[] = plan
    ? plan.effective.map((share, offset) => {
        const before = maxZero(share.principal);
        const reduced = toDec(cut[offset] ?? '0') ?? Dec.of(0);
        const [year, month] = plan.purchaseYearMonth.split('-').map(Number);
        return {
          index: offset + 1,
          yearMonth: shiftYearMonth(year, month, offset),
          before: before.toString(),
          after: (applies ? before.minus(reduced) : before).toString(),
          past: offset < from,
        };
      })
    : [];
  const reducedTotal = applies
    ? cut.reduce<Dec>((acc, value) => acc.plus(toDec(value) ?? Dec.of(0)), Dec.of(0))
    : Dec.of(0);
  const lump = maxZero((amount ?? Dec.of(0)).minus(reducedTotal));

  const setAfter = useCallback(
    (index: number, text: string) => {
      if (!plan) return;
      const before = maxZero(plan.effective[index - 1].principal);
      const after = toDec(text.trim() === '' ? '0' : text) ?? Dec.of(0);
      const next = [...(values.installmentCut.length === plan.months ? values.installmentCut : defaults)];
      next[index - 1] = before.minus(after).toString();
      setField('installmentCut', next);
      setField('installmentCutTouched', true);
    },
    [plan, values.installmentCut, defaults, setField],
  );

  const cancelAll = useCallback(() => {
    if (!plan) return;
    const all = plan.effective.reduce<Dec>((acc, share) => acc.plus(maxZero(share.principal)), Dec.of(0));
    setField('amount', all.toString());
    setField(
      'installmentCut',
      plan.effective.map((share, offset) => (offset < from ? '0' : maxZero(share.principal).toString())),
    );
    setField('installmentCutTouched', true);
  }, [plan, from, setField]);

  return {
    isInstallment: Boolean(plan),
    applies,
    blockedBy,
    rows,
    refundYearMonth,
    lump: lump.toString(),
    remaining: rows.filter((row) => !row.past && Dec.of(row.after).isPositive()),
    overAmount: applies && amount !== null && reducedTotal.gt(amount),
    overShare: applies && rows.some((row) => Dec.of(row.after).isNegative()),
    setAfter,
    cancelAll,
  };
}

function toDec(value: string): Dec | null {
  try {
    const text = value.replace(/,/g, '').trim();
    return text === '' ? null : Dec.of(text);
  } catch {
    return null;
  }
}

function maxZero(value: Dec): Dec {
  return value.isNegative() ? Dec.of(0) : value;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => Dec.of(value || '0').eq(Dec.of(b[index] || '0')));
}
