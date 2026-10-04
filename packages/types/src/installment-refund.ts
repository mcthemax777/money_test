/**
 * 할부 거래의 환불 (PAYBACK_DESIGN.md 7-9).
 *
 * 카드사는 할부 거래를 취소하면 아직 청구하지 않은 회차를 줄이거나 없앤다. 이미 낸 회차는
 * 다음 청구에서 돌려준다. 그 모양을 그대로 따른다.
 *
 *   - **환불 전표가 "회차마다 줄인 금액"을 든다** (`InstallmentAdjust`). 원거래의 할부 계획은
 *     건드리지 않는다 -- 환불을 지우면 원래 일정으로 돌아오고, 두 기기가 따로 적은 환불도
 *     서로를 덮지 않는다.
 *   - **회차를 펴는 모든 자리가 그 값을 뺀다.** 목록·가계·예산(회차 기준)과 카드 결제대금.
 *   - **환불 전표 자신은 회차 기준에서 "남은 회차로 다 못 줄인 몫"만 센다** (`refundLump`).
 *     이미 낸 회차분이 그것이고, 환불한 날의 달에 한꺼번에 돌아온 돈으로 선다.
 *   - **줄어든 회차의 이자도 같은 비율로 줄인다.** 사라진 이자는 카드 빚에서도 빠져야 하므로
 *     환불 전표의 다리는 `환불 금액 + 사라진 이자` 다 (`installmentRefundLegAmount`).
 *
 * 금액은 모두 저장 통화(기준통화)이고, 줄 하나(환불이 걸린 원거래의 줄)의 값이다.
 */
import { Dec, type DecInput } from './decimal';
import { installmentInterests } from './card-usage';
import { installmentLineShares, installmentMonthShares } from './installment-schedule';

/** 회차를 나누는 끝수 자리. 할부 일정(installment-schedule)과 같다. */
const MONEY_SCALE = 0;

/** 환불 하나가 회차마다 줄인 금액. 둘 다 개월수만큼이고 0 이상이다. */
export interface InstallmentAdjust {
  principal: string[];
  interest: string[];
}

/** 줄 하나의 회차. 원금과 이자, 그 합. */
export interface InstallmentLineShare {
  principal: Dec;
  interest: Dec;
  total: Dec;
}

