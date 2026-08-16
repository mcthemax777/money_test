'use client';

import { useEffect, useState } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { X } from 'lucide-react';
import Modal from './Modal';
import TransactionItem from './TransactionItem';
import { apiClient } from '@/lib/api-client';

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

interface Transaction {
  id: string;
  description: string;
  amount: number;
  type: 'income' | 'expense' | 'transfer' | 'credit_usage' | 'credit_payment';
  date: string;
  mainCategory: string;
  mainCategoryId?: string;
  subCategory?: string;
  subCategoryId?: string;
  accountId?: string;
  cardId?: string;
  personId?: string;
}

interface Category {
  id: string;
  name: string;
  type: 'income' | 'expense';
  level: number;
  parentId?: string | null;
}

interface BudgetDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  categoryId: string;
  categoryName: string;
  categories?: Category[];
  isInline?: boolean;
  currentMonth?: number;
  currentYear?: number;
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

export function BudgetDetailModal({ isOpen, onClose, categoryId, categoryName, categories = [], isInline = false, currentMonth, currentYear }: BudgetDetailModalProps) {
  const [monthlyData, setMonthlyData] = useState<MonthlyData[]>([]);
  const [dailyData, setDailyData] = useState<DailyData[]>([]);
  const [currentMonthTransactions, setCurrentMonthTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPieCategory, setSelectedPieCategory] = useState<string | null>(null);
  const [categoryStats, setCategoryStats] = useState<PieChartData[]>([]);
  const [subCategoryStats, setSubCategoryStats] = useState<PieChartData[]>([]);

  // categoryId의 타입 판단 (total-income, total-expense, 대분류, 소분류)
  const getFilterParams = (catId: string) => {
    if (catId === 'total-income') {
      console.log('[getFilterParams] total income - filter by type:income');
      return { mainCategoryId: undefined, subCategoryId: undefined, type: 'income' };
    }
    if (catId === 'total-expense') {
      console.log('[getFilterParams] total expense - filter by type:expense,credit_usage');
      return { mainCategoryId: undefined, subCategoryId: undefined };
    }

    const category = categories?.find(c => c.id === catId);
    console.log('[getFilterParams] Looking for category:', catId);
    console.log('[getFilterParams] Found category:', category);

    const categoryType = category?.type || 'expense';

    if (category?.parentId) {
      // 소분류
      console.log('[getFilterParams] Subcategory - filtering by subCategoryId:', catId);
      return { mainCategoryId: undefined, subCategoryId: catId };
    }

    // 대분류
    console.log('[getFilterParams] Main category - filtering by mainCategoryId:', catId);
    return { mainCategoryId: catId, subCategoryId: undefined };
  };

  useEffect(() => {
    if (!isOpen || !categoryId) return;

    console.log('Opening BudgetDetailModal for category:', categoryId);
    setSelectedPieCategory(null);

    const loadData = async () => {
      setLoading(true);
      try {
        console.log('Loading budget detail data...');
        // 12개월 데이터 로드
        const today = new Date();
        const displayMonth = currentMonth || (today.getMonth() + 1);
        const displayYear = currentYear || today.getFullYear();
        const monthlyDataList: MonthlyData[] = [];
        const filterParams = getFilterParams(categoryId);

        for (let i = 11; i >= 0; i--) {
          let month = displayMonth - i;
          let year = displayYear;
          if (month <= 0) {
            year -= 1;
            month += 12;
          }
          const date = new Date(year, month - 1, 1);

          try {
            console.log(`[API call] Month ${month}/${year} with params:`, filterParams);
            const response = await apiClient.getTransactionsV2({
              ...filterParams,
              startDate: new Date(year, month - 1, 1),
              endDate: new Date(year, month, 0),
            });
            const transactions = response?.data || [];

            console.log(`Month ${month}/${year}: ${transactions.length} transactions`);

            const transactionType = filterParams.type || 'expense';
            const isMainOrSubCategory = filterParams.mainCategoryId || filterParams.subCategoryId;
            const amount = transactions
              .filter((t: any) => {
                // 대분류/소분류 필터는 API에서 이미 적용됨, 모든 거래 타입 포함
                if (isMainOrSubCategory) {
                  return true;
                }
                if (transactionType === 'expense') {
                  return t.type === 'expense' || t.type === 'credit_usage';
                }
                return t.type === transactionType;
              })
              .reduce((sum: number, t: any) => sum + t.amount, 0);

            monthlyDataList.push({
              month: `${month}월`,
              amount,
            });
          } catch (err) {
            console.error(`Failed to load month ${month}/${year}:`, err);
            monthlyDataList.push({
              month: `${month}월`,
              amount: 0,
            });
          }
        }

        console.log('Monthly data:', monthlyDataList);
        setMonthlyData(monthlyDataList);

        // 현재 월 일별 데이터 로드
        try {
          const dailyResponse = await apiClient.getTransactionsV2({
            mainCategoryId: filterParams.mainCategoryId,
            subCategoryId: filterParams.subCategoryId,
            startDate: new Date(displayYear, displayMonth - 1, 1),
            endDate: new Date(displayYear, displayMonth, 0),
          });
          const dailyTransactions = dailyResponse?.data || [];

          console.log('Daily transactions:', dailyTransactions.length);

          const dailyMap = new Map<number, number>();
          const dailyTransactionType = filterParams.type || 'expense';
          const isMainOrSubCategory = filterParams.mainCategoryId || filterParams.subCategoryId;
          dailyTransactions
            .filter((t: any) => {
              // 대분류/소분류 필터는 API에서 이미 적용됨, 모든 거래 타입 포함
              if (isMainOrSubCategory) {
                return true;
              }
              if (dailyTransactionType === 'expense') {
                return t.type === 'expense' || t.type === 'credit_usage';
              }
              return t.type === dailyTransactionType;
            })
            .forEach((t: any) => {
              const day = new Date(t.date).getDate();
              dailyMap.set(day, (dailyMap.get(day) || 0) + t.amount);
            });

          const dailyDataList: DailyData[] = [];
          let cumulative = 0;
          const daysInMonth = new Date(displayYear, displayMonth, 0).getDate();
          for (let day = 1; day <= daysInMonth; day++) {
            const amount = dailyMap.get(day) || 0;
            cumulative += amount;
            dailyDataList.push({ day, amount, cumulative });
          }

          console.log('Daily data:', dailyDataList);
          setDailyData(dailyDataList);

          // 현재 월의 거래내역 조회

          try {
            const currentResponse = await apiClient.getTransactionsV2({
              ...filterParams,
              startDate: new Date(displayYear, displayMonth - 1, 1),
              endDate: new Date(displayYear, displayMonth, 0),
            });
            const txs = (currentResponse?.data || [])
              .map((tx: any) => ({
                ...tx,
                mainCategory: typeof tx.mainCategory === 'object' ? tx.mainCategory?.name : tx.mainCategory,
                subCategory: typeof tx.subCategory === 'object' ? tx.subCategory?.name : tx.subCategory,
              }));
            setCurrentMonthTransactions(txs);

            // categoryStats 계산
            if (categoryId === 'total-expense') {
              // 전체지출: 대분류별 통계
              const statsMap = new Map<string, { name: string; id?: string; amount: number }>();
              txs.forEach((tx: any) => {
                if (tx.type === 'expense' || tx.type === 'credit_usage') {
                  const mainCatId = tx.mainCategoryId || '';
                  const mainCatName = tx.mainCategory || '기타';
                  if (!statsMap.has(mainCatId)) {
                    statsMap.set(mainCatId, { name: mainCatName, id: mainCatId, amount: 0 });
                  }
                  const stat = statsMap.get(mainCatId);
                  if (stat) {
                    stat.amount += tx.amount;
                  }
                }
              });

              const stats = Array.from(statsMap.values())
                .map(stat => ({
                  name: stat.name,
                  value: stat.amount,
                  id: stat.id,
                }))
                .sort((a, b) => b.value - a.value);
              setCategoryStats(stats);
            } else if (filterParams.mainCategoryId && !filterParams.subCategoryId) {
              // 대분류 선택: 소분류별 통계
              const statsMap = new Map<string, { name: string; id?: string; amount: number }>();
              txs.forEach((tx: any) => {
                const subCatId = tx.subCategoryId || '';
                const subCatName = tx.subCategory || '기타';
                if (!statsMap.has(subCatId)) {
                  statsMap.set(subCatId, { name: subCatName, id: subCatId, amount: 0 });
                }
                const stat = statsMap.get(subCatId);
                if (stat) {
                  stat.amount += tx.amount;
                }
              });

              const stats = Array.from(statsMap.values())
                .map(stat => ({
                  name: stat.name,
                  value: stat.amount,
                  id: stat.id,
                }))
                .sort((a, b) => b.value - a.value);
              setCategoryStats(stats);
            } else {
              // 소분류 선택: 원형차트 안 보임
              setCategoryStats([]);
            }
          } catch (err) {
            console.error('Failed to load current month transactions:', err);
            setCurrentMonthTransactions([]);
          }
        } catch (err) {
          console.error('Failed to load daily transactions:', err);
          setDailyData([]);
        }
      } catch (error) {
        console.error('Failed to load budget details:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isOpen, categoryId, categories, currentMonth, currentYear]);

  const handlePieClick = (data: PieChartData) => {
    if (!data.id) return;

    // 해당 대분류의 소분류별 통계 계산
    const subStats = new Map<string, { name: string; id?: string; amount: number }>();
    currentMonthTransactions
      .filter((tx) => tx.mainCategoryId === data.id && (tx.type === 'expense' || tx.type === 'credit_usage'))
      .forEach((tx) => {
        const subCatId = tx.subCategoryId || '';
        const subCatName = tx.subCategory || '기타';
        if (!subStats.has(subCatId)) {
          subStats.set(subCatId, { name: subCatName, id: subCatId, amount: 0 });
        }
        const stat = subStats.get(subCatId);
        if (stat) {
          stat.amount += tx.amount;
        }
      });

    const stats = Array.from(subStats.values())
      .map(stat => ({
        name: stat.name,
        value: stat.amount,
        id: stat.id,
      }))
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
          {/* 대분류별 원형차트 (total-expense일 때만) */}
          {categoryId === 'total-expense' && categoryStats.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">
                  {selectedPieCategory ? '소분류별 지출' : '대분류별 지출'}
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
              <ResponsiveContainer width="100%" height={350}>
                <PieChart>
                  <Pie
                    data={selectedPieCategory ? subCategoryStats : categoryStats}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value, percent }) =>
                      `${name} (${((percent || 0) * 100).toFixed(1)}%)`
                    }
                    outerRadius={120}
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
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* 12개월 바차트 */}
          <div>
            <h3 className="text-lg font-semibold mb-4">지난 12개월 사용금액</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(value: any) => `${(value || 0).toLocaleString()}원`} />
                <Bar dataKey="amount" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* 일별 라인차트 */}
          <div>
            <h3 className="text-lg font-semibold mb-4">이번 달 일별 누적 사용금액</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" />
                <YAxis />
                <Tooltip formatter={(value: any) => `${(value || 0).toLocaleString()}원`} />
                <Legend />
                <Line type="monotone" dataKey="cumulative" stroke="#3b82f6" name="누적 사용금액" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* 거래내역 */}
          <div>
            <h3 className="text-lg font-semibold mb-4">이번 달 거래내역</h3>
            {currentMonthTransactions.filter(tx => tx.type !== 'credit_payment').length > 0 ? (
              <div className="space-y-2">
                {currentMonthTransactions.filter(tx => tx.type !== 'credit_payment').map((tx) => (
                  <TransactionItem
                    key={tx.id}
                    id={tx.id}
                    description={tx.description}
                    amount={tx.amount}
                    type={tx.type}
                    date={tx.date}
                    mainCategory={tx.mainCategory}
                    subCategory={tx.subCategory}
                  />
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">거래내역이 없습니다.</p>
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
