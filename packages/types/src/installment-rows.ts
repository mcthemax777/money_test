/**
 * 회차 기준 집계의 한 줄을 만든다. 서버(installment-scope)와 기기 사본(local-store)이 함께 쓴다.
 *
 * 두 곳은 읽는 곳만 다르다 -- 서버는 Prisma 의 다리와 계획을, 기기는 SQLite 의 열을 읽는다.
 * 읽은 값을 여기 넘기면 규칙(환불 조정, 할부 계획, 줄에 걸린 환불의 몫)은 한 벌이다. 예전에는
 * 두 곳에 같은 규칙을 따로 적어 두어, 한쪽만 고치면 웹과 앱의 회차 숫자가 갈렸다.
 */
import { Dec, type DecInput } from './decimal';
import { adjustTotals, installmentRefundRow, lineCutsOf, parseInstallmentAdjust } from './installment-refund';
import type { CategoryPostingRow, InstallmentRowPlan } from './report-aggregation';

/** 카드 다리에 걸린 할부 계획. 읽은 그대로 넘긴다. */
export interface InstallmentPlanSource {
  months: number;
  /** 카드 다리의 계좌 통화 금액과 환산액. 둘이 같아야 적어 둔 이자를 그대로 쓴다. */
  amount: DecInput;
  baseAmount: DecInput;
  /** 적어 둔 회차 원금·이자. JSON 배열이거나 그 글자다. */
  principalShares: unknown;
  interestShares: unknown;
}

/** 회차 기준 한 줄에 필요한 것. */
export interface InstallmentRowSource {
  /** 이 줄의 키. 걸린 환불은 같은 키의 줄 것만 센다. */
  lineKey: string | null;
  /** 이 전표가 할부 환불이면 회차마다 줄인 금액 (JSON 이거나 그 글자). */
  refundAdjust: unknown;
  /** 할부 환불이 남은 몫을 세는 날 -- 환불 전표 자신의 날짜다. */
  ownDate: Date | string;
  /** 이 전표의 할부 계획. 할부가 아니면 null. */
  plan: InstallmentPlanSource | null;
  /** 이 원거래에 걸린 할부 환불들. 각자 걸린 줄의 키와 줄인 금액을 든다. */
  refunds: ReadonlyArray<{ lineKey: string | null; adjust: unknown }>;
}

/**
 * 회차 기준의 집계 행 하나.
 *
 *   - 할부 환불이면 남은 회차로 다 줄이지 못한 몫만, 환불한 날에 센다.
 *   - 할부 원거래의 줄이면 할부 계획과 그 줄에 걸린 환불이 줄인 회차를 싣는다.
 *   - 둘 다 아니면 그대로다.
 */
export function spreadInstallmentRow<T extends CategoryPostingRow>(
  row: T,
  source: InstallmentRowSource,
): T {
  const adjust = parseInstallmentAdjust(source.refundAdjust);
  if (adjust) return installmentRefundRow(row, adjust, source.ownDate);

  const plan = installmentRowPlanOf(source.plan);
  if (!plan) return row;
  const cuts = lineCutsOf(
    source.refunds.map((refund) => ({
      lineKey: refund.lineKey,
      adjust: parseInstallmentAdjust(refund.adjust),
    })),
    source.lineKey,
    plan.months,
  );
  return { ...row, installment: cuts ? { ...plan, cuts } : plan };
}

/**
 * 할부 계획을 펴기 좋은 모양으로. 2개월 미만이면 할부가 아니다.
 *
 * 적어 둔 이자는 카드 다리가 장부 통화일 때만 쓴다 -- 외화 다리의 환산액에 이자를 얹으면 단위가
 * 어긋난다(유이자 할부는 외화로 적을 수 없지만 옛 전표가 있다).
 */
export function installmentRowPlanOf(plan: InstallmentPlanSource | null): InstallmentRowPlan | undefined {
  if (!plan || plan.months < 2) return undefined;
  const base = Dec.of(plan.baseAmount);
  return {
    months: plan.months,
    total: base.abs().toString(),
    principals: shareListOf(plan.principalShares),
    interests: Dec.of(plan.amount).eq(base) ? shareListOf(plan.interestShares) : null,
  };
}

/** 적어 둔 회차 값을 문자열 배열로. 비었거나 모양이 아니면 null 이다. JSON 글자도 받는다. */
export function shareListOf(value: unknown): string[] | null {
  let list = value;
  if (typeof value === 'string') {
    if (value === '') return null;
    try {
      list = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(list) || list.length === 0) return null;
  return list.map((share) => String(share));
}

/**
 * 카드 실적에서 함께 빼는 차감액. 분류 줄마다 적힌 차감의 합이다. 없으면 null.
 *
 * 차감은 사용자가 적은 통화이고 카드 다리는 계좌 통화라, 둘이 갈리는 거래(원화 카드로 한 외화
 * 결제, `originalCurrency` 가 있다)에서는 더할 수 없어 되살리지 않는다. 서버 카드 원장과 기기
 * 사본이 함께 쓴다.
 */
export function cardDiscountOf(
  originalCurrency: string | null | undefined,
  lineDiscounts: ReadonlyArray<DecInput | null | undefined>,
): string | null {
  if (originalCurrency) return null;
  const total = lineDiscounts.reduce<Dec>(
    (acc, value) => (value === null || value === undefined || value === '' ? acc : acc.plus(Dec.of(value))),
    Dec.of(0),
  );
  return total.isZero() ? null : total.toString();
}

/**
 * 할부 환불이 카드 청구와 실적에 주는 것 (installment-refund). 서버 카드 원장과 기기 사본이 함께 쓴다.
 *
 *   - 할부 원거래의 카드 다리: 걸린 환불이 회차마다 줄인 것. 청구 회차에서 뺀다.
 *   - 할부 환불의 카드 다리: 그 환불이 줄인 것의 합. 청구는 남은 몫만, 실적은 돌려받은 돈만.
 */
export function cardRefundCutsOf(input: {
  /** 이 전표가 할부 환불이면 그 조정 (JSON 이거나 그 글자). */
  refundAdjust: unknown;
  /** 이 카드 다리의 할부 개월수. 할부가 아니면 null. */
  months: number | null | undefined;
  /** 이 원거래에 걸린 할부 환불들의 조정. 카드 다리는 줄을 가리지 않는다. */
  refunds: ReadonlyArray<unknown>;
}): {
  installmentCuts: string[] | null;
  refundCut: { total: string; interest: string } | null;
} {
  const adjust = parseInstallmentAdjust(input.refundAdjust);
  const totals = adjust ? adjustTotals(adjust) : null;
  return {
    installmentCuts:
      input.months && input.months >= 2
        ? lineCutsOf(
            input.refunds.map((refund) => ({ lineKey: null, adjust: parseInstallmentAdjust(refund) })),
            null,
            input.months,
          )
        : null,
    refundCut: totals ? { total: totals.total.toString(), interest: totals.interest.toString() } : null,
  };
}
