'use client';

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { track } from '@money/core/lib/analytics';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency } from '@money/core/lib/money';
import { discountPercent, perMonthPrice, PLAN_LABEL_KEY } from '@money/core/lib/plans';
import type { Project } from '@money/core/store/project';
import { PLAN_CURRENCY, PLANS, planStatusAt, type PlanId } from '@money/types';

import Modal from '@/components/Modal';

/**
 * 프로젝트 이용권 고르기. 앱의 PlanModal 과 같은 모양이다.
 *
 * 결제는 앱(Google Play)에만 있다. 웹의 결제 단추는 앱에서 하라고 알린다. 이용권은 프로젝트에 붙으므로
 * 결제는 소유자만 한다 -- 다른 멤버는 값을 볼 수 있지만 단추가 잠긴다. 평생 이용권이 있는
 * 프로젝트도 잠근다(더 살 것이 없다). 기간제를 쓰는 중이면 이어 붙는다는 것을 알린다.
 */
export default function PlanModal({
  project,
  onClose,
}: {
  /** 이용권을 볼 프로젝트. null 이면 닫혀 있다. */
  project: Project | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<PlanId>(PLANS[0].id);
  const [notice, setNotice] = useState('');

  /* 다시 열면 맨 위(오픈 기념)부터 고른 채로 시작한다. 지난번 안내 문구도 지운다. */
  const projectId = project?.id ?? null;
  useEffect(() => {
    if (projectId === null) return;
    setSelected(PLANS[0].id);
    setNotice('');
    track({ name: 'paywall_view', params: { plan_status: planStatusAt(project?.plan).kind } });
    // 연 순간에 한 번만 센다 (앱과 같다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const isOwner = project?.role === 'owner';
  const planKind = planStatusAt(project?.plan).kind;
  const canBuy = isOwner && planKind !== 'lifetime';
  const plan = PLANS.find((candidate) => candidate.id === selected) ?? PLANS[0];

  return (
    <Modal
      isOpen={project !== null}
      onClose={onClose}
      title={t('plan.title', { project: project?.name ?? '' })}
      footer={
        <div className="space-y-2">
          {planKind === 'lifetime' ? (
            <p className="text-xs text-gray-500">{t('plan.alreadyLifetime')}</p>
          ) : !isOwner ? (
            <p className="text-xs text-gray-500">{t('plan.ownerOnly')}</p>
          ) : planKind === 'period' ? (
            <p className="text-xs text-gray-500">{t('plan.extendHint')}</p>
          ) : null}
          {notice ? <p className="text-xs text-orange-600">{notice}</p> : null}
          <button
            onClick={() => setNotice(t('plan.appOnly'))}
            disabled={!canBuy}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {t('plan.buy', { price: formatCurrency(plan.price, PLAN_CURRENCY) })}
          </button>
          <p className="text-[11px] leading-4 text-gray-400">{t('plan.autoRenewNote')}</p>
        </div>
      }
    >
      <p className="mb-4 text-sm text-gray-600">{t('plan.lead')}</p>
      <div className="space-y-2" role="radiogroup">
        {PLANS.map((candidate) => {
          const active = candidate.id === selected;
          const perMonth = perMonthPrice(candidate);
          const discount = discountPercent(candidate);
          return (
            <button
              key={candidate.id}
              role="radio"
              aria-checked={active}
              onClick={() => {
                setSelected(candidate.id);
                setNotice('');
              }}
              className={`flex w-full items-center gap-3 rounded-lg border-2 px-4 py-3 text-left transition-colors ${
                active ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                  active ? 'border-blue-600 bg-blue-600' : 'border-gray-300'
                }`}
              >
                {active ? <Check className="h-3 w-3 text-white" aria-hidden /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900">{t(PLAN_LABEL_KEY[candidate.id])}</span>
                  {candidate.launchOnly ? (
                    <span className="rounded bg-rose-100 px-1.5 py-0.5 text-xs font-medium text-rose-600">
                      {t('plan.launchBadge')}
                    </span>
                  ) : null}
                  {discount !== null ? (
                    <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700">
                      {t('plan.discount', { percent: discount })}
                    </span>
                  ) : null}
                </span>
                {candidate.months === null ? (
                  <span className="mt-0.5 block text-xs text-gray-500">{t('plan.lifetimeHint')}</span>
                ) : perMonth !== null ? (
                  <span className="mt-0.5 block text-xs text-gray-500">
                    {t('plan.perMonth', { price: formatCurrency(perMonth, PLAN_CURRENCY) })}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 font-semibold text-gray-900">
                {formatCurrency(candidate.price, PLAN_CURRENCY)}
              </span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
