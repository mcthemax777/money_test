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
  /** 선택된 프로젝트. 넘기지 않으면 서버가 기본 프로젝트로 조회한다. */
  projectId?: string | null;
}

interface FilterParams {
  mainCategoryId?: string;
  subCategoryId?: string;
  type?: string;
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
  const [currentMonthTransactions, setCurrentMonthTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPieCategory, setSelectedPieCategory] = useState<string | null>(null);
  const [categoryStats, setCategoryStats] = useState<PieChartData[]>([]);
  const [subCategoryStats, setSubCategoryStats] = useState<PieChartData[]>([]);

  // categoryId가 무엇을 가리키는지에 따라 서버 조회 조건을 만든다.
  const getFilterParams = (catId: string): FilterParams => {
    if (catId === 'total-income') {
      return { type: 'income' };
    }

    // 전체지출은 expense와 credit_usage를 함께 봐야 하므로 서버 type 필터를 쓰지 않고
    // 클라이언트에서 걸러낸다.
    if (catId === 'total-expense') {
      return {};
    }

    const category = categories?.find((c) => c.id === catId);

    // 소분류면 소분류로, 대분류면 대분류로 조회한다.
    return category?.parentId ? { subCategoryId: catId } : { mainCategoryId: catId };
  };

  // 합계와 통계에 공통으로 쓰는 거래 필터. 이전에는 같은 조건이 세 곳에 흩어져 있었다.
  const buildTypeFilter = (filterParams: FilterParams) => {
    const isCategoryFiltered = Boolean(filterParams.mainCategoryId || filterParams.subCategoryId);
    const wantedType = filterParams.type ?? 'expense';

    return (tx: Transaction) => {
      // 이체는 소비가 아니므로 제외한다.
      if (tx.type === 'transfer') return false;
      // 카테고리 조건은 서버가 이미 적용했다.
      if (isCategoryFiltered) return true;
      if (wantedType === 'expense') return tx.type === 'expense' || tx.type === 'credit_usage';
      return tx.type === wantedType;
    };
  };

  // 거래를 키별로 합산해 원형차트 데이터로 만든다.
  const summarizeBy = (
    txs: Transaction[],
    pick: (tx: Transaction) => { id: string; name: string } | null,
  ): PieChartData[] => {
    const totals = new Map<string, { name: string; value: number }>();

    txs.forEach((tx) => {
      const key = pick(tx);
      if (!key) return;

      const current = totals.get(key.id) ?? { name: key.name, value: 0 };
      current.value += tx.amount;
      totals.set(key.id, current);
    });

    return Array.from(totals.entries())
      .map(([id, { name, value }]) => ({ id, name, value }))
      .sort((a, b) => b.value - a.value);
  };

