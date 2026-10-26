import { useEffect, useState } from 'react';
import { legalUrl } from '@money/core/lib/legal';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';

import { track } from '@money/core/lib/analytics';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency } from '@money/core/lib/money';
import { discountPercent, perMonthPrice, PLAN_LABEL_KEY } from '@money/core/lib/plans';
import { useAuth } from '@money/core/store/auth';
import { useConnectivity } from '@money/core/store/connectivity';
import { useProject, type Project } from '@money/core/store/project';
import { PLAN_CURRENCY, PLANS, planStatusAt, type PlanId } from '@money/types';

import { isBillingConfigured, loadStorePrices, openSubscriptionManagement, purchasePlan } from '../billing';
import Modal from './Modal';

/** 결제 뒤 서버(웹훅)가 이용권을 적었는지 이만큼 간격으로 몇 번 묻는다. */
const CONFIRM_TRIES = 6;
const CONFIRM_INTERVAL_MS = 2000;

type Notice = { tone: 'info' | 'ok' | 'error'; text: string; showManage?: boolean };

/**
 * 프로젝트 이용권 고르기와 결제. 웹의 PlanModal 과 같은 모양이고, 결제는 앱에만 있다.
 *
 * 이용권은 프로젝트에 붙으므로 결제는 소유자만 한다 -- 다른 멤버는 값을 볼 수 있지만 단추가
 * 잠긴다. 평생 이용권이 있는 프로젝트도 잠근다(더 살 것이 없다). 구독 중이면 기간 바꾸기와
 * 해지는 Play 스토어 구독 관리에서 한다고 알린다.
 *
 * 결제가 끝나면 이용권을 앱이 켜지 않는다. 서버가 웹훅을 받아 적을 때까지 프로젝트 목록을
 * 몇 번 다시 받아 보고, 그 사이 반영되지 않으면 "잠시 걸릴 수 있다"고 알린다.
 */
