/**
 * 회차 기준으로 셀 때 질의가 해야 하는 일.
 *
 * 나누는 규칙 자체는 `@money/types` 의 `expandInstallmentRows` 가 갖는다. 여기 있는 것은
 * **무엇을 읽어 올지**다 -- 앞에서 산 할부를 창 밖에서 따로 읽고, 편 뒤에 창 밖으로
 * 나간 회차를 버린다. 그 차례가 틀리면 지난달에 산 할부의 이번 달 회차가 통째로
 * 빠지거나, 산 달의 전액과 회차가 함께 세어진다.
 *
 * 리포트와 예산이 함께 쓴다. 두 벌로 두면 같은 화면의 "8월 지출 24만"과 "예산 사용
 * 21만"이 서로 다른 규칙으로 세어진다.
 */
import { Prisma } from '@prisma/client';
import {
  type CategoryPostingRow,
  type EntryBasis,
  type InstallmentRowPlan,
  expandInstallmentRows,
} from '@money/types';

/** 할부가 걸린 전표만. 카드 다리에 계획이 붙어 있다. */
export const HAS_INSTALLMENT = {
  postings: { some: { installmentPlan: { isNot: null } } },
} satisfies Prisma.JournalEntryWhereInput;

/**
 * 할부를 앞으로 넓혀 읽을 달 수.
 *
 * 창의 시작보다 이만큼 앞에서 산 할부까지 본다. 실제로 쓰이는 개월수는 길어야 서른여섯
 * 이라 넉넉하고, 창을 열어 두면(조건을 아예 지우면) 원장을 통째로 읽게 된다.
 */
export const INSTALLMENT_LOOKBACK_MONTHS = 60;

/**
 * 전표에 실어 올 카드 다리. 할부가 걸린 것만 고른다.
 *
 * 발생 기준에서는 쓰이지 않지만 조건을 나누면 select 가 두 벌이 되어, 늘 싣고 읽는
 * 쪽에서 가린다.
 */
export const INSTALLMENT_LEG_SELECT = {
  where: { installmentPlan: { isNot: null } },
  select: {
    amount: true,
    baseAmount: true,
    installmentPlan: {
      select: { totalMonths: true, principalShares: true, interestShares: true },
    },
  },
} as const;

/** 조건 하나를 AND 로 얹는다. 이미 있는 AND 를 덮지 않는다. */
export function andScope(
  scope: Prisma.JournalEntryWhereInput,
  extra: Prisma.JournalEntryWhereInput,
): Prisma.JournalEntryWhereInput {
  const existing = scope.AND;
  const list = Array.isArray(existing) ? existing : existing ? [existing] : [];
  return { ...scope, AND: [...list, extra] };
}

/**
 * 날짜 창을 앞으로 넓힌다. 뒤끝은 그대로다.
 *
 * 앞에서 산 할부의 회차가 이번 창에 서기 때문이다. 창이 없으면(전체 기간) 넓힐 것도
 * 없다.
 */
export function widenScope(scope: Prisma.JournalEntryWhereInput): Prisma.JournalEntryWhereInput {
  const date = scope.date;
  if (!date || typeof date !== 'object' || date instanceof Date) return scope;

  const gte = (date as { gte?: Date }).gte;
  if (!gte) return scope;

  const from = new Date(gte.getTime());
  from.setUTCMonth(from.getUTCMonth() - INSTALLMENT_LOOKBACK_MONTHS);
  return { ...scope, date: { ...(date as object), gte: from } };
}

/**
 * 회차 기준의 전표 조건. 할부만 창을 앞으로 넓혀 읽는다.
 *
 * 두 벌로 나누는 것이 요점이다. 넓힌 창을 통째로 쓰면 예순 달치 일시불이 함께 들어온다.
 */
export function installmentScope(
  scope: Prisma.JournalEntryWhereInput,
): Prisma.JournalEntryWhereInput {
  return {
    OR: [andScope(scope, { NOT: HAS_INSTALLMENT }), { ...widenScope(scope), ...HAS_INSTALLMENT }],
  };
}

/** 전표에 실려 온 카드 다리. 할부가 걸린 것만 온다. */
export type InstallmentLeg = {
  amount: Prisma.Decimal;
  baseAmount: Prisma.Decimal;
  installmentPlan: {
    totalMonths: number;
    principalShares: Prisma.JsonValue;
    interestShares: Prisma.JsonValue;
  } | null;
};

/** 회차 기준으로 펼 때 함께 다니는 것. */
export interface InstallmentSpread {
  timeZone: string;
  /** 펴고 난 뒤 남길 구간. 없으면 전부 남긴다. */
  window: { gte?: Date; lt?: Date } | null;
}

/**
 * 회차 기준일 때 펴는 데 필요한 것. 발생 기준이면 undefined 다.
 *
 * 한 자리에 모아 두는 까닭은 부르는 쪽마다 "회차 기준인가"를 다시 묻지 않게 하려는
 * 것이다 -- 값이 있으면 펴고, 없으면 지금까지대로 센다.
 */
export function spreadOf(
  basis: EntryBasis,
  timeZone: string,
  window: { gte?: Date; lt?: Date } | null,
): InstallmentSpread | undefined {
  return basis === 'installment' ? { timeZone, window } : undefined;
}

/**
 * 할부를 회차대로 펴고 **창 밖으로 나간 회차를 버린다.**
 *
 * 버리는 일이 요점이다. 지난달에 산 3개월 할부는 이번 달 창에도 걸려 들어오는데
 * (앞 달까지 넓혀 읽기 때문이다), 그 거래의 1회차는 지난달에 서야 할 줄이다.
 */
export function spreadRows<T extends CategoryPostingRow>(
  rows: T[],
  spread: InstallmentSpread,
): T[] {
  const spreadRows = expandInstallmentRows(rows, spread.timeZone);
  const { window } = spread;
  if (!window) return spreadRows;

  return spreadRows.filter((row) => {
    const at = row.date instanceof Date ? row.date : new Date(row.date);
    if (window.gte && at.getTime() < window.gte.getTime()) return false;
    if (window.lt && at.getTime() >= window.lt.getTime()) return false;
    return true;
  });
}

/**
 * 집계 줄에 실을 할부 계획. 할부가 아니면 undefined.
 *
 * 회차 금액을 **비율로만** 쓴다. 그래서 카드 통화가 기준통화와 달라도 원금은 제대로
 * 나뉜다 -- 줄 금액(기준통화)을 그 비율로 자르기 때문이다. 이자는 금액 그대로 더하는
 * 값이라 통화가 갈리면 싣지 않는다. 환산할 그때의 환율이 계획에 없다.
 */
export function installmentPlanOf(legs?: InstallmentLeg[]): InstallmentRowPlan | undefined {
  const leg = legs?.find((posting) => posting.installmentPlan);
  const plan = leg?.installmentPlan;
  if (!leg || !plan || plan.totalMonths < 2) return undefined;

  const sameCurrency = leg.amount.equals(leg.baseAmount);
  return {
    months: plan.totalMonths,
    total: leg.baseAmount.abs().toString(),
    principals: toShareList(plan.principalShares),
    interests: sameCurrency ? toShareList(plan.interestShares) : null,
  };
}

/** JSON 칸을 문자열 배열로 가린다. 모양이 아니면 없는 것으로 본다. */
function toShareList(value: Prisma.JsonValue): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.map((share) => String(share));
}
