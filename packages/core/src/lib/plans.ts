/**
 * 이용권 화면이 쓰는 것. 가격표 자체는 서버와 함께 보는 `@money/types` 의 plans 에 있다.
 */
import {
  MONTHLY_PLAN_PRICE,
  planStatusAt,
  type PlanDef,
  type PlanId,
  type ProjectPlanStatus,
} from '@money/types';

import type { MessageKey } from './i18n';

/** 이용권 이름의 사전 열쇠. */
export const PLAN_LABEL_KEY: Record<PlanId, MessageKey> = {
  lifetime: 'plan.lifetime',
  month1: 'plan.month1',
  month3: 'plan.month3',
  month6: 'plan.month6',
  month12: 'plan.month12',
};

/** 한 달에 드는 값(원, 반올림). 1개월짜리와 평생 이용권은 견줄 것이 없어 null 이다. */
export function perMonthPrice(plan: PlanDef): number | null {
  if (plan.months === null || plan.months <= 1) return null;
  return Math.round(plan.price / plan.months);
}

/**
 * 1개월을 그 기간만큼 산 값에 견준 할인율(%, 내림).
 *
 * 내림인 까닭: 올리면 실제보다 큰 할인을 내세우게 된다. 할인이 없으면 null 이다.
 */
export function discountPercent(plan: PlanDef): number | null {
  if (plan.months === null || plan.months <= 1) return null;
  const full = MONTHLY_PLAN_PRICE * plan.months;
  const percent = Math.floor(((full - plan.price) / full) * 100);
  return percent > 0 ? percent : null;
}

/**
 * 프로젝트 카드에 적는 지금 이용권. "무료" / "평생" / "2027. 1. 9.까지".
 *
 * `plan` 이 없거나(옛 서버, 저장해 둔 목록) 기간이 지났으면 무료로 적는다.
 */
export function planStatusLabel(
  status: ProjectPlanStatus | undefined,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
  localeTag: string,
): string {
  const current = planStatusAt(status);
  if (current.kind === 'free') return t('projects.planFree');
  if (current.kind === 'lifetime') return t('projects.planLifetime');
  return t('projects.planUntil', { date: new Date(current.endsAt).toLocaleDateString(localeTag) });
}
