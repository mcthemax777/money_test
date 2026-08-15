'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/store/auth';
import { useProject } from '@/store/project';
import { useBudget } from '@/store/budget';
import { useCategory } from '@/store/category';
import { BudgetCard } from '@/components/BudgetCard';
import DashboardSidebar from '@/components/DashboardSidebar';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';

interface CreateBudgetForm {
  categoryId?: string;
  monthlyAmount: number;
}

export default function BudgetsPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const { selectedProjectId } = useProject();
  const { monthlyBudgets, fetchMonthlyBudgets, isLoading, createBudget, updateBudget, deleteBudget } = useBudget();
  const { categories, fetchCategories } = useCategory();

  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingBudgetId, setEditingBudgetId] = useState<string | null>(null);
  const [formData, setFormData] = useState<CreateBudgetForm>({ monthlyAmount: 0 });
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 인증 확인
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, router]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;

  // 카테고리 로드
  useEffect(() => {
    if (selectedProjectId) {
      fetchCategories(selectedProjectId, 'expense');
    }
  }, [selectedProjectId, fetchCategories]);

  // 월별 예산 로드
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

  const handleOpenCreate = () => {
    setEditingBudgetId(null);
    setFormData({ monthlyAmount: 0 });
    setError('');
    setShowCreateModal(true);
  };

  const handleOpenEdit = (budget: any) => {
    setEditingBudgetId(budget.budgetId);
    setFormData({
      categoryId: budget.categoryId,
      monthlyAmount: budget.monthlyAmount,
    });
    setError('');
    setShowCreateModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!formData.monthlyAmount || formData.monthlyAmount <= 0) {
      setError('예산 금액을 입력해주세요.');
      return;
    }

    try {
      setIsSubmitting(true);

      if (editingBudgetId) {
        // 수정
        await updateBudget(editingBudgetId, {
          categoryId: formData.categoryId,
          monthlyAmount: formData.monthlyAmount,
        });
      } else {
        // 생성
        if (!selectedProjectId) return;
        await createBudget({
          projectId: selectedProjectId,
          categoryId: formData.categoryId,
          monthlyAmount: formData.monthlyAmount,
        });
      }

      setShowCreateModal(false);
      // 데이터 새로고침
      if (selectedProjectId) {
        await fetchMonthlyBudgets(year, month, selectedProjectId);
      }
    } catch (err: any) {
      setError(err.message || '저장에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (budgetId: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;

    try {
      await deleteBudget(budgetId);
      // 데이터 새로고침
      if (selectedProjectId) {
        await fetchMonthlyBudgets(year, month, selectedProjectId);
      }
    } catch (err) {
      alert('삭제에 실패했습니다.');
    }
  };

  // 카테고리별 실제 사용액 계산 (나중에 transaction 데이터에서)
  const getUsedAmount = (): number => {
    // TODO: 실제 거래에서 월별 사용액 계산
    return 0;
  };

  const getCategoryIcon = (categoryId?: string) => {
    if (!categoryId) return null;
    const category = categories.find((c) => c.id === categoryId);
    return category?.icon || '📁';
  };

  const getCategoryName = (categoryId?: string) => {
    if (!categoryId) return '전체예산';
    const category = categories.find((c) => c.id === categoryId);
    return category?.name || 'Unknown';
  };

  if (!isAuthenticated) {
    return <div className="p-4">로그인이 필요합니다.</div>;
  }

  if (!selectedProjectId) {
    return <div className="p-4">프로젝트를 선택해주세요.</div>;
  }

  if (!isAuthenticated) {
    return <div className="p-4">로그인이 필요합니다.</div>;
  }

  const totalBudget = monthlyBudgets.find((b) => !b.categoryId);
  const categoryBudgets = monthlyBudgets.filter((b) => b.categoryId);

  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardSidebar />
      <div className="md:ml-64">
      {/* 헤더 */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-900">예산 관리</h1>
            <button
              onClick={handleOpenCreate}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
            >
              <Plus size={20} />
              예산 추가
            </button>
          </div>

          {/* 월/년 선택 */}
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={handlePrevMonth}
              className="p-2 hover:bg-gray-100 rounded transition"
            >
              <ChevronLeft size={20} />
            </button>

            <div className="text-lg font-semibold text-gray-800 min-w-[150px] text-center">
              {year}년 {month}월
            </div>

            <button
              onClick={handleNextMonth}
              className="p-2 hover:bg-gray-100 rounded transition"
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
            <p className="text-gray-600 mb-2">설정된 예산이 없습니다.</p>
            <button
              onClick={handleOpenCreate}
              className="mt-4 text-blue-600 hover:text-blue-700 font-semibold"
            >
              첫 예산 설정하기
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200">
            {/* 전체 예산 */}
            {totalBudget && (
              <>
                <BudgetCard
                  categoryName="전체예산"
                  monthlyAmount={totalBudget.monthlyAmount}
                  usedAmount={getUsedAmount()}
                  percentage={Math.round((getUsedAmount() / totalBudget.monthlyAmount) * 100)}
                  onEdit={() => handleOpenEdit(totalBudget)}
                  onDelete={() => handleDelete(totalBudget.budgetId)}
                />
                <div className="border-t-2 border-gray-300" />
              </>
            )}

            {/* 카테고리별 예산 */}
            <div>
              {categoryBudgets.map((budget) => (
                <BudgetCard
                  key={budget.budgetId}
                  categoryName={getCategoryName(budget.categoryId)}
                  icon={getCategoryIcon(budget.categoryId)}
                  monthlyAmount={budget.monthlyAmount}
                  usedAmount={getUsedAmount()}
                  percentage={Math.round((getUsedAmount() / budget.monthlyAmount) * 100)}
                  onEdit={() => handleOpenEdit(budget)}
                  onDelete={() => handleDelete(budget.budgetId)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 생성/수정 모달 */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">{editingBudgetId ? '예산 수정' : '예산 추가'}</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1 hover:bg-gray-100 rounded"
              >
                <X size={20} />
              </button>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 rounded text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* 카테고리 선택 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  카테고리 (선택사항 - 미선택 시 전체 예산)
                </label>
                <select
                  value={formData.categoryId || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      categoryId: e.target.value || undefined,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">전체 예산</option>
                  {categories
                    .filter((c) => c.level === 1)
                    .map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                </select>
              </div>

              {/* 월 예산 금액 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  월 예산 금액
                </label>
                <input
                  type="number"
                  min="0"
                  value={formData.monthlyAmount}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      monthlyAmount: parseInt(e.target.value) || 0,
                    })
                  }
                  placeholder="예산 금액을 입력하세요"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* 버튼 */}
              <div className="flex gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                >
                  {isSubmitting ? '저장 중...' : editingBudgetId ? '수정' : '추가'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
