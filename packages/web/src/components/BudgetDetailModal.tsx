'use client';

import { useEffect, useState } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { X } from 'lucide-react';
import Modal from './Modal';
import type { EntryListItem } from './TransactionItem';
import TransactionListView from './TransactionListView';
import { apiClient } from '@/lib/api-client';
import { toNumber } from '@/lib/money';
import { buildDailyCumulative } from '@/lib/entries';
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
  currentMonth?: number;
  currentYear?: number;
  /** 선택된 프로젝트. 넘기지 않으면 서버가 기본 프로젝트로 조회한다. */
  projectId?: string | null;
}

interface MonthlyData {
  month: string;
  amount: number;
}

interface DailyData {
  day: number;
  amount: number;
  cumulative: number;
}

interface PieChartData {
  name: string;
  value: number;
  id?: string;
}

export function BudgetDetailModal({
  isOpen,
  onClose,
  categoryId,
  categoryName,
  categories = [],
  isInline = false,
  currentMonth,
  currentYear,
  projectId,
}: BudgetDetailModalProps) {
  const [monthlyData, setMonthlyData] = useState<MonthlyData[]>([]);
  const [dailyData, setDailyData] = useState<DailyData[]>([]);
  const [currentMonthEntries, setCurrentMonthEntries] = useState<EntryListItem[]>([]);
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
      isLeaf: Boolean(category?.parentId),
    };
  };

  useEffect(() => {
    if (!isOpen || !categoryId) return;

    const today = new Date();
    const displayMonth = currentMonth || today.getMonth() + 1;
    const displayYear = currentYear || today.getFullYear();

    setSelectedPieCategory(null);

    const loadData = async () => {
      setLoading(true);

      try {
        const target = resolveTarget(categoryId);
        const yearMonth = `${displayYear}-${String(displayMonth).padStart(2, '0')}`;
        const monthStart = new Date(Date.UTC(displayYear, displayMonth - 1, 1));
        const monthEnd = new Date(Date.UTC(displayYear, displayMonth, 0));

        // 12개월 시계열은 서버가 계산한다.
        // PaymentMethodTab과 각자 구현하던 것을 /reports/trend 하나로 합쳤다.
        const trendPromise =
          target.scope === 'total'
            ? apiClient.getTrend('total', { type: target.type, endMonth: yearMonth, months: 12 }, projectId)
            : apiClient.getTrend('category', { targetId: categoryId, endMonth: yearMonth, months: 12 }, projectId);

        // 이 달의 거래 목록. 일별 누적과 목록에 쓴다.
        //
        // 전체 지출은 kind='expense'가 아니라 categoryType='expense'로 뽑는다.
        // kind로 걸면 수수료가 붙은 이체가 빠져서, 12개월 그래프(수수료 포함)와 어긋난다.
        const entriesPromise = apiClient.getEntries(
          {
            startDate: monthStart.toISOString(),
            endDate: monthEnd.toISOString(),
            limit: 200,
            ...(target.scope === 'category' ? { categoryId } : { categoryType: target.type }),
          },
          projectId,
        );

        // 원형차트: 전체면 대분류별, 대분류를 보고 있으면 소분류별
        const breakdownPromise =
          target.scope === 'total'
            ? apiClient.getCategoryBreakdown(yearMonth, target.type, projectId)
            : target.isLeaf
              ? Promise.resolve([])
              : apiClient.getCategoryBreakdown(yearMonth, target.type, projectId, { rollup: false });

        // 드릴다운(대분류 -> 소분류)에도 서버 집계를 쓴다
        const flatPromise = target.isLeaf
          ? Promise.resolve([])
          : apiClient.getCategoryBreakdown(yearMonth, target.type, projectId, { rollup: false });

        const [trendRes, entriesRes, breakdownRes, flatRes] = await Promise.all([
          trendPromise,
          entriesPromise,
          breakdownPromise,
          flatPromise,
        ]);
        setFlatBreakdown((flatRes ?? []) as any);

        const trend = (trendRes ?? []) as Array<{ yearMonth: string; amount: string }>;
        setMonthlyData(
          trend.map((point) => ({
            month: `${Number(point.yearMonth.split('-')[1])}월`,
            amount: toNumber(point.amount),
          })),
        );

        const rows: EntryListItem[] = entriesRes?.data ?? [];
        setCurrentMonthEntries(rows);

        // 일별 누적. 이체는 금액이 아니라 수수료만 쌓는다.
        setDailyData(buildDailyCumulative(rows, displayYear, displayMonth));

        const breakdown = (breakdownRes ?? []) as Array<{
          categoryId: string;
          categoryName: string;
          parentCategoryId: string | null;
          amount: string;
        }>;
        // 대분류를 보고 있으면 그 아래 소분류만 남긴다 (rollup=false로 받았으므로 전부 들어 있다)
        const scoped =
          target.scope === 'category'
            ? breakdown.filter((item) => item.parentCategoryId === categoryId)
            : breakdown;
        setCategoryStats(
          scoped.map((item) => ({
            id: item.categoryId,
            name: item.categoryName,
            value: toNumber(item.amount),
          })),
        );
      } catch (error) {
        console.error('분류별 상세 데이터를 불러오지 못했습니다:', error);
        // 실패했을 때 이전 달의 데이터가 남아 있으면 잘못된 값을 보게 되므로 비운다.
        setMonthlyData([]);
        setDailyData([]);
        setCurrentMonthEntries([]);
        setCategoryStats([]);
        setFlatBreakdown([]);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isOpen, categoryId, categories, currentMonth, currentYear, projectId]);

  // 값이 모두 0이면 domain이 [0, 0]이 되어 recharts가 축을 그리지 못하고
  // 막대가 최대 높이로 보인다. 데이터가 없을 때는 기본 상한을 준다.
  const axisMax = (values: number[]) => {
    const max = Math.max(0, ...values);
    return max > 0 ? Math.ceil((max * 1.2) / 100) * 100 : 1000;
  };

  // 카드대금 결제는 소비가 아니므로 목록에서 뺀다
  const visibleEntries = currentMonthEntries.filter((entry) => entry.kind !== 'card_payment');

  const hasMonthlyAmount = monthlyData.some((d) => d.amount > 0);
  const hasDailyAmount = dailyData.some((d) => d.cumulative > 0);

  const handlePieClick = (data: PieChartData) => {
    if (!data.id) return;

    // 서버가 이미 계산한 평면 집계에서 해당 대분류의 소분류만 뽑는다.
    const stats = flatBreakdown
      .filter((item) => item.parentCategoryId === data.id)
      .map((item) => ({ id: item.categoryId, name: item.categoryName, value: toNumber(item.amount) }))
      .sort((a, b) => b.value - a.value);

    setSubCategoryStats(stats);
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
                    formatter={(value: any) =>
                      new Intl.NumberFormat('ko-KR', {
                        style: 'currency',
                        currency: 'KRW',
                      }).format(value)
                    }
                    contentStyle={{ backgroundColor: '#fff', border: '1px solid #ccc' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* 12개월 바차트 */}
          <div>
            <h3 className="text-lg font-semibold mb-4">지난 12개월 사용금액</h3>
            {hasMonthlyAmount ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis domain={[0, axisMax(monthlyData.map((d) => d.amount))]} />
                  <Tooltip formatter={(value: any) => `${(value || 0).toLocaleString()}원`} />
                  <Bar dataKey="amount" fill="#3b82f6" />
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
            <h3 className="text-lg font-semibold mb-4">이번 달 일별 누적 사용금액</h3>
            {hasDailyAmount ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={dailyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  <YAxis domain={[0, axisMax(dailyData.map((d) => d.cumulative))]} />
                  <Tooltip formatter={(value: any) => `${(value || 0).toLocaleString()}원`} />
                  <Legend />
                  <Line type="monotone" dataKey="cumulative" stroke="#3b82f6" name="누적 사용금액" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="h-[300px] flex items-center justify-center text-gray-500 text-sm">
                이번 달 사용 내역이 없습니다.
              </p>
            )}
          </div>

          {/* 거래내역 */}
          <div>
            <h3 className="text-lg font-semibold mb-4">이번 달 거래내역</h3>
            {visibleEntries.length === 0 ? (
              <p className="text-gray-500 text-sm">거래내역이 없습니다.</p>
            ) : (
              <TransactionListView entries={visibleEntries} onEntryClick={() => undefined} />
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
