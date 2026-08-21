'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/store/auth';
import { useProject } from '@/store/project';
import { apiClient } from '@/lib/api-client';
import CustomSelect from '@/components/CustomSelect';
import Modal from '@/components/Modal';
import PageHeader from '@/components/PageHeader';
import type { Category } from '@/lib/types';
import { useDragReorder } from '@/hooks/useDragReorder';

/** 하단 고정 버튼과 본문 form을 잇는 id (Modal의 footer는 form 밖에 렌더링된다) */
const FORM_ID = 'category-form';

/** 소분류 입력 한 줄 */
type SubCategoryRow = { id: string; name: string; defaultIsFixed: boolean };

/**
 * 소분류는 빈 줄 없이 시작한다.
 *
 * 예전에는 빈 줄 하나를 미리 넣어 두어서, 소분류가 필요 없는데도 항상 빈 입력칸이
 * 보였다. 필요하면 "소분류 추가" 버튼으로 늘린다.
 */
const NO_SUB_CATEGORIES: SubCategoryRow[] = [];


export default function CategoriesPage() {
  const { isAuthenticated, loadUser } = useAuth();
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
    type: 'expense' as 'income' | 'expense',
    subCategories: NO_SUB_CATEGORIES as SubCategoryRow[],
    defaultIsFixed: false,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  // 로그인 확인과 리디렉트는 AppShell(레이아웃)이 담당한다.
  useEffect(() => {
    if (!isAuthenticated || !selectedProjectId) return;

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
  }, [isAuthenticated, selectedProjectId]);

  const handleModalClose = () => {
    setIsModalOpen(false);
    setFormData({
      name: '',
      type: 'expense',
      subCategories: NO_SUB_CATEGORIES,
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
    let subCategories: SubCategoryRow[] = NO_SUB_CATEGORIES;
    if (!selectedCategory.parentId) {
      const subs = categories
        .filter((c) => c.parentId === selectedCategory.id)
        .map((c) => ({ id: c.id, name: c.name, defaultIsFixed: c.defaultIsFixed || false }));
      subCategories = subs;
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
    let subCategories: SubCategoryRow[] = NO_SUB_CATEGORIES;
    if (!category.parentId) {
      const subs = categories
        .filter((c) => c.parentId === category.id)
        .map((c) => ({ id: c.id, name: c.name, defaultIsFixed: c.defaultIsFixed || false }));
      subCategories = subs;
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
        const mainCategory = categoryList?.find((c: Category) => c.name === formData.name && !c.parentId);

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
        subCategories: NO_SUB_CATEGORIES,
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

  /** 드래그로 바꾼 순서를 저장한다. 실패하면 목록을 다시 받아 원래 순서로 되돌린다. */
  const handleReorder = async (ids: string[]) => {
    try {
      const updated = await apiClient.reorderCategories(ids, selectedProjectId);
      setCategories(updated as Category[]);
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || '순서 저장에 실패했습니다.');
      // 저장이 실패했으면 화면에 남은 순서가 서버와 다르다. 다시 받아 맞춘다.
      const data = await apiClient.getCategories(selectedProjectId);
      setCategories(data || []);
    }
  };

  const mainCategories = categories.filter((c) => !c.parentId);
  const expenseCategories = mainCategories.filter((c) => c.type === 'expense');
  const incomeCategories = mainCategories.filter((c) => c.type === 'income');

  return (
    <div className="space-y-6">
      <PageHeader
        title="카테고리"
        action={
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            카테고리 추가
          </button>
        }
      />

      {isLoading ? (
        <p className="text-gray-600">로딩 중...</p>
      ) : categories.length === 0 ? (
        <p className="text-gray-600">카테고리가 없습니다.</p>
      ) : (
        <>
          {/* 가계·자산 화면과 같은 2단 배치. 왼쪽 지출, 오른쪽 수입. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div>
              <h2 className="text-lg font-bold text-red-600 mb-4">💸 지출</h2>
              {expenseCategories.length === 0 ? (
                <p className="text-gray-600">지출 카테고리가 없습니다.</p>
              ) : (
                <CategoryList
                  cats={expenseCategories}
                  allCategories={categories}
                  onCategoryClick={handleCategoryClick}
                  onReorder={handleReorder}
                />
              )}
            </div>

            <div>
              <h2 className="text-lg font-bold text-green-600 mb-4">💰 수입</h2>
              {incomeCategories.length === 0 ? (
                <p className="text-gray-600">수입 카테고리가 없습니다.</p>
              ) : (
                <CategoryList
                  cats={incomeCategories}
                  allCategories={categories}
                  onCategoryClick={handleCategoryClick}
                  onReorder={handleReorder}
                />
              )}
            </div>
          </div>

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
        footer={
          selectedCategory ? (
            <div className="flex gap-2">
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
          ) : null
        }
      >
      {selectedCategory && (
        <div className="space-y-4">
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

          {!selectedCategory.parentId && (
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

        </div>
      )}
      </Modal>

      <Modal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        title={editingId ? '카테고리 수정' : '카테고리 추가'}
        /* 버튼은 form 밖(하단 고정 영역)이라 form 속성으로 묶는다 */
        footer={
          <button
            type="submit"
            form={FORM_ID}
            disabled={isSubmitting || !formData.name.trim()}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (editingId ? '수정 중...' : '추가 중...') : (editingId ? '수정하기' : '추가하기')}
          </button>
        }
      >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
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

        <div>
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {formData.subCategories.map((subCat, index) => (
              <div key={index} className="p-3 border border-gray-200 rounded-lg">
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

      </form>
      </Modal>
    </div>
  );
}

/**
 * 대분류 목록. 드래그로 순서를 바꾼다.
 *
 * 소분류도 같은 방식으로 정렬한다. 안쪽 드래그가 바깥 목록을 흔들지 않도록
 * useDragReorder가 이벤트 전파를 끊는다.
 */
function CategoryList({
  cats,
  allCategories,
  onCategoryClick,
  onReorder,
}: {
  cats: Category[];
  allCategories: Category[];
  onCategoryClick: (category: Category) => void;
  onReorder: (ids: string[]) => void;
}) {
  const { items, dragProps, draggingId } = useDragReorder(cats, onReorder);

  return (
    <div className="space-y-4">
      {items.map((category) => (
        <div
          key={category.id}
          {...dragProps(category.id)}
          className={`bg-white rounded-lg shadow p-4 cursor-pointer hover:shadow-lg transition ${
            draggingId === category.id ? 'opacity-50' : ''
          }`}
          onClick={() => onCategoryClick(category)}
        >
          <div className="flex items-center justify-between mb-2">
            <p className="font-bold text-gray-900">
              {category.name}
            </p>
          </div>

          <SubCategoryList
            subCats={allCategories.filter((c) => c.parentId === category.id)}
            onReorder={onReorder}
          />
        </div>
      ))}
    </div>
  );
}

/** 한 대분류 아래 소분류 목록 */
function SubCategoryList({
  subCats,
  onReorder,
}: {
  subCats: Category[];
  onReorder: (ids: string[]) => void;
}) {
  const { items, dragProps, draggingId } = useDragReorder(subCats, onReorder);
  if (items.length === 0) return null;

  return (
    <div className="ml-4 mt-2 space-y-2 border-l border-gray-200 pl-4">
      {items.map((subCat) => (
        <div
          key={subCat.id}
          {...dragProps(subCat.id)}
          className={`text-sm text-gray-600 flex items-center justify-between ${
            draggingId === subCat.id ? 'opacity-50' : ''
          }`}
        >
          <span>
            {subCat.name}
          </span>
          <span className="text-xs text-gray-500">
            {subCat.isDefault && '(기본)'}
            {subCat.defaultIsFixed && ' 고정'}
          </span>
        </div>
      ))}
    </div>
  );
}
