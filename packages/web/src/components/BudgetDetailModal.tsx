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
import { useCategoryDetail, type CategorySlice } from '@money/core/hooks/useCategoryDetail';
import type { BarPoint } from '@money/core/lib/usage-pattern';
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
import type { EntryScopeQuery } from '@money/types';
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
  filter?: EntryScopeQuery;
  /** 거래를 누르면 호출한다. 날짜별 보기와 같은 상세 팝업을 열기 위한 통로다. */
  onEntryClick?: (entry: EntryListItem) => void;
  /** 값이 바뀌면 데이터를 다시 받는다. 부모 화면에서 거래를 고쳤을 때 쓴다. */
  reloadToken?: number;
}

/**
 * 구성비 원형. 분류 조각과 수단 조각이 함께 쓴다 (앱의 CategoryPieChart 와 같은 자리).
 *
 * onDrill 을 주면 id 가 있는 조각을 눌러 한 단 내려간다. id 가 없는 조각("미분류")이나
 * 수단 조각은 내려갈 곳이 없다.
 */
function SlicePieChart({
  slices,
  currency,
  onDrill,
}: {
  slices: CategorySlice[];
  currency: string;
  onDrill?: (categoryId: string) => void;
}) {
  return (
    <ResponsiveContainer width="100%" height={400}>
      <PieChart>
        <Pie
          data={slices}
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
            if (onDrill && entry.id) onDrill(entry.id);
          }}
        >
          {slices.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={CHART_PIE_COLORS[index % CHART_PIE_COLORS.length]}
              style={{ cursor: onDrill && entry.id ? 'pointer' : 'default' }}
            />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: any) => formatCurrency(value, currency)}
          contentStyle={CHART_TOOLTIP_STYLE}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** 금액 막대. 12개월 추이와 요일별·시간대별 평균이 함께 쓴다. */
function AmountBarChart({
  data,
  currency,
  tooltipName,
  interval,
}: {
  data: BarPoint[];
  currency: string;
  tooltipName: string;
  /** X축 이름을 몇 칸 걸러 적을지. 0 이면 다 적는다. 비우면 recharts 가 겹치지 않게 고른다. */
  interval?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid {...CHART_GRID} />
        <XAxis dataKey="label" tick={CHART_TICK} interval={interval} />
        <YAxis
          domain={barDomain(data.map((d) => d.amount))}
          tickFormatter={(value: number) => formatAxisAmount(value, currency)}
          tick={CHART_TICK}
          width={CHART_Y_AXIS_WIDTH}
        />
        <Tooltip
          formatter={(value: any) => formatTooltipAmount(value, tooltipName, currency)}
          contentStyle={CHART_TOOLTIP_STYLE}
        />
        <Bar dataKey="amount" fill={CHART_COLOR} radius={CHART_BAR_RADIUS} />
      </BarChart>
    </ResponsiveContainer>
  );
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

  /** 거래내역에서 세는 세 그래프가 비었을 때의 안내. 일별 누적과 같은 말을 쓴다. */
  const emptyPattern = t(detail.isOffline ? 'online.viewOnlyOnline' : detail.labels.noPeriod);

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
              <SlicePieChart
                slices={detail.slices}
                currency={displayCurrency}
                /* 한 단 더 내려간 뒤에는 쪼갤 것이 없다. 그때는 누를 수 없는 그림이다. */
                onDrill={detail.drilledId ? undefined : detail.drill}
              />
            </div>
          )}

          {/* 12개월 바차트 */}
          <div>
            <h3 className="text-lg font-semibold mb-4">{t(detail.labels.monthly)}</h3>
            {detail.hasMonthlyAmount ? (
              <AmountBarChart
                data={detail.monthly}
                currency={displayCurrency}
                tooltipName={t(detail.labels.amount)}
              />
            ) : (
              <p className="h-[300px] flex items-center justify-center text-gray-500 text-sm">
                {t(detail.isOffline ? 'online.viewOnlyOnline' : detail.labels.noYear)}
              </p>
            )}
          </div>

          {/* 일별 라인차트 */}
          <div>
            <h3 className="text-lg font-semibold mb-4">{t(detail.labels.daily)}</h3>
            {detail.hasDailyAmount ? (
              <DailyCumulativeChart
                current={detail.daily}
                comparisons={detail.comparisons}
                currentName={detail.currentMonthName}
                throughDay={detail.throughDay}
                tooltipName={t(detail.labels.cumulative)}
                height={300}
              />
            ) : (
              <p className="h-[300px] flex items-center justify-center text-gray-500 text-sm">
                {t(detail.isOffline ? 'online.viewOnlyOnline' : detail.labels.noPeriod)}
              </p>
            )}
          </div>

          {/* 요일·시간대·수단. 셋 다 아래 거래내역에서 센다. */}
          <div>
            <h3 className="text-lg font-semibold">{t(detail.labels.weekday)}</h3>
            <p className="mb-4 text-xs text-gray-500">{t('detail.weekdayNote')}</p>
            {detail.hasPatternAmount ? (
              <AmountBarChart
                data={detail.pattern.weekday}
                currency={displayCurrency}
                tooltipName={t('detail.dailyAverage')}
                interval={0}
              />
            ) : (
              <p className="h-[300px] flex items-center justify-center text-gray-500 text-sm">
                {emptyPattern}
              </p>
            )}
          </div>

          <div>
            <h3 className="text-lg font-semibold">{t(detail.labels.hour)}</h3>
            <p className="mb-4 text-xs text-gray-500">
              {t('detail.hourNote')}
              {detail.pattern.untimedCount > 0 &&
                ` ${t('detail.hourUntimed', { count: detail.pattern.untimedCount })}`}
            </p>
            {detail.pattern.hasTimedAmount ? (
              <AmountBarChart
                data={detail.pattern.hour}
                currency={displayCurrency}
                tooltipName={t('detail.dailyAverage')}
                /* 스물넷을 다 적으면 좁은 패널에서 겹친다. 0·3·6…시만 적는다. */
                interval={2}
              />
            ) : (
              <p className="h-[300px] flex items-center justify-center text-gray-500 text-sm">
                {detail.hasPatternAmount ? t('detail.noHourUsage') : emptyPattern}
              </p>
            )}
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-4">{t(detail.labels.method)}</h3>
            {detail.hasPatternAmount ? (
              /* 수단은 분류가 아니라 더 내려갈 곳이 없다. 누를 수 없는 그림이다. */
              <SlicePieChart slices={detail.pattern.methods} currency={displayCurrency} />
            ) : (
              <p className="h-[300px] flex items-center justify-center text-gray-500 text-sm">
                {emptyPattern}
              </p>
            )}
          </div>

          {/* 거래내역 */}
          <div>
            <h3 className="text-lg font-semibold mb-4">{t('detail.entries')}</h3>
            {detail.entries.length === 0 ? (
              <p className="text-gray-500 text-sm">{t(detail.isOffline ? 'online.viewOnlyOnline' : 'detail.noEntries')}</p>
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
