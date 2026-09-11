'use client';

import { useEffect, useState } from 'react';
import { Receipt } from 'lucide-react';
import { useAuth } from '@money/core/store/auth';
import { useCanEdit, useProject } from '@money/core/store/project';
import { EMPTY_SEARCH, type TransactionSearch } from '@money/core/hooks/useTransactions';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import {
  NO_SUB_CATEGORIES,
  useCategoryManager,
  type CategoryFormValues,
} from '@money/core/hooks/useCategoryManager';
import Modal from '@/components/Modal';
import CategoryFormFields from '@/components/CategoryFormFields';
import AddButton from '@/components/AddButton';
import PageHeader from '@/components/PageHeader';
import TagsPanel from '@/components/TagsPanel';
import TransactionsView from '@/components/TransactionsView';
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


/** 거래내역을 펼쳐 놓은 대상. 돌아올 때 이 자리의 상세를 다시 편다. */
type EntriesTarget = { kind: 'category' | 'tag'; id: string };

export default function CategoriesPage() {
  const { t } = useTranslation();
  /** 읽기 전용 구성원에게는 쓰기 단추를 그리지 않는다. */
  const canEdit = useCanEdit();
  const { loadUser } = useAuth();
  const { selectedProjectId } = useProject();
  const manager = useCategoryManager(selectedProjectId);
  const { categories, isLoading, isSubmitting } = manager;
  /**
   * 지금 이 자리에 펼쳐 둔 거래내역. null 이면 평소의 분류·태그 화면이다.
   *
   * 거래 탭으로 넘기지 않는다. 분류를 보다가 그 분류의 거래를 들여다보는 일은 분류
   * 화면 안에서 끝나는 한 걸음이라, 넘겨 두면 돌아오는 길이 탭을 되짚는 길이 된다.
   */
  const [entries, setEntries] = useState<{ target: EntriesTarget; search: TransactionSearch } | null>(
    null,
  );
  /** 거래내역에서 ← 로 돌아왔을 때 다시 펼 상세. 펴고 나면 비운다. */
  const [reopen, setReopen] = useState<EntriesTarget | null>(null);

  const [error, setError] = useState('');
  /*
   * 카테고리와 태그. 둘 다 "거래를 무엇으로 묶어 보나"를 정하는 일이라 한 화면에 둔다.
   *
   * 태그는 계층이 없어 화면 하나를 따로 둘 만큼 크지 않고, 사이드바에 항목을 하나 더
   * 늘리면 자주 가지 않는 자리가 늘 목록을 차지한다.
   */
  const [section, setSection] = useState<'categories' | 'tags'>('categories');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [formData, setFormData] = useState<CategoryFormValues>({
    name: '',
    type: 'expense',
    subCategories: NO_SUB_CATEGORIES,
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

  /*
   * 거래 화면에서 ←로 돌아왔을 때 떠나온 상세를 다시 편다.
   *
   * 분류는 목록이 도착해야 그 분류를 찾을 수 있으므로 목록이 올 때까지 기다린다.
   * 태그는 태그 판이 제 목록을 들고 있어 그쪽에서 편다 -- 여기서는 그 탭으로 옮겨
   * 판이 화면에 서게만 해 준다.
   */
  useEffect(() => {
    if (!reopen) return;
    if (reopen.kind === 'tag') {
      setSection('tags');
      return;
    }

    const category = categories.find((item) => item.id === reopen.id);
    if (!category) return;

    setSection('categories');
    setSelectedCategory(category);
    setIsDetailModalOpen(true);
    setReopen(null);
  }, [reopen, categories]);

  const handleModalClose = () => {
    setIsModalOpen(false);
    setFormData({
      name: '',
      type: 'expense',
      subCategories: NO_SUB_CATEGORIES,
    });
    setEditingId(null);
    setError('');
  };

  /** 그 단에서 새로 만들기. 유형을 미리 골라 두면 폼에서 다시 고를 일이 없다. */
  const openNewIn = (type: 'expense' | 'income') => {
    setEditingId(null);
    setFormData({ name: '', type, subCategories: NO_SUB_CATEGORIES });
    setIsModalOpen(true);
    setError('');
  };

  /**
   * 이 분류로 걸린 거래내역을 본다.
   *
   * 대분류를 고르면 그 아래 소분류와, 소분류 없이 대분류에 바로 적은 거래까지 걸린다
   * (서버의 검색 규칙). 상세에서 보고 있는 그 분류의 거래가 그대로 나오는 셈이다.
   */
  const showEntriesOf = (category: Category) => {
    setEntries({
      target: { kind: 'category', id: category.id },
      search: { ...EMPTY_SEARCH, categoryIds: [category.id] },
    });
    setIsDetailModalOpen(false);
  };

  /** 거래내역을 접고 떠나온 상세로 돌아간다. */
  const closeEntries = () => {
    if (!entries) return;
    setReopen(entries.target);
    setEntries(null);
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

  /*
   * 거래내역을 펼쳐 둔 동안에는 그것만 그린다.
   *
   * 분류 목록을 아래에 남겨 두면 한 화면에 목록 둘이 서서 어느 것을 보고 있는지가
   * 흐려진다. 거래 화면이 제 머리글(제목·검색·보기 방식)을 그대로 들고 오므로,
   * 돌아가는 길인 ← 만 얹어 주면 된다.
   */
  if (entries) {
    return (
      <TransactionsView
        projectId={selectedProjectId}
        search={entries.search}
        onBack={closeEntries}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/*
        추가 버튼은 머리글이 아니라 **목록 바로 위**에 있다 (자산 화면과 같은 규칙).
        무엇에 더하는 것인지가 버튼 아래에 곧바로 이어져 보인다.
      */}
      <PageHeader title={t('nav.categories')} />

      {/*
        보기 방식. 흰 알약을 하나 두고 옮긴다 -- 칸마다 바탕을 켜고 끄면 두 탭이 한 줄에
        나란한 것인지 서로 다른 화면인지 흐려진다 (거래 화면과 같은 규칙).
      */}
      <div className="relative flex gap-2 rounded-lg bg-gray-200 p-1">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-1 left-1 rounded-md bg-white transition-transform duration-200 ease-out motion-reduce:transition-none"
          style={{
            width: 'calc((100% - 1rem) / 2)',
            // 여기서의 100% 는 알약 자신의 폭, 곧 칸 하나다.
            transform: `translateX(calc(${section === 'tags' ? 1 : 0} * (100% + 0.5rem)))`,
          }}
        />
        {(['categories', 'tags'] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            /* 바탕은 위의 알약이 맡는다. 글자가 그 위에 오도록 자리를 잡아 준다. */
            className={`relative flex-1 rounded-md px-4 py-2 font-medium ${
              section === id ? 'text-blue-600' : 'text-gray-600'
            }`}
          >
            {t(id === 'tags' ? 'tags.tab' : 'categories.title')}
          </button>
        ))}
      </div>

      {section === 'tags' ? (
        <TagsPanel
          projectId={selectedProjectId}
          /* 태그 창의 "거래내역 보기". 펼치는 일은 이 화면이 맡는다. */
          onShowEntries={(tag) =>
            setEntries({
              target: { kind: 'tag', id: tag.id },
              search: { ...EMPTY_SEARCH, tagIds: [tag.id] },
            })
          }
          /* 거래내역에서 돌아왔을 때 다시 펼 태그. 펴고 나면 태그 판이 알려 준다. */
          reopenTagId={reopen?.kind === 'tag' ? reopen.id : null}
          onReopened={() => setReopen(null)}
        />
      ) : isLoading && categories.length === 0 ? (
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
                  {/* 그 단의 유형(지출·수입)을 미리 골라 연다. 어느 목록 위의 버튼인지가 곧 답이다. */}
                  <AddButton label={t('categories.add')} onClick={() => openNewIn(panel.type)} />
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
        /*
          이 분류의 거래내역으로 건너간다. 머리글 오른쪽에 둔다 -- 아래 단추 자리는
          이 분류를 고치고 지우는 자리이고, 이것은 분류를 건드리지 않는 다른 일이다.
        */
        headerAction={
          selectedCategory ? (
            <button
              type="button"
              onClick={() => showEntriesOf(selectedCategory)}
              aria-label={t('categories.viewEntries')}
              title={t('categories.viewEntries')}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-900 transition-colors hover:bg-gray-100"
            >
              <Receipt className="h-4 w-4" aria-hidden />
            </button>
          ) : null
        }
        footer={
          /* 읽기 전용 구성원에게는 손댈 단추가 없다. 상세는 그대로 읽힌다. */
          selectedCategory && canEdit ? (
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
          </span>
        </div>
      ))}
    </div>
  );
}
