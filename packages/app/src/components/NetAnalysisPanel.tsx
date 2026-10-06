/*
 * 분석 탭의 합계. 수입과 지출을 한자리에 놓고 그 차(순수입)를 본다 (웹의 NetAnalysisPanel 과 같은 짝).
 *
 * 차례는 요약 → 일별 누적 순수입 → 기간별 순수입이다 (웹과 같다). 값은 core 의 useNetAnalysis 가 정한다.
 */
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import type { EntryScopeQuery } from '@money/types';

import type { AnalysisTotals } from '@money/core/hooks/useAnalysis';
import { useNetAnalysis } from '@money/core/hooks/useNetAnalysis';
import type { ReportPeriod } from '@money/core/lib/api-client';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { formatCurrency } from '@money/core/lib/money';
import type { Category } from '@money/core/lib/types';
import { useProjectDisplayCurrency } from '@money/core/store/project';

import DailyCumulativeChart from './DailyCumulativeChart';
import MonthlyAmountChart from './MonthlyAmountChart';

/** 금액 색. 들어온 돈은 초록, 나간 돈은 빨강, 0 은 먹색이다 (거래 목록과 같은 규칙). */
function toneOf(value: number): string {
  if (value > 0) return 'text-green-600';
  if (value < 0) return 'text-red-600';
  return 'text-gray-900';
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-3 rounded-lg bg-white p-4 shadow-sm">
      <Text className="text-base font-semibold text-gray-900">{title}</Text>
      {children}
    </View>
  );
}

/**
 * 수입·지출 요약 (웹과 같다). 저축률은 순수입을 수입으로 나눈 값이라 수입이 없으면 적지 않는다.
 * 막대는 둘 중 큰 쪽을 꽉 찬 길이로 둔다 -- 지출이 수입을 넘으면 그만큼이 적자로 보인다.
 */
function NetSummary({ totals, currency }: { totals: AnalysisTotals; currency: string }) {
  const { t } = useTranslation();
  const { income, expense, net } = totals;
  const savingRate = income > 0 ? Math.round((net / income) * 100) : null;
  const scale = Math.max(income, expense, 1);
  const items: Array<{ labelKey: MessageKey; text: string; tone: string }> = [
    { labelKey: 'analysis.net.income', text: formatCurrency(income, currency), tone: 'text-green-600' },
    { labelKey: 'analysis.net.expense', text: formatCurrency(expense, currency), tone: 'text-red-600' },
    { labelKey: 'analysis.net.net', text: formatCurrency(net, currency), tone: toneOf(net) },
    {
      labelKey: 'analysis.net.savingRate',
      text: savingRate === null ? '-' : `${savingRate}%`,
      tone: savingRate === null ? 'text-gray-400' : toneOf(savingRate),
    },
  ];

  return (
    <Card title={t('analysis.net.summary')}>
      <View className="flex-row flex-wrap gap-y-3">
        {items.map((item) => (
          <View key={item.labelKey} className="w-1/2 pr-2">
            <Text className="text-xs text-gray-500">{t(item.labelKey)}</Text>
            <Text className={`text-base font-semibold ${item.tone}`} numberOfLines={1}>
              {item.text}
            </Text>
          </View>
        ))}
      </View>
      <View className="gap-1.5">
        {[
          { value: income, color: 'bg-green-500' },
          { value: expense, color: 'bg-red-500' },
        ].map((bar) => (
          <View key={bar.color} className="h-2.5 overflow-hidden rounded-full bg-gray-100">
            <View
              className={`h-full rounded-full ${bar.color}`}
              style={{ width: `${(bar.value / scale) * 100}%` }}
            />
          </View>
        ))}
      </View>
    </Card>
  );
}

export default function NetAnalysisPanel({
  totals,
  categories,
  period,
  projectId,
  filter,
  trendClip,
  trendPeriod,
}: {
  /** 그 기간의 수입·지출·순수입 (거래 탭의 기간 줄과 같은 값). 목록이 오는 중이면 null 이다. */
  totals: AnalysisTotals | null;
  categories: Category[];
  period: ReportPeriod;
  projectId: string | null;
  filter: EntryScopeQuery;
  trendClip?: { from?: string; to?: string };
  trendPeriod: string;
}) {
  const { t } = useTranslation();
  const currency = useProjectDisplayCurrency();
  const net = useNetAnalysis({ categories, period, projectId, filter, trendClip, trendPeriod });

  const emptyText = (key: MessageKey) => t(net.isOffline ? 'online.viewOnlyOnline' : key);

  return (
    <View className="gap-6">
      {totals ? <NetSummary totals={totals} currency={currency} /> : null}

      {net.isLoading ? (
        <Text className="py-12 text-center text-gray-500">{t('detail.loading')}</Text>
      ) : (
        <>
          <Card title={t('analysis.net.daily')}>
            {net.hasDaily ? (
              <DailyCumulativeChart
                current={net.daily}
                comparisons={net.comparisons}
                currentName={net.currentMonthName}
                throughDay={net.throughDay}
                tooltipName={t('analysis.net.cumulative')}
              />
            ) : (
              <Text className="py-12 text-center text-sm text-gray-500">
                {emptyText('analysis.net.noPeriod')}
              </Text>
            )}
          </Card>

          {/* 기간별 순수입. 지출 탭의 월별 사용금액과 같은 막대다. 적자인 기간은 0 아래로 내려간다. */}
          <Card title={t(net.trendTitle)}>
            {net.hasTrend ? (
              <MonthlyAmountChart points={net.trend} currency={currency} />
            ) : (
              <Text className="py-12 text-center text-sm text-gray-500">
                {emptyText(net.trendEmpty)}
              </Text>
            )}
          </Card>

        </>
      )}
    </View>
  );
}
