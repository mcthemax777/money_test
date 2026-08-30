'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@money/core/store/auth';
import { useProject } from '@money/core/store/project';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import {
  NO_SUB_CATEGORIES,
  useCategoryManager,
  type CategoryFormValues,
} from '@money/core/hooks/useCategoryManager';
import Modal from '@/components/Modal';
import CategoryFormFields from '@/components/CategoryFormFields';
import PageHeader from '@/components/PageHeader';
import type { Category } from '@money/core/lib/types';
import { useDragReorder } from '@/hooks/useDragReorder';

/** 하단 고정 버튼과 본문 form을 잇는 id (Modal의 footer는 form 밖에 렌더링된다) */
const FORM_ID = 'category-form';

/**
 * 지출·수입 두 단. 머리글 색은 가계 화면과 같다 (지출 빨강, 수입 초록).
 *
 * 넓은 화면은 두 단을 나란히 놓고, 좁은 화면은 탭으로 하나씩 보여 준다.
 */
const TYPE_PANELS: Array<{
  type: 'expense' | 'income';
  titleKey: MessageKey;
  emptyKey: MessageKey;
  text: string;
}> = [
  {
    type: 'expense',
    titleKey: 'categories.expenseTitle',
    emptyKey: 'categories.expenseEmpty',
    text: 'text-red-600',
  },
  {
    type: 'income',
    titleKey: 'categories.incomeTitle',
    emptyKey: 'categories.incomeEmpty',
    text: 'text-green-600',
  },
];


