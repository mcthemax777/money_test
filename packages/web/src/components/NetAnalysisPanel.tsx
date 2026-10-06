'use client';

import type { EntryScopeQuery } from '@money/types';

import { useNetAnalysis } from '@money/core/hooks/useNetAnalysis';
import type { AnalysisTotals } from '@money/core/hooks/useAnalysis';
import type { ReportPeriod } from '@money/core/lib/api-client';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency } from '@money/core/lib/money';
import type { Category } from '@money/core/lib/types';
import { useProjectDisplayCurrency } from '@money/core/store/project';

import { AmountBarChart } from './BudgetDetailModal';
import DailyCumulativeChart from './DailyCumulativeChart';

/** 금액 색. 들어온 돈은 초록, 나간 돈은 빨강, 0 은 먹색이다 (거래 목록과 같은 규칙). */
function toneOf(value: number): string {
  if (value > 0) return 'text-green-600';
  if (value < 0) return 'text-red-600';
  return 'text-gray-900';
}

/**
 * 수입·지출 요약. 거래 탭의 기간 줄과 같은 값을 풀어 적고, 수입 가운데 얼마를 썼는지 막대 하나로
 * 보인다 (앱의 같은 상자와 같다).
 *
 * 저축률은 순수입을 수입으로 나눈 값이다. 수입이 없으면 나눌 수 없어 적지 않는다.
 */
function NetSummary({ totals, currency }: { totals: AnalysisTotals; currency: string }) {
  const { t } = useTranslation();
  const { income, expense, net } = totals;
  const savingRate = income > 0 ? Math.round((net / income) * 100) : null;
  /*
   * 막대는 둘 중 큰 쪽을 꽉 찬 길이로 둔다. 수입이 지출보다 적으면 지출 막대가 수입을 넘어
   * 그만큼이 적자로 보인다.
   */
  const scale = Math.max(income, expense, 1);

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-lg font-semibold">{t('analysis.net.summary')}</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-gray-500">{t('analysis.net.income')}</dt>
          <dd className="text-base font-semibold text-green-600">{formatCurrency(income, currency)}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">{t('analysis.net.expense')}</dt>
          <dd className="text-base font-semibold text-red-600">{formatCurrency(expense, currency)}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">{t('analysis.net.net')}</dt>
          <dd className={`text-base font-semibold ${toneOf(net)}`}>{formatCurrency(net, currency)}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">{t('analysis.net.savingRate')}</dt>
          <dd className={`text-base font-semibold ${savingRate === null ? 'text-gray-400' : toneOf(savingRate)}`}>
            {savingRate === null ? '-' : `${savingRate}%`}
          </dd>
        </div>
      </dl>
      <div className="space-y-1.5" aria-hidden>
        {[
          { value: income, color: 'bg-green-500' },
          { value: expense, color: 'bg-red-500' },
        ].map((bar) => (
          <div key={bar.color} className="h-2.5 overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full rounded-full ${bar.color} transition-[width] duration-200 ease-out motion-reduce:transition-none`}
              style={{ width: `${(bar.value / scale) * 100}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 분석 탭의 합계. 수입과 지출을 한자리에 놓고 그 차(순수입)를 본다.
 *
 * 차례는 요약 → 일별 누적 순수입 → 기간별 순수입이다. 먼저 "얼마가 남았나"를 말하고, 이 기간
 * 안에서 어떻게 쌓였는지, 다른 기간과 견줘 어떤지 차례로 내려간다. 값은 core 의 useNetAnalysis 가 정한다.
 */
export default function NetAnalysisPanel({
  totals,
  categories,
  period,
  projectId,
  filter,
  trendClip,
  trendPeriod,
  reloadToken,
}: {
  /** 그 기간의 수입·지출·순수입 (거래 탭의 기간 줄과 같은 값). 목록이 오는 중이면 null 이다. */
  totals: AnalysisTotals | null;
  categories: Category[];
  period: ReportPeriod;
  projectId: string | null;
  filter: EntryScopeQuery;
  trendClip?: { from?: string; to?: string };
  trendPeriod: string;
  reloadToken?: number;
}) {
  const { t } = useTranslation();
  const currency = useProjectDisplayCurrency();
  const net = useNetAnalysis({
    categories,
    period,
    projectId,
    filter,
    trendClip,
    trendPeriod,
    reloadToken,
  });

  const emptyText = (key: Parameters<typeof t>[0]) =>
    t(net.isOffline ? 'online.viewOnlyOnline' : key);

  return (
    <div className="space-y-8">
      {totals ? <NetSummary totals={totals} currency={currency} /> : null}

      {net.isLoading ? (
        <div className="text-center text-gray-500">{t('detail.loading')}</div>
      ) : (
        <>
          {/* 일별 누적 순수입. 달로 보면 앞선 두 달을 겹친다 (지출·수입 탭과 같은 그래프). */}
          <div>
            <h3 className="mb-4 text-lg font-semibold">{t('analysis.net.daily')}</h3>
            {net.hasDaily ? (
              <DailyCumulativeChart
                current={net.daily}
                comparisons={net.comparisons}
                currentName={net.currentMonthName}
                throughDay={net.throughDay}
                tooltipName={t('analysis.net.cumulative')}
                height={300}
              />
            ) : (
              <p className="flex h-[300px] items-center justify-center text-sm text-gray-500">
                {emptyText('analysis.net.noPeriod')}
              </p>
            )}
          </div>

          {/*
            기간별 순수입. 지출 탭의 월별 사용금액과 같은 막대다. 적자인 기간은 0 아래로 내려간다.
          */}
          <div>
            <h3 className="mb-4 text-lg font-semibold">{t(net.trendTitle)}</h3>
            {net.hasTrend ? (
              <AmountBarChart
                data={net.trend}
                currency={currency}
                tooltipName={t('analysis.net.net')}
              />
            ) : (
              <p className="flex h-[300px] items-center justify-center text-sm text-gray-500">
                {emptyText(net.trendEmpty)}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
