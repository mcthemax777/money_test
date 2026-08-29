'use client';

import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { X } from 'lucide-react';
import Modal from './Modal';
import type { EntryListItem } from './TransactionItem';
import TransactionListView from './TransactionListView';
import { apiClient, type ReportPeriod } from '@/lib/api-client';
import { formatCurrency, toNumber } from '@/lib/money';
import {
  CHART_BAR_RADIUS,
  CHART_COLOR,
  CHART_GRID,
  CHART_MARGIN,
  CHART_TICK,
  CHART_TOOLTIP_STYLE,
  CHART_Y_AXIS_WIDTH,
  barDomain,
  formatAxisAmount,
  formatTooltipAmount,
} from '@/lib/chart';
import { buildDailyCumulative, monthDateKeys } from '@/lib/entries';
import { dayRangeQuery, throughDayOf } from '@/lib/datetime';
import { loadPreviousMonths } from '@/lib/month-compare';
import DailyCumulativeChart, {
  type CumulativeSeries,
  type DailyCumulativePoint,
} from './DailyCumulativeChart';
import type { EntryFilterQuery } from '@money/types';
import { useProjectDisplayCurrency, useProjectTimeZone } from '@/store/project';
import type { Category } from '@/lib/types';

const COLORS = [
  '#FF6B6B',
  '#4ECDC4',
  '#45B7D1',
  '#FFA07A',
  '#98D8C8',
  '#F7DC6F',
  '#BB8FCE',
  '#85C1E2',
  '#F8B88B',
  '#ABEBC6',
  '#F5B041',
  '#D7BCCB',
];


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
  /** 가계 화면의 사람·과소비 필터. 상단 합계와 같은 조건을 써야 한다. */
  filter?: EntryFilterQuery;
  /** 거래를 누르면 호출한다. 날짜별 보기와 같은 상세 팝업을 열기 위한 통로다. */
  onEntryClick?: (entry: EntryListItem) => void;
  /** 값이 바뀌면 데이터를 다시 받는다. 부모 화면에서 거래를 고쳤을 때 쓴다. */
  reloadToken?: number;
}

interface MonthlyData {
  month: string;
  amount: number;
}

interface PieChartData {
  name: string;
  value: number;
  /** 소분류만 가진다. 이 값이 없으면 더 파고들 수 없는 조각이다. */
  id?: string;
}

type BreakdownRow = {
  categoryId: string;
  categoryName: string;
  parentCategoryId: string | null;
  amount: string;
};

/**
 * 대분류 하나의 구성비 조각을 만든다.
 *
 * 소분류 행과 함께, 소분류 없이 그 대분류에 바로 기록된 금액을 '미분류'로 넣는다.
 * 이것을 빼면 조각 합계가 예산 카드에 보이는 사용액보다 적어져서 돈이 사라진 것처럼 보인다.
 * '미분류'에는 id를 주지 않는다. 실제 카테고리가 아니므로 눌러도 내려갈 곳이 없다.
 *
 * 소분류가 아예 없는 대분류는 빈 배열을 준다. '미분류' 한 조각만 100%로 그리면
 * 쪼개 보여주는 것이 없으면서 분류가 빠진 듯한 오해만 준다. 이때는 원형차트를 걸러야 한다.
 */
