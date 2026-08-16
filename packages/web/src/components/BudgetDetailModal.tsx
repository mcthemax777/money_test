'use client';

import { useEffect, useState } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { X } from 'lucide-react';
import Modal from './Modal';
import { apiClient } from '@/lib/api-client';

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

export function BudgetDetailModal({ isOpen, onClose, categoryId, categoryName, categories = [] }: BudgetDetailModalProps) {
  const [monthlyData, setMonthlyData] = useState<MonthlyData[]>([]);
  const [dailyData, setDailyData] = useState<DailyData[]>([]);
  const [loading, setLoading] = useState(false);

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

    const loadData = async () => {
      setLoading(true);
      try {
        console.log('Loading budget detail data...');
        // 12개월 데이터 로드
        const today = new Date();
        const monthlyDataList: MonthlyData[] = [];
        const filterParams = getFilterParams(categoryId);

        for (let i = 11; i >= 0; i--) {
          const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
          const year = date.getFullYear();
          const month = date.getMonth() + 1;

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
            const amount = transactions
              .filter((t: any) => {
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
        const year = today.getFullYear();
        const month = today.getMonth() + 1;
        try {
          const dailyResponse = await apiClient.getTransactionsV2({
            mainCategoryId: filterParams.mainCategoryId,
            subCategoryId: filterParams.subCategoryId,
            startDate: new Date(year, month - 1, 1),
            endDate: new Date(year, month, 0),
          });
          const dailyTransactions = dailyResponse?.data || [];

          console.log('Daily transactions:', dailyTransactions.length);

          const dailyMap = new Map<number, number>();
          const dailyTransactionType = filterParams.type || 'expense';
          dailyTransactions
            .filter((t: any) => {
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
          const daysInMonth = new Date(year, month, 0).getDate();
          for (let day = 1; day <= daysInMonth; day++) {
            const amount = dailyMap.get(day) || 0;
            cumulative += amount;
            dailyDataList.push({ day, amount, cumulative });
          }

          console.log('Daily data:', dailyDataList);
          setDailyData(dailyDataList);
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
  }, [isOpen, categoryId, categories]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`${categoryName} 상세 분석`}>
      <div className="space-y-8 p-4">
        {loading ? (
          <div className="text-center text-gray-500">데이터 로드 중...</div>
        ) : (
          <>
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
          </>
        )}
      </div>
    </Modal>
  );
}
