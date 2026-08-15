'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/store/auth';
import { useProject } from '@/store/project';
import { useBudget } from '@/store/budget';
import { useCategory } from '@/store/category';
import { BudgetCard } from '@/components/BudgetCard';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';

interface CategoryWithIcon {
  id?: string;
  name: string;
  icon?: string;
}

export default function BudgetsPage() {
  const { user } = useAuth();
  const { selectedProjectId } = useProject();
  const { monthlyBudgets, fetchMonthlyBudgets, isLoading } = useBudget();
  const { categories } = useCategory();

  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [showCreateModal, setShowCreateModal] = useState(false);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;

  useEffect(() => {
    if (selectedProjectId) {
      fetchMonthlyBudgets(year, month, selectedProjectId);
    }
  }, [year, month, selectedProjectId, fetchMonthlyBudgets]);

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 2, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month, 1));
  };

  // 카테고리별 실제 사용액 계산 (나중에 transaction 데이터에서)
  const getUsedAmount = (budgetId: string, categoryId?: string): number => {
    // TODO: 실제 거래에서 월별 사용액 계산
    return 0;
  };

  // 전체 예산
  const totalBudget = monthlyBudgets.find((b) => !b.categoryId);
  const categoryBudgets = monthlyBudgets.filter((b) => b.categoryId);

  const getCategoryIcon = (categoryId?: string) => {
    if (!categoryId) return null;
    const category = categories.find((c) => c.id === categoryId);
    return category?.icon || null;
  };

  const getCategoryName = (categoryId?: string) => {
    if (!categoryId) return '전체예산';
    const category = categories.find((c) => c.id === categoryId);
    return category?.name || 'Unknown';
  };

  if (!selectedProjectId) {
    return <div className="p-4">프로젝트를 선택해주세요.</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-900">예산 관리</h1>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600"
            >
              <Plus size={20} />
              예산 추가
            </button>
          </div>

          {/* 월/년 선택 */}
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={handlePrevMonth}
              className="p-2 hover:bg-gray-100 rounded"
            >
              <ChevronLeft size={20} />
            </button>

            <div className="text-lg font-semibold text-gray-800 min-w-[150px] text-center">
              {year}년 {month}월
            </div>

            <button
              onClick={handleNextMonth}
              className="p-2 hover:bg-gray-100 rounded"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
      </div>

      {/* 본문 */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        {isLoading ? (
          <div className="text-center py-8">로딩 중...</div>
        ) : monthlyBudgets.length === 0 ? (
          <div className="bg-white rounded-lg p-8 text-center border border-gray-200">
            <p className="text-gray-600">설정된 예산이 없습니다.</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="mt-4 text-blue-500 hover:text-blue-600 font-semibold"
            >
              첫 예산 설정하기
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            {/* 전체 예산 */}
            {totalBudget && (
              <>
                <BudgetCard
                  categoryName="전체예산"
                  monthlyAmount={totalBudget.monthlyAmount}
                  usedAmount={getUsedAmount(totalBudget.budgetId)}
                  percentage={Math.round(
                    (getUsedAmount(totalBudget.budgetId) / totalBudget.monthlyAmount) * 100
                  )}
                  onEdit={() => console.log('edit total')}
                  onDelete={() => console.log('delete total')}
                />
                <div className="border-t-2 border-gray-300" />
              </>
            )}

            {/* 카테고리별 예산 */}
            <div>
              {categoryBudgets.map((budget, index) => (
                <BudgetCard
                  key={budget.budgetId}
                  categoryName={getCategoryName(budget.categoryId)}
                  icon={getCategoryIcon(budget.categoryId)}
                  monthlyAmount={budget.monthlyAmount}
                  usedAmount={getUsedAmount(budget.budgetId, budget.categoryId)}
                  percentage={Math.round(
                    (getUsedAmount(budget.budgetId, budget.categoryId) / budget.monthlyAmount) *
                      100
                  )}
                  onEdit={() => console.log('edit', budget.budgetId)}
                  onDelete={() => console.log('delete', budget.budgetId)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 생성 모달 (나중에 구현) */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h2 className="text-xl font-bold mb-4">예산 추가</h2>
            <div className="space-y-4">
              <button
                onClick={() => setShowCreateModal(false)}
                className="w-full p-2 text-gray-600 hover:bg-gray-100 rounded"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