  const buildCategoryStats = (
    catId: string,
    filterParams: FilterParams,
    txs: Transaction[],
  ): PieChartData[] => {
    if (catId === 'total-expense') {
      return summarizeBy(txs, (tx) =>
        tx.type === 'expense' || tx.type === 'credit_usage'
          ? { id: tx.mainCategoryId || '', name: tx.mainCategory || '기타' }
          : null,
      );
    }

    if (catId === 'total-income') {
      return summarizeBy(txs, (tx) =>
        tx.type === 'income'
          ? { id: tx.mainCategoryId || '', name: tx.mainCategory || '기타' }
          : null,
      );
    }

    // 대분류를 보고 있으면 소분류로 쪼갠다. 소분류가 없는 거래는 넣지 않는다.
    if (filterParams.mainCategoryId && !filterParams.subCategoryId) {
      return summarizeBy(txs, (tx) =>
        tx.subCategoryId ? { id: tx.subCategoryId, name: tx.subCategory || '기타' } : null,
      );
    }

    // 소분류를 보고 있으면 더 쪼갤 것이 없다.
    return [];
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
        const filterParams = getFilterParams(categoryId);
        const matchesType = buildTypeFilter(filterParams);

        // 12개월치를 한 번에 받아 클라이언트에서 나눈다.
        // 이전에는 월별로 12번, 일별로 1번, 목록으로 1번씩 총 14번을 순차 호출했다.
        const rangeStart = new Date(displayYear, displayMonth - 12, 1);
        const rangeEnd = new Date(displayYear, displayMonth, 0);

        const response = await apiClient.getTransactionsV2(
          { ...filterParams, startDate: rangeStart, endDate: rangeEnd },
          projectId,
        );

        const rows: Transaction[] = (response?.data || [])
          .map((tx: any) => ({
            ...tx,
            mainCategory:
              typeof tx.mainCategory === 'object' ? tx.mainCategory?.name : tx.mainCategory,
            subCategory:
              typeof tx.subCategory === 'object' ? tx.subCategory?.name : tx.subCategory,
          }))
          .filter(matchesType);

        // 월별 합계
        const monthKey = (date: Date) => `${date.getFullYear()}-${date.getMonth() + 1}`;
        const monthlyTotals = new Map<string, number>();

        rows.forEach((tx) => {
          const key = monthKey(new Date(tx.date));
          monthlyTotals.set(key, (monthlyTotals.get(key) ?? 0) + tx.amount);
        });

        const months: MonthlyData[] = [];
        for (let i = 11; i >= 0; i -= 1) {
          // Date 생성자가 연도 넘김을 처리한다.
          const date = new Date(displayYear, displayMonth - 1 - i, 1);
          months.push({
            month: `${date.getMonth() + 1}월`,
            amount: monthlyTotals.get(monthKey(date)) ?? 0,
          });
        }
        setMonthlyData(months);

        // 표시 중인 달의 거래
        const monthRows = rows.filter((tx) => {
          const date = new Date(tx.date);
          return date.getFullYear() === displayYear && date.getMonth() + 1 === displayMonth;
        });
        setCurrentMonthTransactions(monthRows);

        // 일별 누적
        const dailyTotals = new Map<number, number>();
        monthRows.forEach((tx) => {
          const day = new Date(tx.date).getDate();
          dailyTotals.set(day, (dailyTotals.get(day) ?? 0) + tx.amount);
        });

        const daysInMonth = new Date(displayYear, displayMonth, 0).getDate();
        const daily: DailyData[] = [];
        let cumulative = 0;

        for (let day = 1; day <= daysInMonth; day += 1) {
          const amount = dailyTotals.get(day) ?? 0;
          cumulative += amount;
          daily.push({ day, amount, cumulative });
        }
        setDailyData(daily);

        setCategoryStats(buildCategoryStats(categoryId, filterParams, monthRows));
      } catch (error) {
        console.error('분류별 상세 데이터를 불러오지 못했습니다:', error);
        // 실패했을 때 이전 달의 데이터가 남아 있으면 잘못된 값을 보게 되므로 비운다.
        setMonthlyData([]);
        setDailyData([]);
        setCurrentMonthTransactions([]);
        setCategoryStats([]);
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

  const hasMonthlyAmount = monthlyData.some((d) => d.amount > 0);
  const hasDailyAmount = dailyData.some((d) => d.cumulative > 0);

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
            {(() => {
              const filteredTransactions = currentMonthTransactions.filter(tx => tx.type !== 'credit_payment');

              if (filteredTransactions.length === 0) {
                return <p className="text-gray-500 text-sm">거래내역이 없습니다.</p>;
              }

              const groupedTransactions: { [date: string]: typeof filteredTransactions } = {};
              filteredTransactions.forEach(tx => {
                const date = new Date(tx.date).toLocaleDateString('ko-KR');
                if (!groupedTransactions[date]) {
                  groupedTransactions[date] = [];
                }
                groupedTransactions[date].push(tx);
              });

              const sortedDates = Object.keys(groupedTransactions).sort((a, b) => {
                const dateA = new Date(a.replace(/년|월|일/g, (match) => {
                  if (match === '년') return '/';
                  if (match === '월') return '/';
                  return '';
                }));
                const dateB = new Date(b.replace(/년|월|일/g, (match) => {
                  if (match === '년') return '/';
                  if (match === '월') return '/';
                  return '';
                }));
                return dateB.getTime() - dateA.getTime();
              });

              const getDayOfWeek = (dateStr: string) => {
                const weekDays = ['일', '월', '화', '수', '목', '금', '토'];
                const date = new Date(dateStr.replace(/년|월|일/g, (match) => {
                  if (match === '년') return '/';
                  if (match === '월') return '/';
                  return '';
                }));
                return weekDays[date.getDay()];
              };

              const calculateTotals = (txs: typeof filteredTransactions) => {
                let incomeTotal = 0;
                let expenseTotal = 0;
                txs.forEach(tx => {
                  if (tx.type === 'income') {
                    incomeTotal += tx.amount;
                  } else if (tx.type === 'expense' || tx.type === 'credit_usage') {
                    expenseTotal += tx.amount;
                  }
                });
                return { incomeTotal, expenseTotal };
              };

              return (
                <div className="space-y-6">
                  {sortedDates.map(date => {
                    const dayOfWeek = getDayOfWeek(date);
                    const { incomeTotal, expenseTotal } = calculateTotals(groupedTransactions[date]);

                    return (
                      <div key={date}>
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-lg font-bold text-gray-900">
                            {date} <span className="text-sm text-gray-600">({dayOfWeek})</span>
                          </h3>
                          <div className="flex gap-6 text-sm font-semibold">
                            {incomeTotal > 0 && (
                              <span className="text-green-600">
                                +{new Intl.NumberFormat('ko-KR', {
                                  style: 'currency',
                                  currency: 'KRW',
                                }).format(incomeTotal)}
                              </span>
                            )}
                            {expenseTotal > 0 && (
                              <span className="text-red-600">
                                -{new Intl.NumberFormat('ko-KR', {
                                  style: 'currency',
                                  currency: 'KRW',
                                }).format(expenseTotal)}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="space-y-2">
                          {groupedTransactions[date].map((tx) => (
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
                      </div>
                    );
                  })}
                </div>
              );
            })()}
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