export default function CategoriesPage() {
  const { t } = useTranslation();
  const { loadUser } = useAuth();
  const { selectedProjectId } = useProject();
  const manager = useCategoryManager(selectedProjectId);
  const { categories, isLoading, isSubmitting } = manager;

  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [formData, setFormData] = useState<CategoryFormValues>({
    name: '',
    type: 'expense',
    subCategories: NO_SUB_CATEGORIES,
    defaultIsExtra: false,
  });
  /**
   * 좁은 화면에서 보고 있는 단. 넓은 화면에서는 두 단이 함께 보이므로 쓰이지 않는다.
   *
   * 화면 폭을 자바스크립트로 재지 않고 CSS로 가른다. 폭을 재면 첫 그림과 서버가
   * 그린 것이 어긋나 깜빡인다.
   */
  const [activeType, setActiveType] = useState<'expense' | 'income'>('expense');

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const handleModalClose = () => {
    setIsModalOpen(false);
    setFormData({
      name: '',
      type: 'expense',
      subCategories: NO_SUB_CATEGORIES,
      defaultIsExtra: false,
    });
    setEditingId(null);
    setError('');
  };

  const handleCategoryClick = (category: Category) => {
    setSelectedCategory(category);
    setIsDetailModalOpen(true);
  };

  /** 고칠 대상을 폼에 편다. 상세 팝업과 목록이 같은 경로를 쓴다. */
  const openEditor = (category: Category) => {
    setEditingId(category.id);
    setFormData(manager.formValuesOf(category));
    setIsModalOpen(true);
    setError('');
  };

  const handleDetailEditClick = () => {
    if (!selectedCategory) return;
    setIsDetailModalOpen(false);
    openEditor(selectedCategory);
  };

  const handleDeleteClick = async (id: string) => {
    if (!window.confirm(t('account.deleteConfirm'))) return;

    const result = await manager.remove(id);
    setError(result.ok ? '' : result.message);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const result = await manager.save(editingId, formData);
    if (!result.ok) {
      setError(result.message);
      return;
    }

    handleModalClose();
  };

  const handleReorder = async (ids: string[]) => {
    const result = await manager.reorder(ids);
    setError(result.ok ? '' : result.message);
  };

  const mainCategories = categories.filter((c) => !c.parentId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('categories.title')}
        action={
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            {t('categories.add')}
          </button>
        }
      />

      {isLoading ? (
        <p className="text-gray-600">{t('common.loading')}</p>
      ) : categories.length === 0 ? (
        <p className="text-gray-600">{t('categories.empty')}</p>
      ) : (
        <>
          {/*
            좁은 화면에서는 두 단이 세로로 쌓여 수입이 지출 목록 한참 아래로 밀린다.
            탭으로 하나씩 보여 준다. 두 단이 나란히 보이는 넓은 화면에서는 탭이
            고를 것이 없으므로 감춘다.

            고른 탭은 파랑이다. 분류별·결제수단 화면의 탭과 같은 색이라 "고른 것"이
            무엇을 뜻하는지 화면마다 다시 익힐 것이 없다.
          */}
          <div className="flex border-b border-gray-200 lg:hidden">
            {TYPE_PANELS.map((panel) => (
              <button
                key={panel.type}
                type="button"
                onClick={() => setActiveType(panel.type)}
                aria-pressed={activeType === panel.type}
                className={`flex-1 px-4 py-2 font-medium transition ${
                  activeType === panel.type
                    ? 'border-b-2 border-blue-600 text-blue-600'
                    : 'text-gray-600 hover:text-gray-800'
                }`}
              >
                {t(panel.titleKey)}
              </button>
            ))}
          </div>

          {/* 가계·자산 화면과 같은 2단 배치. 왼쪽 지출, 오른쪽 수입. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {TYPE_PANELS.map((panel) => {
              const cats = mainCategories.filter((c) => c.type === panel.type);

              return (
                <div
                  key={panel.type}
                  // 좁은 화면에서는 고른 단만 남긴다.
                  className={activeType === panel.type ? '' : 'hidden lg:block'}
                >
                  {/* 좁은 화면에서는 탭 글자가 같은 말을 하므로 머리글을 접는다. */}
                  <h2 className={`hidden lg:block text-lg font-bold ${panel.text} mb-4`}>
                    {t(panel.titleKey)}
                  </h2>
                  {cats.length === 0 ? (
                    <p className="text-gray-600">{t(panel.emptyKey)}</p>
                  ) : (
                    <CategoryList
                      cats={cats}
                      allCategories={categories}
                      onCategoryClick={handleCategoryClick}
                      onReorder={handleReorder}
                    />
                  )}
                </div>
              );
            })}
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
        title={t('categories.detail')}
        footer={
          selectedCategory ? (
            <div className="flex gap-2">
              <button
                onClick={handleDetailEditClick}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                {t('account.editSubmit')}
              </button>
              <button
                onClick={async () => {
                  setIsDetailModalOpen(false);
                  await handleDeleteClick(selectedCategory.id);
                }}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isSubmitting || selectedCategory.isDefault}
                title={selectedCategory.isDefault ? t('categories.deleteDefault') : ''}
              >
                {t('account.deleteSubmit')}
              </button>
            </div>
          ) : null
        }
      >
      {selectedCategory && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('categories.name')}
            </label>
            <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
              {selectedCategory.name}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('account.type')}
            </label>
            <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
              {t(selectedCategory.type === 'income' ? 'home.tab.income' : 'home.tab.expense')}
            </p>
          </div>

          {!selectedCategory.parentId && (
            <>
              {selectedCategory.defaultIsExtra && (
                <div className="px-3 py-2 bg-blue-50 text-blue-800 text-sm rounded-lg">
                  {t('categories.defaultExtra')}
                </div>
              )}
              {categories.filter((c) => c.parentId === selectedCategory.id).length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('categories.subcategories')}
                  </label>
                  <div className="space-y-2">
                    {categories
                      .filter((c) => c.parentId === selectedCategory.id)
                      .map((subCat) => (
                        <div key={subCat.id} className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900 text-sm flex items-center justify-between">
                          <span>{subCat.name}</span>
                          <span className="text-xs text-gray-500">
                            {subCat.isDefault && t('categories.defaultMark')}
                            {subCat.defaultIsExtra && t('categories.extraMark')}
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
        title={t(editingId ? 'categories.edit' : 'categories.add')}
        /* 버튼은 form 밖(하단 고정 영역)이라 form 속성으로 묶는다 */
        footer={
          <button
            type="submit"
            form={FORM_ID}
            disabled={isSubmitting || !formData.name.trim()}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting
              ? t(editingId ? 'account.editing' : 'account.adding')
              : t(editingId ? 'account.editSubmit' : 'account.addSubmit')}
          </button>
        }
      >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        <CategoryFormFields
          name={formData.name}
          onNameChange={(name) => setFormData({ ...formData, name })}
          type={formData.type}
          onTypeChange={(type) => setFormData({ ...formData, type })}
          subCategories={formData.subCategories}
          onSubCategoriesChange={(subCategories) => setFormData({ ...formData, subCategories })}
        />

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
  const { t } = useTranslation();
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
            {subCat.isDefault && t('categories.defaultMark')}
            {subCat.defaultIsExtra && t('categories.extraMark')}
          </span>
        </div>
      ))}
    </div>
  );
}
