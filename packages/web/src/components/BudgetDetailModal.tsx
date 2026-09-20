'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import Modal from './Modal';
import type { EntryListItem } from './TransactionItem';
import TransactionListView from './TransactionListView';
import { useCategoryDetail } from '@money/core/hooks/useCategoryDetail';
import { type ReportPeriod } from '@money/core/lib/api-client';
import { formatCurrency } from '@money/core/lib/money';
import {
  CHART_BAR_RADIUS,
  CHART_COLOR,
  CHART_GRID,
  CHART_MARGIN,
  CHART_PIE_COLORS,
  CHART_TICK,
  CHART_TOOLTIP_STYLE,
  CHART_Y_AXIS_WIDTH,
  barDomain,
  formatAxisAmount,
  formatTooltipAmount,
} from '@money/core/lib/chart';
import { useTranslation } from '@money/core/lib/i18n';
import DailyCumulativeChart from './DailyCumulativeChart';
import type { EntryFilterQuery } from '@money/types';
import { useProjectDisplayCurrency } from '@money/core/store/project';
import type { Category } from '@money/core/lib/types';

interface BudgetDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  categoryId: string;
  categoryName: string;
  categories?: Category[];
  isInline?: boolean;
  /**
   * 볼 구간. 한 달(`{ yearMonth }`)이거나 임의 기간(`{ startDate, endDate }`)이다.
   *
   * 원형차트·일별 누적·거래 목록이 전부 이 구간을 쓴다. 오른쪽 12개월 추이만
   * 구간의 마지막 달을 끝으로 하는 시계열이라 구간 밖의 달도 함께 보여 준다.
   */
  period: ReportPeriod;
  /**
   * categoryId를 그 분류로만 본다 (소분류 제외).
   *
   * 목록의 "미분류"를 눌렀을 때 켠다. 소분류 없이 대분류에 바로 기록한 건만
   * 그리므로 원형차트는 그리지 않는다. 더 쪼갤 것이 없다.
   */
  exactCategory?: boolean;
  /** 선택된 프로젝트. 넘기지 않으면 서버가 기본 프로젝트로 조회한다. */
  projectId?: string | null;
  /** 가계 화면의 사람 필터. 상단 합계와 같은 조건을 써야 한다. */
  filter?: EntryFilterQuery;
  /** 거래를 누르면 호출한다. 날짜별 보기와 같은 상세 팝업을 열기 위한 통로다. */
  onEntryClick?: (entry: EntryListItem) => void;
  /** 값이 바뀌면 데이터를 다시 받는다. 부모 화면에서 거래를 고쳤을 때 쓴다. */
  reloadToken?: number;
}

/**
 * 분류 하나(또는 그 유형 전체)의 상세.
 *
 * 무엇을 받아 무엇을 그릴지는 core 의 useCategoryDetail 이 정한다. 앱의 분류 상세
 * 화면이 같은 훅을 쓰므로, 같은 분류를 누르면 두 화면이 같은 값을 말한다. 여기
 * 있는 것은 recharts 로 그리는 일뿐이다.
 */
export function BudgetDetailModal({
  isOpen,
  onClose,
  categoryId,
  categoryName,
  categories = [],
  isInline = false,
  period,
  exactCategory = false,
  projectId,
  filter,
  onEntryClick,
  reloadToken,
}: BudgetDetailModalProps) {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();

  const detail = useCategoryDetail({
    categoryId,
    categories,
    period,
    exactCategory,
    projectId,
    filter,
    reloadToken,
    // 닫혀 있는 팝업은 받지 않는다. 인라인으로 쓸 때는 늘 보이는 자리다.
    enabled: isOpen,
  });

  const content = (
    <div className="space-y-8 p-4">
      {detail.isLoading ? (
        <div className="text-center text-gray-500">{t('detail.loading')}</div>
      ) : (
        <>
          {/* 원형차트: 조각이 있을 때 표시 */}
          {detail.slices.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">
                  {(() => {
                    if (categoryId === 'total-expense') {
                      return t(detail.drilledId ? 'detail.pieExpenseChild' : 'detail.pieExpenseParent');
                    } else if (categoryId === 'total-income') {
                      return t(detail.drilledId ? 'detail.pieIncomeChild' : 'detail.pieIncomeParent');
                    } else {
                      return t('detail.pieExpenseChild');
                    }
                  })()}
                </h3>
                {detail.drilledId && (
                  <button
                    onClick={detail.resetDrill}
                    className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                  >
                    {t('detail.back')}
                  </button>
                )}
              </div>
              <ResponsiveContainer width="100%" height={400}>
                <PieChart>
                  <Pie
                    data={detail.slices}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value, percent }) =>
                      `${name} ${value || 0} (${((percent || 0) * 100).toFixed(1)}%)`
                    }
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                    onClick={(entry: any) => {
                      if (!detail.drilledId && entry.id) detail.drill(entry.id);
                    }}
                  >
                    {detail.slices.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={CHART_PIE_COLORS[index % CHART_PIE_COLORS.length]}
                        style={{ cursor: !detail.drilledId && entry.id ? 'pointer' : 'default' }}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: any) => formatCurrency(value, displayCurrency)}
                    contentStyle={CHART_TOOLTIP_STYLE}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* 12개월 바차트 */}
          <div>
            <h3 className="text-lg font-semibold mb-4">{t('detail.monthlyUsage')}</h3>
            {detail.hasMonthlyAmount ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={detail.monthly} margin={CHART_MARGIN}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="month" tick={CHART_TICK} />
                  <YAxis
                    domain={barDomain(detail.monthly.map((d) => d.amount))}
                    tickFormatter={(value: number) => formatAxisAmount(value, displayCurrency)}
                    tick={CHART_TICK}
                    width={CHART_Y_AXIS_WIDTH}
                  />
                  <Tooltip
                    formatter={(value: any) =>
                    formatTooltipAmount(value, t('detail.usage'), displayCurrency)
                  }
                    contentStyle={CHART_TOOLTIP_STYLE}
                  />
                  <Bar dataKey="amount" fill={CHART_COLOR} radius={CHART_BAR_RADIUS} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="h-[300px] flex items-center justify-center text-gray-500 text-sm">
                {t('detail.noYearUsage')}
              </p>
            )}
          </div>

          {/* 일별 라인차트 */}
          <div>
            <h3 className="text-lg font-semibold mb-4">{t('detail.dailyCumulative')}</h3>
            {detail.hasDailyAmount ? (
              <DailyCumulativeChart
                current={detail.daily}
                comparisons={detail.comparisons}
                currentName={detail.currentMonthName}
                throughDay={detail.throughDay}
                tooltipName={t('detail.cumulativeUsage')}
                height={300}
              />
            ) : (
              <p className="h-[300px] flex items-center justify-center text-gray-500 text-sm">
                {t('detail.noMonthUsage')}
              </p>
            )}
          </div>

          {/* 거래내역 */}
          <div>
            <h3 className="text-lg font-semibold mb-4">{t('detail.entries')}</h3>
            {detail.entries.length === 0 ? (
              <p className="text-gray-500 text-sm">{t('detail.noEntries')}</p>
            ) : (
              <TransactionListView
                entries={detail.entries}
                onEntryClick={onEntryClick ?? (() => undefined)}
              />
            )}
          </div>
        </>
      )}
    </div>
  );

  if (isInline) {
    return content;
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('category.detailTitle', { name: categoryName })}>
      {content}
    </Modal>
  );
}