/** 저장된 값을 읽는다. 모양이 아니면 null -- 없는 것으로 본다. */
export function parseInstallmentAdjust(value: unknown): InstallmentAdjust | null {
  const raw = typeof value === 'string' ? safeJson(value) : value;
  if (!raw || typeof raw !== 'object') return null;
  const { principal, interest } = raw as { principal?: unknown; interest?: unknown };
  if (!Array.isArray(principal) || principal.length === 0) return null;
  const interestList = Array.isArray(interest) && interest.length === principal.length ? interest : null;
  return {
    principal: principal.map((value) => String(value)),
    interest: interestList ? interestList.map((value) => String(value)) : principal.map(() => '0'),
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 줄인 금액의 합. 원금·이자·둘의 합. */
export function adjustTotals(adjust: InstallmentAdjust): { principal: Dec; interest: Dec; total: Dec } {
  const principal = sum(adjust.principal);
  const interest = sum(adjust.interest);
  return { principal, interest, total: principal.plus(interest) };
}

/** 여러 환불의 줄인 금액을 회차마다 더한다. 개월수가 다른 것은 뜻을 잃은 옛 값이라 뺀다. */
export function sumInstallmentAdjusts(
  adjusts: readonly InstallmentAdjust[],
  months: number,
): { principal: Dec[]; interest: Dec[]; total: Dec[] } {
  const principal = Array.from({ length: months }, () => Dec.of(0));
  const interest = Array.from({ length: months }, () => Dec.of(0));
  for (const adjust of adjusts) {
    if (adjust.principal.length !== months) continue;
    adjust.principal.forEach((value, index) => {
      principal[index] = principal[index].plus(Dec.of(value));
    });
    adjust.interest.forEach((value, index) => {
      interest[index] = interest[index].plus(Dec.of(value));
    });
  }
  return { principal, interest, total: principal.map((value, index) => value.plus(interest[index])) };
}

/**
 * 이 줄이 가져갈 이자 총액. 줄 금액이 결제 금액에서 차지하는 만큼이다.
 *
 * 목록의 회차 몫(entry-rows)과 같은 저울이다. 둘이 다르면 화면의 "이자 3,000"과 환불이
 * 줄이는 이자가 갈린다.
 */
export function lineInterestTotal(
  lineAmount: DecInput,
  entryAmount: DecInput,
  interests: readonly DecInput[],
): Dec {
  const total = sum(interests);
  if (total.isZero()) return Dec.of(0);

  const line = Dec.of(lineAmount).abs();
  const whole = Dec.of(entryAmount).abs();
  if (whole.isZero() || line.eq(whole)) return total;
  return total.times(line).dividedBy(whole, 0);
}

/**
 * 원거래 한 줄의 회차. 목록의 회차 몫과 같은 규칙으로 나눈다.
 *
 * 줄 금액을 회차 몫(원금 + 이자)의 비율로 나누고, 그중 이자는 따로 나눈다.
 */
export function installmentLineSchedule(input: {
  /** 카드에 청구된 총액 (양수, 이자 포함). 전표 금액이다. */
  entryAmount: DecInput;
  /** 이 줄의 금액 (양수, 이자 몫 포함). */
  lineAmount: DecInput;
  months: number;
  principals?: readonly DecInput[] | null;
  interests?: readonly DecInput[] | null;
}): InstallmentLineShare[] {
  const { entryAmount, lineAmount, months, principals, interests } = input;
  if (months < 2) return [];
  const shares = installmentMonthShares({
    // 날짜는 금액을 나누는 데 쓰이지 않는다 (회차의 달 이름에만 쓰인다).
    date: new Date(0),
    total: Dec.of(entryAmount).abs(),
    months,
    principals,
    interests,
    timeZone: 'UTC',
  });
  const totals = installmentLineShares(
    Dec.of(lineAmount).abs(),
    shares.map((share) => share.amount),
  );
  const interestList = installmentInterests(interests, months)?.map((value) => value.toString()) ?? null;
  const lineInterests = interestList
    ? installmentLineShares(lineInterestTotal(lineAmount, entryAmount, interestList), interestList)
    : totals.map(() => Dec.of(0));
  return totals.map((total, index) => ({
    total,
    interest: lineInterests[index],
    principal: total.minus(lineInterests[index]),
  }));
}

/** 줄의 회차에서 이미 걸린 환불이 줄인 것을 뺀다. 이번 환불이 줄일 수 있는 자리다. */
export function effectiveLineSchedule(
  schedule: readonly InstallmentLineShare[],
  adjusts: readonly InstallmentAdjust[],
): InstallmentLineShare[] {
  const cut = sumInstallmentAdjusts(adjusts, schedule.length);
  return schedule.map((share, index) => {
    const principal = share.principal.minus(cut.principal[index]);
    const interest = share.interest.minus(cut.interest[index]);
    return { principal, interest, total: principal.plus(interest) };
  });
}

/**
 * 환불한 날 다음 달 회차의 차례 (0부터). 그 회차부터 줄인다.
 *
 * 회차는 산 달부터 달력 월로 한 달씩 선다(installmentRowDate). 환불한 달의 회차는 이미
 * 나간 것으로 보고, 그다음 회차부터 줄인다.
 */
export function installmentCutStart(purchaseYearMonth: string, refundYearMonth: string): number {
  const [py, pm] = purchaseYearMonth.split('-').map(Number);
  const [ry, rm] = refundYearMonth.split('-').map(Number);
  return Math.max(0, (ry - py) * 12 + (rm - pm) + 1);
}

/**
 * 기본으로 줄일 원금. 환불 금액을 남은 회차(`from` 부터)에 고르게 나눈다.
 *
 * 회차마다 남은 원금의 비율로 나눈다 -- 원금이 같으면 똑같이 나뉘고, 앞선 환불로 이미
 * 줄어든 회차는 덜 줄인다. 남은 원금보다 큰 환불은 남은 회차를 0 으로 만들고, 넘는 몫은
 * 줄이지 않는다(환불한 달에 한꺼번에 돌아온 돈이 된다).
 */
export function defaultInstallmentCut(
  effective: readonly InstallmentLineShare[],
  from: number,
  amount: DecInput,
): Dec[] {
  const cut = effective.map(() => Dec.of(0));
  const open = effective
    .map((share, index) => ({ index, principal: maxDec(share.principal, Dec.of(0)) }))
    .filter((share) => share.index >= from && share.principal.isPositive());
  const room = sum(open.map((share) => share.principal));
  const want = minDec(maxDec(Dec.of(amount), Dec.of(0)), room);
  if (want.isZero() || room.isZero()) return cut;

  let running = Dec.of(0);
  let given = Dec.of(0);
  open.forEach((share, at) => {
    running = running.plus(share.principal);
    const upto =
      at === open.length - 1 ? want : want.times(running).dividedBy(room, MONEY_SCALE);
    cut[share.index] = minDec(upto.minus(given), share.principal);
    given = given.plus(cut[share.index]);
  });
  return cut;
}

/**
 * 줄인 원금에 따라 줄일 이자. 회차마다 같은 비율이고, 원금을 다 없앤 회차는 이자도 다 없앤다.
 */
export function installmentInterestCut(
  effective: readonly InstallmentLineShare[],
  principalCut: readonly DecInput[],
): Dec[] {
  return effective.map((share, index) => {
    const cut = Dec.of(principalCut[index] ?? 0);
    if (!cut.isPositive() || !share.interest.isPositive()) return Dec.of(0);
    if (cut.gte(share.principal)) return share.interest;
    return share.interest.times(cut).dividedBy(share.principal, MONEY_SCALE);
  });
}

export type InstallmentCutError =
  | 'INSTALLMENT_CUT_INVALID'
  | 'INSTALLMENT_CUT_TOO_LARGE'
  | 'INSTALLMENT_CUT_OVER_AMOUNT';

/**
 * 사용자가 정한 줄일 원금이 쓸 수 있는 값인지. 맞으면 null.
 *
 *   - 개월수만큼이고 0 이상이어야 한다.
 *   - 회차마다 남은 원금을 넘지 못한다 (다른 환불이 이미 줄인 것을 뺀 값).
 *   - 합이 환불 금액을 넘지 못한다 -- 줄인 회차만큼 돈을 돌려받은 것이라, 넘으면 받지 않은
 *     돈으로 카드 빚을 줄이게 된다.
 */
export function checkInstallmentCut(
  effective: readonly InstallmentLineShare[],
  principalCut: readonly DecInput[],
  amount: DecInput,
): InstallmentCutError | null {
  if (principalCut.length !== effective.length) return 'INSTALLMENT_CUT_INVALID';
  const values: Dec[] = [];
  for (const value of principalCut) {
    let parsed: Dec;
    try {
      parsed = Dec.of(value);
    } catch {
      return 'INSTALLMENT_CUT_INVALID';
    }
    if (parsed.isNegative()) return 'INSTALLMENT_CUT_INVALID';
    values.push(parsed);
  }
  if (values.some((value, index) => value.gt(maxDec(effective[index].principal, Dec.of(0))))) {
    return 'INSTALLMENT_CUT_TOO_LARGE';
  }
  if (sum(values).gt(Dec.of(amount))) return 'INSTALLMENT_CUT_OVER_AMOUNT';
  return null;
}

/** 환불 전표의 다리 금액 = 돌려받은 돈 + 함께 사라진 이자. */
export function installmentRefundLegAmount(amount: DecInput, adjust: InstallmentAdjust | null): Dec {
  if (!adjust) return Dec.of(amount);
  return Dec.of(amount).plus(adjustTotals(adjust).interest);
}

/**
 * 회차 기준에서 환불 전표가 그 달에 세는 몫 (양수). 남은 회차로 다 줄이지 못한 돈이다.
 *
 * 다리 금액(돌려받은 돈 + 사라진 이자)에서 회차마다 줄인 것(원금 + 이자)을 뺀 값이라,
 * 결국 `돌려받은 돈 − 줄인 원금` 이다.
 */
export function refundLump(legAmount: DecInput, adjust: InstallmentAdjust | null): Dec {
  const leg = Dec.of(legAmount).abs();
  if (!adjust) return leg;
  return maxDec(leg.minus(adjustTotals(adjust).total), Dec.of(0));
}

function sum(values: readonly DecInput[]): Dec {
  return values.reduce<Dec>((acc, value) => acc.plus(Dec.of(value)), Dec.of(0));
}

function maxDec(a: Dec, b: Dec): Dec {
  return a.gt(b) ? a : b;
}

function minDec(a: Dec, b: Dec): Dec {
  return a.lt(b) ? a : b;
}

/**
 * 분석 행 하나를 회차 기준으로 고친다 (서버 리포트·예산과 기기 사본이 함께 쓴다).
 *
 *   - **할부 환불**(`adjust` 가 있다): 남은 회차로 다 줄이지 못한 몫만, 환불한 날에 센다.
 *     줄인 회차는 원거래의 회차 몫에서 빠진다.
 *   - 그 밖에는 그대로다.
 *
 * 다리는 지출 분류를 음수로 쓰는 환불 다리다. 부호를 지킨다.
 */
export function installmentRefundRow<T extends { baseAmount: DecInput; date: Date | string }>(
  row: T,
  adjust: InstallmentAdjust | null,
  ownDate: Date | string,
): T {
  if (!adjust) return row;
  const lump = refundLump(row.baseAmount, adjust);
  return {
    ...row,
    baseAmount: Dec.of(row.baseAmount).isNegative() ? lump.negated() : lump,
    date: ownDate,
  };
}

/** 원거래 한 줄에 걸린 환불들이 회차마다 줄인 금액의 합 (원금 + 이자). 없으면 null. */
export function lineCutsOf(
  cuts: ReadonlyArray<{ lineKey: string | null; adjust: InstallmentAdjust | null }>,
  lineKey: string | null,
  months: number,
): string[] | null {
  const mine = cuts
    .filter((cut) => cut.adjust && (lineKey === null || cut.lineKey === lineKey))
    .map((cut) => cut.adjust!);
  if (mine.length === 0) return null;
  return sumInstallmentAdjusts(mine, months).total.map((value) => value.toString());
}

/**
 * 원거래를 고칠 때 걸린 할부 환불과 어긋나지 않는지 (서버 원장과 기기 창구가 함께 쓴다).
 *
 * 회차를 줄인 환불이 있으면 원거래의 할부 개월수와 카드를 바꿀 수 없고, 회차마다 남는
 * 금액이 음수가 되게 줄일 수도 없다 -- 줄인 금액이 가리키는 회차가 뜻을 잃는다. 줄인 것이
 * 없는 환불(모두 0)은 막지 않는다. 맞으면 null.
 */
export function checkInstallmentRefunds(input: {
  /** 고친 뒤의 할부. 할부가 아니게 고쳤으면 null. */
  plan: {
    months: number;
    cardId: string | null;
    entryAmount: DecInput;
    principals: readonly DecInput[] | null;
    interests: readonly DecInput[] | null;
  } | null;
  /** 고친 뒤의 줄. 금액은 양수다. */
  lines: ReadonlyArray<{ lineKey: string; amount: DecInput }>;
  /** 걸린 환불. 줄이 사라졌으면 rebind 가 옮긴 뒤의 줄을 준다. */
  refunds: ReadonlyArray<{ lineKey: string | null; cardId: string | null; adjust: InstallmentAdjust | null }>;
}): 'INSTALLMENT_REFUND_LOCKED' | null {
  const active = input.refunds.filter(
    (refund) => refund.adjust && !adjustTotals(refund.adjust).total.isZero(),
  );
  if (active.length === 0) return null;

  const plan = input.plan;
  if (!plan || plan.months < 2) return 'INSTALLMENT_REFUND_LOCKED';
  if (active.some((refund) => refund.adjust!.principal.length !== plan.months)) {
    return 'INSTALLMENT_REFUND_LOCKED';
  }
  if (active.some((refund) => refund.cardId !== plan.cardId)) return 'INSTALLMENT_REFUND_LOCKED';

  const lineKeys = input.lines.length === 1 ? null : new Set(input.lines.map((line) => line.lineKey));
  for (const line of input.lines) {
    const mine = active
      .filter((refund) => lineKeys === null || refund.lineKey === line.lineKey)
      .map((refund) => refund.adjust!);
    if (mine.length === 0) continue;
    const effective = effectiveLineSchedule(
      installmentLineSchedule({
        entryAmount: plan.entryAmount,
        lineAmount: line.amount,
        months: plan.months,
        principals: plan.principals,
        interests: plan.interests,
      }),
      mine,
    );
    if (effective.some((share) => share.principal.isNegative() || share.interest.isNegative())) {
      return 'INSTALLMENT_REFUND_LOCKED';
    }
  }
  return null;
}
