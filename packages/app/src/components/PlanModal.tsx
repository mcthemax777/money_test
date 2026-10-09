import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';

import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency } from '@money/core/lib/money';
import { discountPercent, perMonthPrice, PLAN_LABEL_KEY } from '@money/core/lib/plans';
import type { Project } from '@money/core/store/project';
import { PLAN_CURRENCY, PLANS, type PlanId } from '@money/types';

import Modal from './Modal';

/**
 * 프로젝트 이용권 고르기. 웹의 PlanModal 과 같은 모양이다.
 *
 * 아직 결제가 붙지 않아 결제 단추는 "준비 중"을 알리기만 한다. 이용권은 프로젝트에 붙으므로
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
  }, [projectId]);

  const isOwner = project?.role === 'owner';
  const planKind = project?.plan?.kind ?? 'free';
  const canBuy = isOwner && planKind !== 'lifetime';
  const plan = PLANS.find((candidate) => candidate.id === selected) ?? PLANS[0];

  return (
    <Modal
      isOpen={project !== null}
      onClose={onClose}
      title={t('plan.title', { project: project?.name ?? '' })}
      footer={
        <View className="gap-2">
          {planKind === 'lifetime' ? (
            <Text className="text-xs text-gray-500">{t('plan.alreadyLifetime')}</Text>
          ) : !isOwner ? (
            <Text className="text-xs text-gray-500">{t('plan.ownerOnly')}</Text>
          ) : planKind === 'period' ? (
            <Text className="text-xs text-gray-500">{t('plan.extendHint')}</Text>
          ) : null}
          {notice ? <Text className="text-xs text-orange-600">{notice}</Text> : null}
          <Pressable
            onPress={() => setNotice(t('plan.notReady'))}
            disabled={!canBuy}
            accessibilityRole="button"
            className={`items-center rounded-lg bg-blue-600 px-4 py-3 active:bg-blue-700 ${
              canBuy ? '' : 'opacity-50'
            }`}
          >
            <Text className="font-semibold text-white">
              {t('plan.buy', { price: formatCurrency(plan.price, PLAN_CURRENCY) })}
            </Text>
          </Pressable>
        </View>
      }
    >
      <Text className="mb-4 text-sm text-gray-600">{t('plan.lead')}</Text>
      <View className="gap-2" accessibilityRole="radiogroup">
        {PLANS.map((candidate) => {
          const active = candidate.id === selected;
          const perMonth = perMonthPrice(candidate);
          const discount = discountPercent(candidate);
          return (
            <Pressable
              key={candidate.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              onPress={() => {
                setSelected(candidate.id);
                setNotice('');
              }}
              className={`flex-row items-center gap-3 rounded-lg border-2 px-4 py-3 ${
                active ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white active:bg-gray-50'
              }`}
            >
              <View
                className={`h-5 w-5 items-center justify-center rounded-full border-2 ${
                  active ? 'border-blue-600 bg-blue-600' : 'border-gray-300'
                }`}
              >
                {active ? <Check size={12} color="#ffffff" strokeWidth={3} /> : null}
              </View>
              <View className="min-w-0 flex-1">
                <View className="flex-row flex-wrap items-center gap-2">
                  <Text className="font-semibold text-gray-900">
                    {t(PLAN_LABEL_KEY[candidate.id])}
                  </Text>
                  {candidate.launchOnly ? (
                    <Text className="rounded bg-rose-100 px-1.5 py-0.5 text-xs font-medium text-rose-600">
                      {t('plan.launchBadge')}
                    </Text>
                  ) : null}
                  {discount !== null ? (
                    <Text className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700">
                      {t('plan.discount', { percent: discount })}
                    </Text>
                  ) : null}
                </View>
                {candidate.months === null ? (
                  <Text className="mt-0.5 text-xs text-gray-500">{t('plan.lifetimeHint')}</Text>
                ) : perMonth !== null ? (
                  <Text className="mt-0.5 text-xs text-gray-500">
                    {t('plan.perMonth', { price: formatCurrency(perMonth, PLAN_CURRENCY) })}
                  </Text>
                ) : null}
              </View>
              <Text className="font-semibold text-gray-900">
                {formatCurrency(candidate.price, PLAN_CURRENCY)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Modal>
  );
}
