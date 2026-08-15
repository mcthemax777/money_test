'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/store/auth';
import { useProject } from '@/store/project';
import { apiClient } from '@/lib/api-client';
import CustomSelect from '@/components/CustomSelect';
import Modal from '@/components/Modal';
import DashboardSidebar from '@/components/DashboardSidebar';

interface Category {
  id: string;
  name: string;
  type: 'income' | 'expense';
  icon?: string;
  parentId?: string | null;
  level: number;
  defaultIsFixed?: boolean;
  isDefault?: boolean;
}

export default function CategoriesPage() {
  const { isAuthenticated, loadUser } = useAuth();
  const router = useRouter();
  const { selectedProjectId } = useProject();
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    type: 'expense',
    subCategories: [{ id: '', name: '', defaultIsFixed: false }],
    defaultIsFixed: false,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  useEffect(() => {
    if (!isAuthenticated || !selectedProjectId) {
      if (!isAuthenticated) {
        router.push('/login');
      }
      return;
    }

    const loadCategories = async () => {
      try {
        setIsLoading(true);
        const data = await apiClient.getCategories(selectedProjectId);
        setCategories(data || []);
      } catch (err) {
        setError('카테고리 조회에 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    };

    loadCategories();
  }, [isAuthenticated, router, selectedProjectId]);

  const handleModalClose = () => {
    setIsModalOpen(false);
    setFormData({
      name: '',
      type: 'expense',
      subCategories: [{ id: '', name: '', defaultIsFixed: false }],
      defaultIsFixed: false,
    });
    setEditingId(null);
    setError('');
  };

  const handleCategoryClick = (category: Category) => {
    setSelectedCategory(category);
    setIsDetailModalOpen(true);
  };

  const handleDetailEditClick = () => {
    if (!selectedCategory) return;
    setEditingId(selectedCategory.id);
    let subCategories = [{ id: '', name: '', defaultIsFixed: false }];
    if (selectedCategory.level === 1) {
      const subs = categories
        .filter((c) => c.parentId === selectedCategory.id)
        .map((c) => ({ id: c.id, name: c.name, defaultIsFixed: c.defaultIsFixed || false }));
      subCategories = subs.length > 0 ? subs : [{ id: '', name: '', defaultIsFixed: false }];
    }
    setFormData({
      name: selectedCategory.name,
      type: selectedCategory.type,
      subCategories,
      defaultIsFixed: selectedCategory.defaultIsFixed || false,
    });
    setIsDetailModalOpen(false);
    setIsModalOpen(true);
    setError('');
  };

  const handleEditClick = (category: Category) => {
    setEditingId(category.id);
    let subCategories = [{ id: '', name: '', defaultIsFixed: false }];
    if (category.level === 1) {
      const subs = categories
        .filter((c) => c.parentId === category.id)
        .map((c) => ({ id: c.id, name: c.name, defaultIsFixed: c.defaultIsFixed || false }));
      subCategories = subs.length > 0 ? subs : [{ id: '', name: '', defaultIsFixed: false }];
    }
    setFormData({
      name: category.name,
      type: category.type,
      subCategories,
      defaultIsFixed: category.defaultIsFixed || false,
    });
    setIsModalOpen(true);
    setError('');
  };

  const handleDeleteClick = async (id: string) => {
    const category = categories.find((c) => c.id === id);
    if (category?.isDefault) {
      setError('기본 카테고리는 삭제할 수 없습니다.');
      return;
    }
    if (!window.confirm('정말 삭제하시겠습니까?')) return;
    try {
      setIsSubmitting(true);
      await apiClient.deleteCategory(id);
      const data = await apiClient.getCategories();
      setCategories(data || []);
    } catch (err: any) {
      const errorMsg = err?.response?.data?.error?.message || '카테고리 삭제에 실패했습니다.';
      setError(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 메인 카테고리명 검증
    if (!formData.name.trim()) {
      setError('카테고리명을 입력해주세요.');
      return;
    }

    // 소분류명 검증 (비어있는 소분류는 제거)
    const filteredSubCategories = formData.subCategories.filter((sub) => sub.name.trim());

    try {
      setIsSubmitting(true);
      if (editingId) {
        await apiClient.updateCategory(editingId, {
          name: formData.name,
          defaultIsFixed: formData.defaultIsFixed,
        });

        const existingSubs = categories.filter((c) => c.parentId === editingId);
        const newSubs = filteredSubCategories;

        // 제거된 소분류 삭제
        for (const existingSub of existingSubs) {
          if (!newSubs.some((sub) => sub.id === existingSub.id) && !existingSub.isDefault) {
            try {
              await apiClient.deleteCategory(existingSub.id);
            } catch (err: any) {
              const errorMsg = err?.response?.data?.error?.message;
              if (errorMsg && errorMsg.includes('거래')) {
                throw new Error(`'${existingSub.name}' 소분류는 거래 기록에서 사용 중이어서 삭제할 수 없습니다.`);
              }
              throw err;
            }
          }
        }

        // 수정된 소분류 업데이트, 새로운 소분류 생성
        for (const sub of newSubs) {
          if (sub.id) {
            // 기존 소분류 (수정)
            const existing = existingSubs.find((es) => es.id === sub.id);
            if (existing && (existing.name !== sub.name || existing.defaultIsFixed !== sub.defaultIsFixed)) {
              await apiClient.updateCategory(sub.id, {
                name: sub.name,
                defaultIsFixed: sub.defaultIsFixed,
              });
            }
          } else {
            // 새로운 소분류
            await apiClient.createCategory({
              name: sub.name,
              type: formData.type,
              parentId: editingId,
              defaultIsFixed: sub.defaultIsFixed,
            });
          }
        }
      } else {
        await apiClient.createCategory({
          name: formData.name,
          type: formData.type,
          defaultIsFixed: formData.defaultIsFixed,
        });
        const categoryList = await apiClient.getCategories();
        const mainCategory = categoryList?.find((c: Category) => c.name === formData.name && c.level === 1);

        if (mainCategory) {
          for (const sub of filteredSubCategories) {
            await apiClient.createCategory({
              name: sub.name,
              type: formData.type,
              parentId: mainCategory.id,
              defaultIsFixed: sub.defaultIsFixed,
            });
          }
        }
      }

      const data = await apiClient.getCategories();
      setCategories(data || []);
      setFormData({
        name: '',
        type: 'expense',
        subCategories: [{ id: '', name: '', defaultIsFixed: false }],
        defaultIsFixed: false,
      });
      setEditingId(null);
      setError('');
      setIsModalOpen(false);
    } catch (err: any) {
      setError(err?.message || (editingId ? '카테고리 수정에 실패했습니다.' : '카테고리 추가에 실패했습니다.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isAuthenticated) {
    return <div>로딩 중...</div>;
  }

  const mainCategories = categories.filter((c) => c.level === 1);
  const expenseCategories = mainCategories.filter((c) => c.type === 'expense');
  const incomeCategories = mainCategories.filter((c) => c.type === 'income');

  const renderCategoryList = (cats: Category[]) => (
    <div className="space-y-4">
      {cats.map((category) => (
        <div
          key={category.id}
          className="bg-white rounded-lg shadow p-4 cursor-pointer hover:shadow-lg transition"
          onClick={() => handleCategoryClick(category)}
        >
          <div className="flex items-center justify-between mb-2">
            <p className="font-bold text-gray-900">{category.name}</p>
          </div>

          {categories.filter((c) => c.parentId === category.id).length > 0 && (
            <div className="ml-4 mt-2 space-y-2 border-l border-gray-200 pl-4">
              {categories
                .filter((c) => c.parentId === category.id)
                .map((subCat) => (
                  <div key={subCat.id} className="text-sm text-gray-600 flex items-center justify-between">
                    <span>{subCat.name}</span>
                    <span className="text-xs text-gray-500">
                      {subCat.isDefault && '(기본)'}
                      {subCat.defaultIsFixed && ' 고정'}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardSidebar />
      <div className="md:ml-64 p-4">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">카테고리 관리</h1>
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            카테고리 추가
          </button>
        </div>

        {isLoading ? (
          <p className="text-gray-600">로딩 중...</p>
        ) : categories.length === 0 ? (
          <p className="text-gray-600">카테고리가 없습니다.</p>
        ) : (
          <>
            {expenseCategories.length > 0 && (
              <div className="mb-8">
                <h2 className="text-lg font-bold text-red-600 mb-4">💸 지출</h2>
                {renderCategoryList(expenseCategories)}
              </div>
            )}

            {incomeCategories.length > 0 && (
              <div className="mb-8">
                <h2 className="text-lg font-bold text-green-600 mb-4">💰 수입</h2>
                {renderCategoryList(incomeCategories)}
              </div>
            )}

            {error && (
              <div className="mt-4 p-3 bg-red-50 text-red-800 text-sm rounded">
                {error}
              </div>
            )}
            </>
        )}

        <Modal
          isOpen={isDetailModalOpen}
          onClose={() => setIsDetailModalOpen(false)}
          title="카테고리 상세정보"
        >
        {selectedCategory && (
          <div className="space-y-4 max-h-96 overflow-y-auto">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                카테고리명
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedCategory.name}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                유형
              </label>
              <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
                {selectedCategory.type === 'income' ? '수입' : '지출'}
              </p>
            </div>

            {selectedCategory.level === 1 && (
              <>
                {selectedCategory.defaultIsFixed && (
                  <div className="px-3 py-2 bg-blue-50 text-blue-800 text-sm rounded-lg">
                    ✓ 기본 고정 지출/수입
                  </div>
                )}
                {categories.filter((c) => c.parentId === selectedCategory.id).length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      소분류
                    </label>
                    <div className="space-y-2">
                      {categories
                        .filter((c) => c.parentId === selectedCategory.id)
                        .map((subCat) => (
                          <div key={subCat.id} className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900 text-sm flex items-center justify-between">
                            <span>{subCat.name}</span>
                            <span className="text-xs text-gray-500">
                              {subCat.isDefault && '(기본)'}
                              {subCat.defaultIsFixed && ' 고정'}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="flex gap-2 pt-4 sticky bottom-0 bg-white">
              <button
                onClick={handleDetailEditClick}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                수정하기
              </button>
              <button
                onClick={async () => {
                  setIsDetailModalOpen(false);
                  await handleDeleteClick(selectedCategory.id);
                }}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isSubmitting || selectedCategory.isDefault}
                title={selectedCategory.isDefault ? '기본 카테고리는 삭제할 수 없습니다.' : ''}
              >
                삭제하기
              </button>
            </div>
          </div>
        )}
        </Modal>

        <Modal
          isOpen={isModalOpen}
          onClose={handleModalClose}
          title={editingId ? '카테고리 수정' : '카테고리 추가'}
        >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              대분류 이름
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="예: 음식"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              유형
            </label>
            <CustomSelect
              options={[
                { id: 'expense', name: '지출' },
                { id: 'income', name: '수입' },
              ]}
              value={formData.type}
              onChange={(value) => setFormData({ ...formData, type: value as any })}
              placeholder="선택하세요"
            />
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="defaultIsFixed"
              checked={formData.defaultIsFixed}
              onChange={(e) => setFormData({ ...formData, defaultIsFixed: e.target.checked })}
              className="w-4 h-4 border border-gray-300 rounded-md focus:ring-blue-500"
            />
            <label htmlFor="defaultIsFixed" className="text-sm font-medium text-gray-700">
              기본 고정 지출/수입
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              소분류 (선택)
            </label>
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {formData.subCategories.map((subCat, index) => (
                <div key={index} className="p-3 border border-gray-200 rounded-lg space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={subCat.name}
                      onChange={(e) => {
                        const newSubs = [...formData.subCategories];
                        newSubs[index] = { ...newSubs[index], name: e.target.value };
                        setFormData({ ...formData, subCategories: newSubs });
                      }}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="소분류 이름"
                    />
                    {formData.subCategories.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          const newSubs = formData.subCategories.filter((_, i) => i !== index);
                          setFormData({ ...formData, subCategories: newSubs });
                        }}
                        className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg"
                      >
                        제거
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`subFixed-${index}`}
                      checked={subCat.defaultIsFixed || false}
                      onChange={(e) => {
                        const newSubs = [...formData.subCategories];
                        newSubs[index] = { ...newSubs[index], defaultIsFixed: e.target.checked };
                        setFormData({ ...formData, subCategories: newSubs });
                      }}
                      className="w-4 h-4 border border-gray-300 rounded-md focus:ring-blue-500"
                    />
                    <label htmlFor={`subFixed-${index}`} className="text-xs font-medium text-gray-600">
                      고정 지출/수입
                    </label>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setFormData({ ...formData, subCategories: [...formData.subCategories, { id: '', name: '', defaultIsFixed: false }] })}
              className="mt-2 px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
            >
              소분류 추가
            </button>
          </div>

          {error && (
            <div className="p-3 bg-red-50 text-red-800 text-sm rounded">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || !formData.name.trim()}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (editingId ? '수정 중...' : '추가 중...') : (editingId ? '수정하기' : '추가하기')}
          </button>
        </form>
        </Modal>
      </div>
    </div>
  );
}
