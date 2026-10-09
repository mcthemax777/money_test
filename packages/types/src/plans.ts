/**
 * 이용권. 사람이 아니라 프로젝트(가계부)에 붙고, 그 가계부의 멤버가 함께 쓴다.
 *
 * 서버와 화면이 함께 본다. 서버는 이 표로 기간을 계산해 권한 표(`ProjectPlanGrant`)에 적고,
 * 화면은 같은 표로 값을 보여 준다. 값이 두 곳에 따로 있으면 화면에 적힌 값과 실제로
 * 주는 기간이 어긋난다.
 *
 * 금액은 원 단위 정수다 -- 스토어와 PG 모두 원화를 소수 없이 받는다.
 */

export const PLAN_IDS = ['lifetime', 'month1', 'month3', 'month6', 'month12'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface PlanDef {
  id: PlanId;
  /** 한 번 결제로 쓰는 개월 수. 평생 이용권은 null 이다. */
  months: number | null;
  /** 원. */
  price: number;
  /** 오픈 기념으로만 파는 것. 화면이 표시를 달고 맨 위에 세운다. */
  launchOnly: boolean;
}

export const PLAN_CURRENCY = 'KRW';

/** 1개월 값. 긴 기간의 할인율을 이 값에 견준다. */
export const MONTHLY_PLAN_PRICE = 2900;

/** 화면에 서는 차례. 오픈 기념이 맨 위다 (2026-10-09 사용자 결정 가격). */
export const PLANS: readonly PlanDef[] = [
  { id: 'lifetime', months: null, price: 3900, launchOnly: true },
  { id: 'month1', months: 1, price: MONTHLY_PLAN_PRICE, launchOnly: false },
  { id: 'month3', months: 3, price: 5900, launchOnly: false },
  { id: 'month6', months: 6, price: 9900, launchOnly: false },
  { id: 'month12', months: 12, price: 14900, launchOnly: false },
];

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value);
}

export function planOf(id: PlanId): PlanDef {
  const plan = PLANS.find((candidate) => candidate.id === id);
  // PlanId 는 PLANS 와 같은 목록에서 나오므로 여기 올 수 없다. 오면 표를 고친 사람이 빠뜨린 것이다.
  if (!plan) throw new Error(`이용권 표에 없는 id: ${id}`);
  return plan;
}

/**
 * 권한이 어디서 왔는가.
 *
 * - `admin`: 관리 도구에서 손으로 준 것 (보상·시험)
 * - `google_play`: 앱 스토어 결제. 기간은 스토어가 정한다.
 * - `web`: 웹 PG 결제. 기간은 서버가 이어 붙여 계산한다.
 */
export const PLAN_GRANT_SOURCES = ['admin', 'google_play', 'web'] as const;
export type PlanGrantSource = (typeof PLAN_GRANT_SOURCES)[number];

export function isPlanGrantSource(value: unknown): value is PlanGrantSource {
  return typeof value === 'string' && (PLAN_GRANT_SOURCES as readonly string[]).includes(value);
}

/**
 * 프로젝트의 지금 이용권. 프로젝트 목록(GET /projects)에 붙어 온다.
 *
 * - `free`: 유효한 권한이 없다.
 * - `period`: 기간제가 `endsAt`(ISO)까지 유효하다. 여러 장을 이어 샀으면 가장 늦은 끝이다.
 * - `lifetime`: 평생. 기간제가 함께 있어도 평생이 이긴다.
 */
export type ProjectPlanStatus =
  | { kind: 'free'; endsAt: null }
  | { kind: 'period'; endsAt: string }
  | { kind: 'lifetime'; endsAt: null };

export const FREE_PLAN_STATUS: ProjectPlanStatus = { kind: 'free', endsAt: null };

/** 지금 상태를 계산하는 데 필요한 권한 한 줄의 모양. */
export interface PlanGrantWindow {
  startsAt: Date;
  /** null 이면 평생이다. */
  endsAt: Date | null;
  revokedAt: Date | null;
}

/**
 * 권한 줄들에서 지금 이용권을 낸다.
 *
 * 취소된 줄, 아직 시작하지 않은 줄(이어 산 다음 장), 끝난 줄은 지금 유효하지 않다.
 * 단, 이어 산 장은 지금 장의 끝에서 시작하므로 "끝"으로는 그 장의 끝을 보여 준다 --
 * 사용자는 언제까지 쓸 수 있는가를 알고 싶어 한다.
 */
export function planStatusOf(grants: readonly PlanGrantWindow[], now: Date): ProjectPlanStatus {
  const live = grants.filter((grant) => grant.revokedAt === null);
  const current = live.filter(
    (grant) => grant.startsAt <= now && (grant.endsAt === null || grant.endsAt > now),
  );
  if (current.length === 0) return FREE_PLAN_STATUS;
  if (current.some((grant) => grant.endsAt === null)) return { kind: 'lifetime', endsAt: null };

  return { kind: 'period', endsAt: chainEndOf(live, now).toISOString() };
}

/**
 * 지금부터 끊김 없이 이어지는 기간제 권한의 끝. 없으면 now 다.
 *
 * 다음 장을 살 때 시작점이 되고, 지금 상태의 "언제까지"가 된다. 사이가 비어 있으면
 * 거기서 멈춘다 -- 빈 날은 쓸 수 없는 날이다.
 */
export function chainEndOf(grants: readonly PlanGrantWindow[], now: Date): Date {
  const periods = grants
    .filter((grant) => grant.revokedAt === null && grant.endsAt !== null)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  let end = now;
  for (const grant of periods) {
    if (grant.startsAt > end) break;
    if (grant.endsAt! > end) end = grant.endsAt!;
  }
  return end;
}

/**
 * UTC 달력으로 개월을 더한다. 없는 날은 그 달 마지막 날로 내린다 (1월 31일 + 1개월 = 2월 28일).
 *
 * 내리지 않으면 Date 가 넘친 날만큼 다음 달로 굴려 3월 3일이 되고, 한 달 산 사람이 사흘을 더 쓴다.
 */
export function addPlanMonths(from: Date, months: number): Date {
  const result = new Date(from.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/** 관리 도구가 보는 권한 한 줄. */
export interface PlanGrantDto {
  id: string;
  projectId: string | null;
  userId: string | null;
  plan: PlanId;
  source: PlanGrantSource;
  externalId: string | null;
  amount: number;
  currency: string;
  startsAt: string;
  endsAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  note: string | null;
  createdAt: string;
}

/** 관리 도구의 프로젝트 찾기 한 줄. */
export interface AdminPlanProjectDto {
  id: string;
  name: string;
  projectKey: string | null;
  createdAt: string;
  /** 소유자 이메일. 소유자가 없는 프로젝트(정상 경로는 아니다)면 null. */
  ownerEmail: string | null;
  plan: ProjectPlanStatus;
}

/** 관리 도구의 한 프로젝트 이용권: 지금 상태와 권한 줄 전부(거둔 줄 포함). */
export interface AdminProjectPlanDto {
  status: ProjectPlanStatus;
  grants: PlanGrantDto[];
}