export default function PlanModal({
  project,
  onClose,
  onReload,
}: {
  /** 이용권을 볼 프로젝트. null 이면 닫혀 있다. 열린 동안의 값은 스토어에서 새로 읽는다. */
  project: Project | null;
  onClose: () => void;
  /** 프로젝트 목록을 서버에서 다시 받는다. 결제가 반영됐는지 볼 때 쓴다. */
  onReload: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const userId = useAuth((state) => state.user?.id ?? null);
  const isOffline = useConnectivity((state) => state.isOffline);
  /* 결제 뒤 목록을 다시 받으면 이용권이 바뀐다. 연 순간의 값이 아니라 스토어의 지금 값을 본다. */
  const live = useProject((state) => state.projects.find((item) => item.id === project?.id));
  const current = live ?? project;

  const [selected, setSelected] = useState<PlanId>(PLANS[0].id);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [isBuying, setIsBuying] = useState(false);
  /** 스토어가 정한 가격 글자. 받기 전이나 받지 못하면 코드의 가격으로 그린다 (`priceText`). */
  const [storePrices, setStorePrices] = useState<Partial<Record<PlanId, string>>>({});

  /* 다시 열면 맨 위(오픈 기념)부터 고른 채로 시작한다. 지난번 안내 문구도 지운다. */
  const projectId = project?.id ?? null;
  useEffect(() => {
    if (projectId === null) return;
    let cancelled = false;
    void loadStorePrices().then((prices) => {
      if (!cancelled) setStorePrices(prices);
    });
    setSelected(PLANS[0].id);
    setNotice(null);
    track({ name: 'paywall_view', params: { plan_status: planStatusAt(project?.plan).kind } });
    // 연 순간에 한 번만 센다. 결제 뒤 이용권이 바뀌어도 다시 세지 않는다.
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  /** 화면에 적을 가격. 스토어의 글자가 있으면 그것, 없으면 코드의 가격이다. */
  const priceText = (candidate: (typeof PLANS)[number]) =>
    storePrices[candidate.id] ?? formatCurrency(candidate.price, PLAN_CURRENCY);

  const isOwner = current?.role === 'owner';
  const planKind = planStatusAt(current?.plan).kind;
  const canBuy = isOwner && planKind !== 'lifetime' && !isBuying;
  const plan = PLANS.find((candidate) => candidate.id === selected) ?? PLANS[0];

  /** 서버가 이용권을 적었는가. 목록을 다시 받아 결제 전과 견준다. */
  const waitForServer = async (id: string, before: string): Promise<boolean> => {
    for (let attempt = 0; attempt < CONFIRM_TRIES; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, CONFIRM_INTERVAL_MS));
      await onReload().catch(() => undefined);
      const after = useProject.getState().projects.find((item) => item.id === id)?.plan;
      if (JSON.stringify(after ?? null) !== before) return true;
    }
    return false;
  };

  const buy = async () => {
    if (!current) return;
    if (!isBillingConfigured) {
      setNotice({ tone: 'info', text: t('plan.notReady') });
      return;
    }
    if (isOffline) {
      setNotice({ tone: 'info', text: t('plan.offline') });
      return;
    }

    setIsBuying(true);
    setNotice(null);
    const before = JSON.stringify(current.plan ?? null);
    // 결제 창이 떠 있는 동안 고른 것이 바뀌어도 결과는 시작한 이용권으로 센다.
    const planId = selected;
    track({ name: 'plan_purchase_start', params: { plan: planId } });
    try {
      const outcome = await purchasePlan({ projectId: current.id, plan: planId, userId });
      if (outcome !== 'purchased') {
        track({ name: 'plan_purchase_result', params: { plan: planId, outcome, applied: 0 } });
      }
      if (outcome === 'cancelled') return;
      if (outcome === 'product-missing') {
        setNotice({ tone: 'error', text: t('plan.productMissing') });
        return;
      }
      if (outcome === 'already-subscribed') {
        /*
         * Play 는 한 구글 계정에 같은 구독을 하나만 둔다. 이 가계부가 무료인데 "이미 구독 중"이면 그 구독은
         * 다른 가계부의 것이다 -- 예전에는 "이미 구독 중"만 보여, 왜 이 가계부는 무료인지 알 수 없었다.
         */
        const elsewhere = planStatusAt(current.plan).kind === 'free';
        setNotice({
          tone: 'info',
          text: t(elsewhere ? 'plan.subscribedElsewhere' : 'plan.alreadySubscribed'),
          showManage: true,
        });
        return;
      }
      if (outcome === 'payment-pending') {
        setNotice({ tone: 'info', text: t('plan.paymentPending') });
        return;
      }
      if (outcome === 'subscription-active') {
        setNotice({ tone: 'info', text: t('plan.cancelSubscriptionFirst'), showManage: true });
        return;
      }
      const applied = await waitForServer(current.id, before);
      track({ name: 'plan_purchase_result', params: { plan: planId, outcome, applied: applied ? 1 : 0 } });
      setNotice({ tone: 'ok', text: t(applied ? 'plan.purchased' : 'plan.purchasedPending') });
    } catch {
      track({ name: 'plan_purchase_result', params: { plan: planId, outcome: 'failed', applied: 0 } });
      setNotice({ tone: 'error', text: t('plan.purchaseFailed') });
    } finally {
      setIsBuying(false);
    }
  };

  const noticeColor =
    notice?.tone === 'ok' ? 'text-green-700' : notice?.tone === 'error' ? 'text-red-600' : 'text-orange-600';
  const showManage = planKind === 'period' || notice?.showManage;

  return (
    <Modal
      isOpen={project !== null}
      onClose={onClose}
      title={t('plan.title', { project: current?.name ?? '' })}
      footer={
        <View className="gap-2">
          {planKind === 'lifetime' ? (
            <Text className="text-xs text-gray-500">{t('plan.alreadyLifetime')}</Text>
          ) : !isOwner ? (
            <Text className="text-xs text-gray-500">{t('plan.ownerOnly')}</Text>
          ) : planKind === 'period' ? (
            <Text className="text-xs text-gray-500">{t('plan.extendHint')}</Text>
          ) : null}
          {notice ? <Text className={`text-xs ${noticeColor}`}>{notice.text}</Text> : null}
          {showManage && isOwner ? (
            <Pressable onPress={openSubscriptionManagement} accessibilityRole="link" hitSlop={6}>
              <Text className="text-xs font-medium text-blue-600">{t('plan.manage')} →</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => void buy()}
            disabled={!canBuy}
            accessibilityRole="button"
            className={`flex-row items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 active:bg-blue-700 ${
              canBuy ? '' : 'opacity-50'
            }`}
          >
            {isBuying ? <ActivityIndicator size="small" color="#ffffff" /> : null}
            <Text className="font-semibold text-white">
              {isBuying
                ? t('plan.purchasing')
                : t('plan.buy', { price: priceText(plan) })}
            </Text>
          </Pressable>
          <Text className="text-[11px] leading-4 text-gray-400">{t('plan.autoRenewNote')}</Text>
          {/* 청약 철회·환불 안내 (전자상거래법 §17). 자세한 것은 이용약관이다. */}
          <Text className="text-[11px] leading-4 text-gray-400">{t('plan.refundNote')}</Text>
          <Pressable onPress={() => void Linking.openURL(legalUrl('terms'))} accessibilityRole="link" hitSlop={6}>
            <Text className="text-[11px] text-gray-500 underline">{t('login.terms')}</Text>
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
                setNotice(null);
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
              <Text className="font-semibold text-gray-900">{priceText(candidate)}</Text>
            </Pressable>
          );
        })}
      </View>
    </Modal>
  );
}
