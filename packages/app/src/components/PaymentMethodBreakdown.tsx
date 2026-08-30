import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { EntryFilterQuery } from '@money/types';

import { apiClient, type ReportPeriod } from '@money/core/lib/api-client';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import { useProjectDisplayCurrency } from '@money/core/store/project';

/** 서버가 계산해 주는 결제수단별 지출과 통장 수입 (/reports/payment-methods) */
interface PaymentMethodItem {
  kind: 'account' | 'debit_card' | 'credit_card';
  id: string;
  name: string;
  ownerName: string | null;
  amount: string;
  count: number;
  /** 이 통장으로 들어온 수입. 카드는 언제나 "0"이다. */
  income: string;
}

/**
 * 수단 묶음. 신용카드를 먼저 둔다. 갚을 대금을 정산하는 자리라 가장 자주 본다.
 * 비어 있어도 탭은 남긴다. 감추면 카드를 처음 만들 때마다 탭 줄이 움직인다.
 */
const SECTIONS: Array<{
  kind: PaymentMethodItem['kind'];
  titleKey: MessageKey;
  emptyKey: MessageKey;
  text: string;
  face: string;
}> = [
  {
    kind: 'credit_card',
    titleKey: 'method.credit_card',
    emptyKey: 'method.creditEmpty',
    text: 'text-red-600',
    face: 'border border-red-200 bg-red-50',
  },
  {
    kind: 'debit_card',
    titleKey: 'method.debit_card',
    emptyKey: 'method.debitEmpty',
    text: 'text-green-600',
    face: 'border border-green-200 bg-green-50',
  },
  {
    kind: 'account',
    titleKey: 'method.accountTitle',
    emptyKey: 'method.accountEmpty',
    text: 'text-blue-600',
    face: 'border border-blue-200 bg-blue-50',
  },
];

/**
 * 수단별. 웹 가계 화면의 수단별 탭에서 왼쪽 목록을 옮긴 것이다.
 *
 * 고른 수단의 상세(거래 목록·월별 사용액·정산)는 아직 웹에만 있다.
 */
export default function PaymentMethodBreakdown({
  period,
  projectId,
  filter,
  reloadToken,
}: {
  period: ReportPeriod;
  projectId?: string | null;
  filter?: EntryFilterQuery;
  reloadToken?: number;
}) {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();
  const [methods, setMethods] = useState<PaymentMethodItem[]>([]);
  const [kind, setKind] = useState<PaymentMethodItem['kind']>('credit_card');
  const [isLoading, setIsLoading] = useState(true);

  const periodKey = period.yearMonth ?? `${period.startDate}~${period.endDate}`;

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;
    setIsLoading(true);

    apiClient
      .getPaymentMethods(period, projectId, filter)
      .then((rows) => {
        if (!cancelled) setMethods((rows ?? []) as PaymentMethodItem[]);
      })
      .catch((error) => {
        console.error('결제수단별 지출을 불러오지 못했습니다:', error);
        if (!cancelled) setMethods([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, periodKey, filter, reloadToken]);

  const section = SECTIONS.find((item) => item.kind === kind) ?? SECTIONS[0];
  const visibleItems = methods.filter((item) => item.kind === kind);

  return (
    <View className="gap-4">
      <View className="flex-row border-b border-gray-200">
        {SECTIONS.map((item) => {
          const active = kind === item.kind;

          return (
            <Pressable
              key={item.kind}
              onPress={() => setKind(item.kind)}
              className={`px-3 py-2 ${active ? 'border-b-2 border-blue-600' : ''}`}
            >
              <Text className={`font-medium ${active ? 'text-blue-600' : 'text-gray-600'}`}>
                {t(item.titleKey)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {isLoading && methods.length === 0 ? (
        <Text className="text-gray-600">{t('common.loading')}</Text>
      ) : visibleItems.length === 0 ? (
        <Text className="text-gray-600">{t(section.emptyKey)}</Text>
      ) : (
        <View className="gap-2">
          {visibleItems.map((item) => (
            <View key={item.id} className={`rounded-lg p-3 ${section.face}`}>
              <Text className="font-medium text-gray-700">{item.name}</Text>
              <Text className="text-xs text-gray-500">
                {item.ownerName ?? t('method.unknownOwner')}
              </Text>

              {/*
                통장은 돈이 나가는 곳이면서 들어오는 곳이다. 지출만 보여 주면 월급이
                들어온 통장이 0원으로 보인다. 수입이 있을 때만 두 값에 이름을 붙인다.
              */}
              <View className="flex-row items-baseline gap-2">
                <Text className={`text-sm font-semibold ${section.text}`}>
                  {toNumber(item.income) > 0 ? t('method.expensePrefix') : ''}
                  {formatCurrency(item.amount, displayCurrency)}
                </Text>
                {toNumber(item.income) > 0 ? (
                  <Text className="text-sm font-semibold text-green-600">
                    {t('method.incomeLine', {
                      amount: formatCurrency(item.income, displayCurrency),
                    })}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
