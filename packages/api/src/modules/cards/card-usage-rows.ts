/**
 * 카드 사용 다리를 읽는 select 와, 읽은 행을 공용 함수·응답의 모양으로 옮기는 순수 함수들
 * (card-ledger.service.ts 에서 떼어 냄, 2026-10-26).
 *
 * 주기를 만들고 할부를 나누는 규칙은 `@money/types` 의 card-usage 가 갖는다. 기기도 오프라인에서
 * 같은 값을 내야 해서 옮겼다. 여기 남은 것은 "무엇을 읽어 어떤 모양으로 넘길지"다.
 */
import { Prisma } from '@prisma/client';
import {
  CardDto,
  type CardUsagePosting,
  cardDiscountOf,
  cardRefundCutsOf,
  periodForClosingMonth,
} from '@money/types';
import { INSTALLMENT_REFUND_SELECT, type InstallmentRefundCuts } from '@/common/installment-scope';
import type { ClosingMonth } from './card-period-walk';

/** 깎인 금액을 더하려면 분류 다리를 함께 읽어야 한다. 카드 다리를 읽는 질의마다 붙인다. */
export const USAGE_LEG_SELECT = {
  categoryId: true,
  discountAmount: true,
} satisfies Prisma.PostingSelect;

/** 할부 계획에서 읽는 것. 회차 원금·이자 표가 있으면 개월수로 나누지 않고 그 값을 쓴다. */
export const INSTALLMENT_PLAN_SELECT = {
  select: { totalMonths: true, principalShares: true, interestShares: true },
} as const;

/** 실적 원장 한 줄이 전표에서 읽는 것. 분류는 형제 다리에 붙어 있다. */
export const periodLedgerEntrySelect = {
  id: true,
  date: true,
  description: true,
  merchant: true,
  countsPerformance: true,
  discountCountsPerformance: true,
  originalCurrency: true,
  postings: {
    select: {
      ...USAGE_LEG_SELECT,
      category: { select: { name: true, parent: { select: { name: true } } } },
    },
    orderBy: { id: 'asc' },
  },
  ...INSTALLMENT_REFUND_SELECT,
} satisfies Prisma.JournalEntrySelect;

export type PeriodLedgerEntry = Prisma.JournalEntryGetPayload<{
  select: typeof periodLedgerEntrySelect;
}>;

/**
 * 실적을 정가로 셀 때 되살릴 차감액.
 *
 * 깎인 금액은 **줄마다** 적히므로(`Posting.discountAmount`) 그 합을 쓴다. 그것을
 * 실적에서 뺄지는 카드사의 방침 하나라 전표에 있다.
 *
 * 차감액은 사용자가 적은 통화이고 카드 다리는 계좌 통화라, 둘이 갈리는 거래(원화
 * 카드로 한 외화 결제)에서는 그대로 더할 수 없다. 그때는 되살리지 않고 지금까지의
 * 규칙(차감이 실적도 깎는다)을 그대로 둔다 -- 폼도 그 거래에는 이 칸을 띄우지 않는다.
 */
export function performanceDiscount(entry: {
  discountCountsPerformance: boolean;
  originalCurrency: string | null;
  postings: Array<{ categoryId: string | null; discountAmount: Prisma.Decimal | null }>;
}): Pick<CardUsagePosting, 'discountAmount' | 'discountCountsPerformance'> {
  // 더하는 규칙은 기기 사본과 함께 쓴다 (`cardDiscountOf`).
  return {
    discountAmount: cardDiscountOf(
      entry.originalCurrency,
      entry.postings.filter((leg) => leg.categoryId !== null).map((leg) => leg.discountAmount),
    ),
    discountCountsPerformance: entry.discountCountsPerformance,
  };
}

/** 할부 환불이 청구와 실적에 주는 것. 규칙은 기기 사본과 함께 쓴다 (`cardRefundCutsOf`). */
export function refundCutFields(
  entry: { installmentAdjust?: unknown; paybacks?: InstallmentRefundCuts },
  months: number | null | undefined,
): Pick<CardUsagePosting, 'installmentCuts' | 'refundCut'> {
  return cardRefundCutsOf({
    refundAdjust: entry.installmentAdjust,
    months,
    refunds: (entry.paybacks ?? []).map((cut) => cut.installmentAdjust),
  });
}

/**
 * 계획에 적힌 회차 원금을 문자열 배열로 가린다.
 *
 * JSON 칸이라 무엇이든 들어올 수 있다. 모양이 아니면 없는 것으로 보고 개월수로 나눈다
 * (`@money/types` 의 목록 뷰와 같은 규칙이다).
 */
export function toShares(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.map((share) => String(share));
}

/** 신용카드 한 마감 연월의 청구 주기. 실적·청구 원장이 같은 자르기를 쓴다. */
export function statementPeriodOf(
  closing: ClosingMonth,
  closingDay: number,
  paymentDueDay: number,
): { start: Date; end: Date } {
  const period = periodForClosingMonth(closing.year, closing.month, closingDay, paymentDueDay);
  return { start: period.periodStart, end: period.periodEnd };
}

/** 줄에 적을 분류. 전표의 첫 분류 다리가 대표다 (분할이면 첫 줄). */
function categoryOf(entry: PeriodLedgerEntry) {
  return entry.postings.find((leg) => leg.categoryId !== null)?.category ?? null;
}

/**
 * 주기 원장 한 줄. 쌓인 값(`runningTotal`)은 주기를 채울 때 붙인다.
 *
 * 실적 줄과 청구 줄이 함께 쓴다. 청구 줄만 회차 번호(`installmentIndex`)를 싣는다.
 */
export function periodLedgerRow(input: {
  key: string;
  entry: PeriodLedgerEntry;
  cardId: string;
  cardName: string | null;
  /** 공용 함수가 나눈 그 줄의 몫. 줄에는 부호를 뒤집어 싣는다. */
  amount: Prisma.Decimal.Value;
  period: { start: Date };
  installmentIndex?: number;
  installmentMonths: number;
}): CardDto.PeriodLedgerRow {
  const { entry } = input;
  const category = categoryOf(entry);

  return {
    key: input.key,
    entryId: entry.id,
    date: entry.date.toISOString(),
    description: entry.description,
    merchant: entry.merchant,
    // 계좌 원장과 같은 부호 규칙이다. 사용이 음수라 화면이 뒤집어 읽는다.
    amount: new Prisma.Decimal(input.amount).neg().toString(),
    runningTotal: '0',
    periodStart: input.period.start.toISOString(),
    cardId: input.cardId,
    cardName: input.cardName,
    categoryName: category?.name ?? null,
    parentCategoryName: category?.parent?.name ?? null,
    ...(input.installmentIndex !== undefined ? { installmentIndex: input.installmentIndex } : {}),
    installmentMonths: input.installmentMonths,
  };
}
