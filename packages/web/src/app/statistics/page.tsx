'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/store/auth';
import { useProject } from '@/store/project';
import { apiClient } from '@/lib/api-client';
import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from 'recharts';
import MonthHeader from '@/components/MonthHeader';

interface CategoryStat {
  id: string;
  name: string;
  amount: number;
}

interface Transaction {
  id: string;
  description: string;
  amount: number;
  type: 'income' | 'expense' | 'transfer';
  date: string;
  mainCategory: string;
  mainCategoryId?: string;
  subCategory?: string;
  subCategoryId?: string;
  accountId?: string;
  cardId?: string;
  personId?: string;
}

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

export default function StatisticsPage() {
  const { isAuthenticated } = useAuth();
  const { selectedProjectId } = useProject();
  const router = useRouter();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState<number>(new Date().getMonth() + 1);
  const [currentYear, setCurrentYear] = useState<number>(new Date().getFullYear());

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }

    const loadData = async () => {
      try {
        setIsLoading(true);
        const transactionsData = await apiClient.getTransactionsV2({}, selectedProjectId || undefined);
        const txs = (transactionsData?.data || []).map((tx: any) => ({
          ...tx,
          mainCategory: typeof tx.mainCategory === 'object' ? tx.mainCategory?.name : tx.mainCategory,
          subCategory: typeof tx.subCategory === 'object' ? tx.subCategory?.name : tx.subCategory,
        }));
        setTransactions(txs);
      } catch (err) {
        console.error('데이터 조회 실패:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [isAuthenticated, router, selectedProjectId]);

  const monthlyTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      const txDate = new Date(tx.date);
      return (
        txDate.getFullYear() === currentYear &&
        txDate.getMonth() + 1 === currentMonth &&
        tx.type === 'expense'
      );
    });
  }, [transactions, currentMonth, currentYear]);

  const categoryStats = useMemo(() => {
    const stats: { [key: string]: number } = {};

    monthlyTransactions.forEach((tx) => {
      const category = tx.mainCategory || '기타';
      stats[category] = (stats[category] || 0) + tx.amount;
    });

    return Object.entries(stats)
      .map(([name, amount]) => ({
        name,
        value: amount,
      }))
      .sort((a, b) => b.value - a.value);
  }, [monthlyTransactions]);

  const totalExpense = useMemo(() => {
    return monthlyTransactions.reduce((sum, tx) => sum + tx.amount, 0);
  }, [monthlyTransactions]);

  const monthlyTotals = useMemo(() => {
    let incomeTotal = 0;
    let expenseTotal = 0;

    transactions
      .filter(
        (tx) =>
          tx.type !== 'transfer' &&
          new Date(tx.date).getFullYear() === currentYear &&
          new Date(tx.date).getMonth() + 1 === currentMonth
      )
      .forEach((tx) => {
        if (tx.type === 'income') {
          incomeTotal += tx.amount;
        } else if (tx.type === 'expense') {
          expenseTotal += tx.amount;
        }
      });

    return { incomeTotal, expenseTotal };
  }, [transactions, currentMonth, currentYear]);

  const handlePrevMonth = () => {
    if (currentMonth === 1) {
      setCurrentYear(currentYear - 1);
      setCurrentMonth(12);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 12) {
      setCurrentYear(currentYear + 1);
      setCurrentMonth(1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  if (!isAuthenticated) {
    return <div>로딩 중...</div>;
  }

  if (isLoading) {
    return <div className="p-6 text-gray-600">로딩 중...</div>;
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">통계</h1>

        <MonthHeader
          year={currentYear}
          month={currentMonth}
          incomeTotal={monthlyTotals.incomeTotal}
          expenseTotal={monthlyTotals.expenseTotal}
          onPrevMonth={handlePrevMonth}
          onNextMonth={handleNextMonth}
        />
      </div>

      {categoryStats.length === 0 ? (
        <div className="flex items-center justify-center h-96 bg-white rounded-lg shadow">
          <p className="text-gray-600">이 달에 지출 데이터가 없습니다.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="md:col-span-2 bg-white rounded-lg shadow p-8">
            <h2 className="text-xl font-bold text-gray-900 mb-6">분류별 지출</h2>
            <ResponsiveContainer width="100%" height={400}>
              <PieChart>
                <Pie
                  data={categoryStats}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value, percent }) =>
                    `${name} (${((percent || 0) * 100).toFixed(1)}%)`
                  }
                  outerRadius={120}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {categoryStats.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
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

          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6">분류별 상세</h2>
            <div className="space-y-4">
              {categoryStats.map((stat, index) => (
                <div key={stat.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: COLORS[index % COLORS.length] }}
                    />
                    <span className="text-gray-700 font-medium">{stat.name}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-gray-900 font-bold">
                      {new Intl.NumberFormat('ko-KR', {
                        style: 'currency',
                        currency: 'KRW',
                      }).format(stat.value)}
                    </p>
                    <p className="text-xs text-gray-500">
                      {((stat.value / totalExpense) * 100).toFixed(1)}%
                    </p>
                  </div>
                </div>
              ))}

              <div className="border-t border-gray-200 pt-4 mt-4">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-gray-900">합계</span>
                  <p className="text-gray-900 font-bold">
                    {new Intl.NumberFormat('ko-KR', {
                      style: 'currency',
                      currency: 'KRW',
                    }).format(totalExpense)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