function buildSubcategoryStats(rows: BreakdownRow[], parentId: string): PieChartData[] {
  const stats: PieChartData[] = rows
    .filter((item) => item.parentCategoryId === parentId)
    .map((item) => ({ id: item.categoryId, name: item.categoryName, value: toNumber(item.amount) }));

  if (stats.length === 0) return [];

  const direct = rows.find((item) => item.categoryId === parentId);
  const directAmount = direct ? toNumber(direct.amount) : 0;
  if (directAmount > 0) stats.push({ name: '미분류', value: directAmount });

  return stats.sort((a, b) => b.value - a.value);
}

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
  const timeZone = useProjectTimeZone();
  const displayCurrency = useProjectDisplayCurrency();

  /*
   * 구간을 세 형태로 쓴다 (PaymentMethodTab과 같은 규칙).
   *   dayKeys  : 일별 누적 그래프의 x축 (달력 날짜)
   *   endMonth : 12개월 추이의 마지막 달
   *   periodKey: 구간이 바뀌었는지 판단할 값 (객체는 렌더마다 새로 만들어진다)
   */
  const dayKeys = period.yearMonth
    ? monthDateKeys(Number(period.yearMonth.slice(0, 4)), Number(period.yearMonth.slice(5, 7)))
    : { startKey: period.startDate!, endKey: period.endDate! };
  const endMonth = dayKeys.endKey.slice(0, 7);
  const periodKey = `${dayKeys.startKey}~${dayKeys.endKey}`;

  const [monthlyData, setMonthlyData] = useState<MonthlyData[]>([]);
  const [dailyData, setDailyData] = useState<DailyCumulativePoint[]>([]);
  /** 겹쳐 그릴 전전달·지난달. 달 단위로 볼 때만 채운다. */
  const [comparisons, setComparisons] = useState<CumulativeSeries[]>([]);
  const [periodEntries, setCurrentMonthEntries] = useState<EntryListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPieCategory, setSelectedPieCategory] = useState<string | null>(null);
  const [categoryStats, setCategoryStats] = useState<PieChartData[]>([]);
  // 대분류를 클릭했을 때 소분류로 내려가기 위한 평면 집계 (rollup=false)
  const [flatBreakdown, setFlatBreakdown] = useState<
    Array<{ categoryId: string; categoryName: string; parentCategoryId: string | null; amount: string }>
  >([]);
  const [subCategoryStats, setSubCategoryStats] = useState<PieChartData[]>([]);

  /**
   * categoryId가 무엇을 가리키는지 판별한다.
   * 'total-expense' / 'total-income'은 전체 합계, 그 외는 실제 카테고리다.
   */
  const resolveTarget = (catId: string) => {
    if (catId === 'total-expense') return { scope: 'total' as const, type: 'expense' as const };
    if (catId === 'total-income') return { scope: 'total' as const, type: 'income' as const };

    const category = categories?.find((c) => c.id === catId);
    return {
      scope: 'category' as const,
      type: (category?.type ?? 'expense') as 'income' | 'expense',
      // parentId가 있으면 소분류다. 소분류는 더 쪼갤 것이 없다.
      // "미분류"(exactCategory)도 마찬가지로 더 내려갈 곳이 없다.
      isLeaf: Boolean(category?.parentId) || exactCategory,
    };
  };

  useEffect(() => {
    if (!isOpen || !categoryId) return;

    setSelectedPieCategory(null);

    const loadData = async () => {
      setLoading(true);

      try {
        const target = resolveTarget(categoryId);
        // 구간 경계는 프로젝트 타임존 기준이다 (서버의 합계와 같은 규칙).
        const { startDate, endDate } = dayRangeQuery(dayKeys.startKey, dayKeys.endKey, timeZone);

        // 12개월 시계열은 서버가 계산한다.
        // PaymentMethodTab과 각자 구현하던 것을 /reports/trend 하나로 합쳤다.
        const trendPromise =
          target.scope === 'total'
            ? apiClient.getTrend('total', { type: target.type, endMonth, months: 12, ...filter }, projectId)
            : apiClient.getTrend(
                'category',
                { targetId: categoryId, endMonth, months: 12, exact: exactCategory, ...filter },
                projectId,
              );

        /*
         * 이 구간의 거래를 뽑는 조건. 날짜만 빼 둔다.
         *
         * 전체 지출은 kind='expense'가 아니라 categoryType='expense'로 뽑는다.
         * kind로 걸면 수수료가 붙은 이체가 빠져서, 12개월 그래프(수수료 포함)와
         * 어긋난다. 앞선 달을 겹쳐 그릴 때 날짜만 바꿔 이 조건을 그대로 다시 쓴다.
         */
        const entryQuery = {
          ...filter,
          ...(target.scope === 'category'
            ? { categoryId, ...(exactCategory ? { categoryExact: true } : {}) }
            : { categoryType: target.type }),
        };

        // 일별 누적과 목록에 쓴다. 커서를 끝까지 따라간다. 한 페이지만 받으면
        // 아래 일별 누적이 12개월 그래프(서버 집계, 전량)와 어긋난다.
        const entriesPromise = apiClient.getAllEntries(
          { ...entryQuery, startDate, endDate },
          projectId,
        );

        /*
         * 겹쳐 그릴 앞선 두 달.
         *
         * 기간을 직접 정했을 때는 받지 않는다. 열흘짜리 구간의 "지난달"이 한 달인지
         * 같은 열흘인지 정해지지 않아 견줄 대상이 없다.
         */
        const comparisonPromise = period.yearMonth
          ? loadPreviousMonths(period.yearMonth, entryQuery, projectId, timeZone)
          : Promise.resolve([] as CumulativeSeries[]);

        // 원형차트: 전체면 대분류별, 대분류를 보고 있으면 소분류별
        const breakdownPromise =
          target.scope === 'total'
            ? apiClient.getCategoryBreakdown(period, target.type, projectId, { ...filter })
            : target.isLeaf
              ? Promise.resolve([])
              : apiClient.getCategoryBreakdown(period, target.type, projectId, { rollup: false, ...filter });

        // 드릴다운(대분류 -> 소분류)에도 서버 집계를 쓴다
        const flatPromise = target.isLeaf
          ? Promise.resolve([])
          : apiClient.getCategoryBreakdown(period, target.type, projectId, { rollup: false, ...filter });

        const [trendRes, entriesRes, breakdownRes, flatRes, comparisonRes] = await Promise.all([
          trendPromise,
          entriesPromise,
          breakdownPromise,
          flatPromise,
          comparisonPromise,
        ]);
        setFlatBreakdown((flatRes ?? []) as any);

        const trend = (trendRes ?? []) as Array<{ yearMonth: string; amount: string }>;
        setMonthlyData(
          trend.map((point) => ({
            month: `${Number(point.yearMonth.split('-')[1])}월`,
            amount: toNumber(point.amount),
          })),
        );

        const rows: EntryListItem[] = (entriesRes ?? []) as EntryListItem[];
        setCurrentMonthEntries(rows);

        // 일별 누적. 이체는 금액이 아니라 수수료만 쌓는다.
        setDailyData(buildDailyCumulative(rows, dayKeys.startKey, dayKeys.endKey, timeZone));
        setComparisons(comparisonRes);

        const breakdown = (breakdownRes ?? []) as BreakdownRow[];
        // 대분류를 보고 있으면 그 아래 소분류 + 미분류만 남긴다
        // (rollup=false로 받았으므로 소분류와 대분류 직접 금액이 전부 들어 있다)
        setCategoryStats(
          target.scope === 'category'
            ? buildSubcategoryStats(breakdown, categoryId)
            : breakdown.map((item) => ({
                id: item.categoryId,
                name: item.categoryName,
                value: toNumber(item.amount),
              })),
        );
      } catch (error) {
        console.error('분류별 상세 데이터를 불러오지 못했습니다:', error);
        // 실패했을 때 이전 구간의 데이터가 남아 있으면 잘못된 값을 보게 되므로 비운다.
        setMonthlyData([]);
        setDailyData([]);
        setComparisons([]);
        setCurrentMonthEntries([]);
        setCategoryStats([]);
        setFlatBreakdown([]);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [
    isOpen,
    categoryId,
    categories,
    periodKey,
    exactCategory,
    projectId,
    timeZone,
    filter,
    reloadToken,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]);

  // 이 목록은 categoryId나 categoryType으로 조회한 결과라 카테고리 다리가 없는
  // 카드사 이체는 애초에 들어오지 않는다. 따로 걸러 내지 않는다.
  const visibleEntries = periodEntries;

  /*
   * 달 단위로 볼 때만 쓰는 값. 이번 달 선의 이름과, 그 선을 며칠까지 그을지다.
   * 기간 보기에서는 견줄 달이 없어 둘 다 필요 없다.
   */
  const currentMonthName = period.yearMonth ? `${Number(period.yearMonth.slice(5))}월` : undefined;
  const throughDay = period.yearMonth ? throughDayOf(period.yearMonth, timeZone) : undefined;

  const hasMonthlyAmount = monthlyData.some((d) => d.amount > 0);
  /*
   * 이 달에 쓴 것이 없어도 앞선 달에 있으면 그린다. "지난달에는 여기에 이만큼
   * 썼는데 이번 달은 0"이 그림으로 보여야 한다.
   */
  const hasDailyAmount =
    dailyData.some((d) => d.cumulative > 0) ||
    comparisons.some((series) => series.points.some((point) => point.cumulative > 0));

  const handlePieClick = (data: PieChartData) => {
    if (!data.id) return;

    // 서버가 이미 계산한 평면 집계를 쓴다. 패널에서 대분류를 직접 볼 때와 같은 규칙이어야 한다.
    setSubCategoryStats(buildSubcategoryStats(flatBreakdown, data.id));
    setSelectedPieCategory(data.id);
  };

  const content = (
    <div className="space-y-8 p-4">
      {loading ? (
        <div className="text-center text-gray-500">데이터 로드 중...</div>
      ) : (
        <>
          {/* 원형차트: categoryStats가 있을 때 표시 */}
          {categoryStats.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">
                  {(() => {
                    if (categoryId === 'total-expense') {
                      return selectedPieCategory ? '소분류별 지출' : '대분류별 지출';
                    } else if (categoryId === 'total-income') {
                      return selectedPieCategory ? '소분류별 수입' : '대분류별 수입';
                    } else {
                      return '소분류별 지출';
                    }
                  })()}
                </h3>
                {selectedPieCategory && (
                  <button
                    onClick={() => {
                      setSelectedPieCategory(null);
                      setSubCategoryStats([]);
                    }}
                    className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                  >
                    뒤로가기
                  </button>
                )}
              </div>
              <ResponsiveContainer width="100%" height={400}>
                <PieChart>
                  <Pie
                    data={selectedPieCategory ? subCategoryStats : categoryStats}
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
                      if (!selectedPieCategory && entry.id) {
                        const data = categoryStats.find((item) => item.id === entry.id);
                        if (data) {
                          handlePieClick(data);
                        }
                      }
                    }}
                  >
                    {(selectedPieCategory ? subCategoryStats : categoryStats).map(
                      (entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={COLORS[index % COLORS.length]}
                          style={{ cursor: !selectedPieCategory ? 'pointer' : 'default' }}
                        />
                      )
                    )}
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
            <h3 className="text-lg font-semibold mb-4">월별 사용금액</h3>
            {hasMonthlyAmount ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthlyData} margin={CHART_MARGIN}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="month" tick={CHART_TICK} />
                  <YAxis
                    domain={barDomain(monthlyData.map((d) => d.amount))}
                    tickFormatter={(value: number) => formatAxisAmount(value, displayCurrency)}
                    tick={CHART_TICK}
                    width={CHART_Y_AXIS_WIDTH}
                  />
                  <Tooltip
                    formatter={(value: any) => formatTooltipAmount(value, '사용금액', displayCurrency)}
                    contentStyle={CHART_TOOLTIP_STYLE}
                  />
                  <Bar dataKey="amount" fill={CHART_COLOR} radius={CHART_BAR_RADIUS} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="h-[300px] flex items-center justify-center text-gray-500 text-sm">
                최근 12개월 사용 내역이 없습니다.
              </p>
            )}
          </div>

          {/* 일별 라인차트 */}
          <div>
            <h3 className="text-lg font-semibold mb-4">일별 누적 사용금액</h3>
            {hasDailyAmount ? (
              <DailyCumulativeChart
                current={dailyData}
                comparisons={comparisons}
                currentName={currentMonthName}
                throughDay={throughDay}
                tooltipName="누적 사용금액"
                height={300}
              />
            ) : (
              <p className="h-[300px] flex items-center justify-center text-gray-500 text-sm">
                이번 달 사용 내역이 없습니다.
              </p>
            )}
          </div>

          {/* 거래내역 */}
          <div>
            <h3 className="text-lg font-semibold mb-4">거래기록</h3>
            {visibleEntries.length === 0 ? (
              <p className="text-gray-500 text-sm">거래내역이 없습니다.</p>
            ) : (
              <TransactionListView
                entries={visibleEntries}
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
    <Modal isOpen={isOpen} onClose={onClose} title={`${categoryName} 상세 분석`}>
      {content}
    </Modal>
  );
}
