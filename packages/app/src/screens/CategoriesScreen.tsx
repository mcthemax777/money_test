import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Receipt } from 'lucide-react-native';

import {
  NO_SUB_CATEGORIES,
  useCategoryManager,
  type CategoryFormValues,
} from '@money/core/hooks/useCategoryManager';
import { EMPTY_SEARCH } from '@money/core/hooks/useTransactions';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import type { Category } from '@money/core/lib/types';
import type { CategoryDto } from '@money/types';
import { useEntryFocus } from '@money/core/store/entry-focus';
import { useProject } from '@money/core/store/project';

import { useNavigation } from '../shell/navigation';

import Modal from '../components/Modal';
import AddButton from '../components/AddButton';
import CategoryFormFields from '../components/CategoryFormFields';
import CategoryMergeModal from '../components/CategoryMergeModal';
import MoveRow from '../components/MoveRow';
import PageHeader from '../components/PageHeader';
import SegmentedTabs from '../components/SegmentedTabs';
import TagsPanel from '../components/TagsPanel';
import DragList from '../components/DragList';

/**
 * 지출·수입 두 단. 머리글 색은 가계 화면과 같다 (지출 빨강, 수입 초록).
 *
 * 넓은 화면은 두 단을 나란히 놓고, 좁은 화면은 탭으로 하나씩 보여 준다. 웹과 같다.
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

const EMPTY_FORM: CategoryFormValues = {
  name: '',
  type: 'expense',
  subCategories: NO_SUB_CATEGORIES,
};

/** 카테고리 화면. 웹의 /categories 와 같은 배치다. */
export default function CategoriesScreen() {
  const { t } = useTranslation();
  const selectedProjectId = useProject((state) => state.selectedProjectId);
  const manager = useCategoryManager(selectedProjectId);
  const { categories, isLoading, isSubmitting } = manager;
  const nav = useNavigation();
  /** 거래 화면과 주고받는 쪽지. 건너갈 때 걸 검색과 돌아와서 다시 펼 상세가 담긴다. */
  const focusEntries = useEntryFocus((state) => state.focusEntries);
  const reopen = useEntryFocus((state) => state.reopen);
  const clearReopen = useEntryFocus((state) => state.clearReopen);

  const [error, setError] = useState('');
  /** 잘 끝난 일을 적는 줄. 오류와 색이 달라야 해서 따로 든다. */
  const [notice, setNotice] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  /**
   * 없애려다 거래에 막힌 분류. 이 값이 있으면 "어떻게 할까요" 창이 선다.
   *
   * 통합 창과 따로 든다 -- 무엇을 할지 고르는 자리와 옮길 곳을 고르는 자리는 되돌아갈
   * 수 있어야 하는 두 걸음이다.
   */
  const [inUseId, setInUseId] = useState<string | null>(null);
  /** 옮길 곳을 고르는 중인 분류. 위의 창에서 "통합하기"를 누르면 여기로 넘어온다. */
  const [mergeId, setMergeId] = useState<string | null>(null);
  /**
   * 없애려는 분류와 그 소분류의 거래 수. 열쇠는 분류 id 다.
   *
   * 통합 창이 이 값으로 **거래가 있는 줄에만** 갈 곳을 묻는다. 없앨 때 한 번 읽어 두고
   * 창이 닫힐 때까지 그대로 쓴다 -- 창 안에서 다시 읽을 까닭이 없다.
   */
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [formData, setFormData] = useState<CategoryFormValues>(EMPTY_FORM);
  /** 좁은 화면에서 보고 있는 단. 넓은 화면에서는 두 단이 함께 보이므로 쓰이지 않는다. */
  const [activeType, setActiveType] = useState<'expense' | 'income'>('expense');
  /*
   * 카테고리와 태그. 둘 다 "거래를 무엇으로 묶어 보나"를 정하는 일이라 한 화면에 둔다.
   *
   * 태그는 계층이 없어 화면 하나를 따로 둘 만큼 크지 않고, 아래 탭을 하나 더 늘리면
   * 자주 가지 않는 자리가 늘 화면 아래를 차지한다.
   */
  const [section, setSection] = useState<'categories' | 'tags'>('categories');

  const closeForm = () => {
    setIsModalOpen(false);
    setFormData(EMPTY_FORM);
    setEditingId(null);
    setError('');
  };

  /** 그 단에서 새로 만들기. 유형을 미리 골라 두면 폼에서 다시 고를 일이 없다. */
  const openNewIn = (type: 'expense' | 'income') => {
    setEditingId(null);
    setFormData({ ...EMPTY_FORM, type });
    setIsModalOpen(true);
    setError('');
  };

  /*
   * 거래 화면에서 ←로 돌아왔을 때 떠나온 상세를 다시 편다.
   *
   * 분류는 목록이 도착해야 그 분류를 찾을 수 있으므로 올 때까지 기다린다. 태그는
   * 태그 판이 제 목록을 들고 있어 그쪽에서 편다 -- 여기서는 그 탭으로 옮겨 판이
   * 화면에 서게만 해 준다.
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
    clearReopen();
  }, [reopen, categories, clearReopen]);

  /**
   * 이 분류로 걸린 거래내역을 본다.
   *
   * 대분류를 고르면 그 아래 소분류와, 소분류 없이 대분류에 바로 적은 거래까지 걸린다
   * (서버의 검색 규칙). 상세에서 보고 있는 그 분류의 거래가 그대로 나오는 셈이다.
   */
  const showEntriesOf = (category: Category) => {
    focusEntries(
      { kind: 'category', id: category.id },
      { ...EMPTY_SEARCH, categoryIds: [category.id] },
    );
    setIsDetailModalOpen(false);
    nav.go('/transactions');
  };

  const openEditor = (category: Category) => {
    setEditingId(category.id);
    setFormData(manager.formValuesOf(category));
    setIsModalOpen(true);
    setError('');
  };

  const submit = async () => {
    const result = await manager.save(editingId, formData);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    closeForm();
  };

  /**
   * 없애기. 거래에 쓰이고 있으면 막히는데, 그때는 길을 둘 내준다.
   *
   * 예전에는 "삭제할 수 없습니다" 한 줄로 끝났다. 그 분류를 정리하려면 거래를 하나씩
   * 찾아 고쳐야 했고, 어디에 몇 건이 있는지도 화면에 없었다.
   */
  const remove = async (id: string) => {
    setNotice('');

    /*
     * 거래가 있으면 없애려 들지 않고 곧바로 길을 내준다.
     *
     * 어차피 막히는 일이라(사본도 서버와 같은 규칙으로 막는다) 한 번 다녀오는 걸음이
     * 헛수고다. 거래가 있다는 것을 먼저 알았으니 바로 그 창을 연다.
     */
    const counts = await manager.usageOf(id);
    if (counts && Object.values(counts).some((count) => count > 0)) {
      setError('');
      setUsage(counts);
      setInUseId(id);
      return;
    }

    const result = await manager.remove(id);
    if (result.ok) {
      setError('');
      return;
    }

    if (result.inUse) {
      // 거래 수를 못 읽었던 경우다. 막힌 이유는 창이 말하므로 오류 줄은 띄우지 않는다.
      setError('');
      setUsage(counts ?? {});
      setInUseId(id);
      return;
    }
    setError(result.message);
  };

  /**
   * 옮기고 없앤다. 끝나면 몇 건이 옮겨졌는지 알린다.
   *
   * 알림이 필요한 까닭이 있다. 이 일은 거래 수백 건을 한꺼번에 옮기는데, 끝나고 나면
   * 화면에서 사라지는 것은 분류 한 줄뿐이라 무슨 일이 일어났는지 볼 곳이 없다.
   */
  const merge = async (moves: CategoryDto.MergeMove[]) => {
    const result = await manager.merge(moves);
    if (result.ok) {
      setMergeId(null);
      setIsDetailModalOpen(false);
      setNotice(t('categories.mergeDone', { count: result.movedPostings ?? 0 }));
    }
    return result;
  };

  /**
   * 한 칸 옮긴다. 누르는 즉시 저장된다.
   *
   * 이름 고치기와 달리 폼을 거치지 않는다. 옮긴 결과가 곧바로 목록에 보여야 다음에
   * 어느 쪽을 눌러야 하는지 알 수 있다. 이웃은 훅이 고른다 -- 소분류는 같은 부모
   * 아래에서, 대분류는 같은 유형의 단 안에서다.
   */
  /** 없애려다 막힌 분류. 이 값이 있으면 무엇을 할지 묻는 창이 선다. */
  const inUseCategory = categories.find((row) => row.id === inUseId) ?? null;

  const move = async (id: string, step: 1 | -1) => {
    const result = await manager.move(id, step);
    setError(result.ok ? '' : result.message);
  };

  /** 끌어다 놓은 자리로 옮긴다. 위 `move` 와 같은 길로 가되 자리를 그대로 받는다. */
  const moveTo = async (id: string, toIndex: number) => {
    const result = await manager.moveTo(id, toIndex);
    setError(result.ok ? '' : result.message);
  };

  return (
    <View className="gap-6">
      {/*
        추가 버튼은 머리글이 아니라 **목록 바로 위**에 있다 (자산 화면과 같은 규칙).
        무엇에 더하는 것인지가 버튼 아래에 곧바로 이어져 보인다.
      */}
      <PageHeader title={t('nav.categories')} />

      {/* 잘 끝난 일. 통합처럼 화면에 자취가 남지 않는 일이 여기서 말한다. */}
      {notice ? (
        <View className="rounded-lg border border-green-200 bg-green-50 px-3 py-2">
          <Text className="text-sm text-green-700">{notice}</Text>
        </View>
      ) : null}

      <SegmentedTabs
        tabs={[
          { id: 'categories' as const, label: t('categories.title') },
          { id: 'tags' as const, label: t('tags.tab') },
        ]}
        selected={section}
        onSelect={setSection}
      />

      {section === 'tags' ? (
        <TagsPanel projectId={selectedProjectId} />
      ) : isLoading && categories.length === 0 ? (
        <Text className="text-gray-600">{t('common.loading')}</Text>
      ) : categories.length === 0 ? (
        <Text className="text-gray-600">{t('categories.empty')}</Text>
      ) : (
        <>
          {/*
            좁은 화면에서는 두 단이 세로로 쌓여 수입이 지출 목록 한참 아래로 밀린다.
            탭으로 하나씩 보여 준다. 두 단이 나란히 보이는 넓은 화면에서는 감춘다.
          */}
          <View className="flex-row border-b border-gray-200 lg:hidden">
            {TYPE_PANELS.map((panel) => {
              const isSelected = activeType === panel.type;

              return (
                <Pressable
                  key={panel.type}
                  onPress={() => setActiveType(panel.type)}
                  className={`flex-1 items-center px-4 py-2 ${
                    isSelected ? 'border-b-2 border-blue-600' : ''
                  }`}
                >
                  <Text
                    className={`font-medium ${isSelected ? 'text-blue-600' : 'text-gray-600'}`}
                  >
                    {t(panel.titleKey)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* 가계·자산 화면과 같은 2단 배치. 왼쪽 지출, 오른쪽 수입. */}
          <View className="gap-8 lg:flex-row">
            {TYPE_PANELS.map((panel) => {
              const parents = manager.parentsOf(panel.type);

              return (
                <View
                  key={panel.type}
                  // 좁은 화면에서는 고른 단만 남긴다.
                  className={`flex-1 ${activeType === panel.type ? '' : 'hidden lg:flex'}`}
                >
                  {/* 좁은 화면에서는 탭 글자가 같은 말을 하므로 머리글을 접는다. */}
                  <Text className={`mb-4 hidden text-lg font-bold lg:flex ${panel.text}`}>
                    {t(panel.titleKey)}
                  </Text>

                  {/* 그 단의 유형(지출·수입)을 미리 골라 연다. */}
                  <AddButton label={t('categories.add')} onPress={() => openNewIn(panel.type)} />

                  {parents.length === 0 ? (
                    <Text className="text-gray-600">{t(panel.emptyKey)}</Text>
                  ) : (
                    /* 길게 누르면 끌어서 자리를 바꾼다. 짧게 누르면 상세가 열린다. */
                    <DragList
                      items={parents}
                      gap={16}
                      itemClassName="rounded-lg bg-white p-4 shadow-sm active:bg-gray-50"
                      onPressItem={(parent) => {
                        setSelectedCategory(parent);
                        setIsDetailModalOpen(true);
                      }}
                      onReorder={(id, toIndex) => void moveTo(id, toIndex)}
                      renderItem={(parent) => {
                        const children = manager.childrenOf(parent.id);

                        return (
                          <>
                            <Text className="mb-2 font-bold text-gray-900">{parent.name}</Text>

                            {children.length > 0 ? (
                              <View className="ml-4 mt-2 gap-2 border-l border-gray-200 pl-4">
                                {children.map((child) => (
                                  <View
                                    key={child.id}
                                    className="flex-row items-center justify-between"
                                  >
                                    <Text className="text-sm text-gray-600">{child.name}</Text>
                                    <Text className="text-xs text-gray-500">
                                      {child.isDefault ? t('categories.defaultMark') : ''}
                                    </Text>
                                  </View>
                                ))}
                              </View>
                            ) : null}
                          </>
                        );
                      }}
                    />
                  )}
                </View>
              );
            })}
          </View>

          {error ? (
            <View className="rounded bg-red-50 p-3">
              <Text className="text-sm text-red-800">{error}</Text>
            </View>
          ) : null}
        </>
      )}

      {/* 상세. 웹과 같이 이름·유형·소분류를 보여 주고 고치기와 지우기를 아래에 둔다. */}
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
            <Pressable
              onPress={() => showEntriesOf(selectedCategory)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('categories.viewEntries')}
              className="h-8 w-8 items-center justify-center rounded-lg active:bg-gray-100"
            >
              <Receipt size={18} color="#111827" />
            </Pressable>
          ) : null
        }
        footer={
          selectedCategory ? (
            <View className="flex-row gap-2">
              <Pressable
                onPress={() => {
                  setIsDetailModalOpen(false);
                  openEditor(selectedCategory);
                }}
                className="flex-1 items-center rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
              >
                <Text className="text-white">{t('account.editSubmit')}</Text>
              </Pressable>
              <Pressable
                disabled={isSubmitting || selectedCategory.isDefault}
                onPress={async () => {
                  setIsDetailModalOpen(false);
                  await remove(selectedCategory.id);
                }}
                className={`flex-1 items-center rounded-lg bg-red-600 px-4 py-2 ${
                  isSubmitting || selectedCategory.isDefault ? 'opacity-50' : 'active:bg-red-700'
                }`}
              >
                <Text className="text-white">{t('account.deleteSubmit')}</Text>
              </Pressable>
            </View>
          ) : null
        }
      >
        {selectedCategory ? (
          <View className="gap-4">
            <View>
              <Text className="mb-1 text-sm font-medium text-gray-700">
                {t('categories.name')}
              </Text>
              <Text className="rounded-lg bg-gray-50 px-3 py-2 text-gray-900">
                {selectedCategory.name}
              </Text>
            </View>

            <View>
              <Text className="mb-1 text-sm font-medium text-gray-700">{t('account.type')}</Text>
              <Text className="rounded-lg bg-gray-50 px-3 py-2 text-gray-900">
                {t(selectedCategory.type === 'income' ? 'home.tab.income' : 'home.tab.expense')}
              </Text>
            </View>

            <MoveRow
              disabled={isSubmitting}
              onMove={(step) => void move(selectedCategory.id, step)}
            />

            {error ? (
              <View className="rounded bg-red-50 p-3">
                <Text className="text-sm text-red-800">{error}</Text>
              </View>
            ) : null}

            {!selectedCategory.parentId ? (
              <>
                {manager.childrenOf(selectedCategory.id).length > 0 ? (
                  <View>
                    <Text className="mb-1 text-sm font-medium text-gray-700">
                      {t('categories.subcategories')}
                    </Text>
                    <View className="gap-2">
                      {manager.childrenOf(selectedCategory.id).map((child) => (
                        <View
                          key={child.id}
                          className="flex-row items-center gap-2 rounded-lg bg-gray-50 px-3 py-2"
                        >
                          <Text className="flex-1 text-sm text-gray-900">{child.name}</Text>
                          <Text className="text-xs text-gray-500">
                            {child.isDefault ? t('categories.defaultMark') : ''}
                          </Text>
                          {/* 소분류는 이 줄에서 곧바로 옮긴다. 따로 여는 창이 없다. */}
                          <MoveRow
                            compact
                            disabled={isSubmitting}
                            onMove={(step) => void move(child.id, step)}
                          />
                        </View>
                      ))}
                    </View>
                  </View>
                ) : null}
              </>
            ) : null}
          </View>
        ) : null}
      </Modal>

      {/* 추가·수정 폼. 대분류 이름과 소분류 줄들을 받는다. */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeForm}
        title={t(editingId ? 'categories.edit' : 'categories.add')}
        footer={
          <Pressable
            onPress={submit}
            disabled={isSubmitting || !formData.name.trim()}
            className={`items-center rounded-lg bg-blue-600 px-4 py-2 ${
              isSubmitting || !formData.name.trim() ? 'opacity-50' : 'active:bg-blue-700'
            }`}
          >
            <Text className="text-white">
              {isSubmitting
                ? t(editingId ? 'account.editing' : 'account.adding')
                : t(editingId ? 'account.editSubmit' : 'account.addSubmit')}
            </Text>
          </Pressable>
        }
      >
        <View className="gap-4">
          <CategoryFormFields
            name={formData.name}
            onNameChange={(name) => setFormData({ ...formData, name })}
            type={formData.type}
            onTypeChange={(type) => setFormData({ ...formData, type })}
            subCategories={formData.subCategories}
            onSubCategoriesChange={(subCategories) => setFormData({ ...formData, subCategories })}
            /* 유형은 만들 때만 고른다. 고친 뒤 바꾸면 그 분류의 거래가 갈 곳을 잃는다. */
            canPickType={!editingId}
          />

          {error ? (
            <View className="rounded bg-red-50 p-3">
              <Text className="text-sm text-red-800">{error}</Text>
            </View>
          ) : null}
        </View>
      </Modal>

      {/*
        없애려다 막혔을 때. 무엇을 할지 먼저 묻는다.

        곧바로 통합 창을 열지 않는다. 거래가 몇 건인지, 무엇에 쓰인 분류인지 모르는 채로
        옮길 곳부터 고르게 되기 때문이다 -- 먼저 그 거래를 보러 갈 길을 나란히 둔다.
      */}
      <Modal
        isOpen={inUseCategory !== null}
        onClose={() => setInUseId(null)}
        title={t('categories.inUseTitle')}
      >
        <View className="gap-3">
          <Text className="text-sm text-gray-600">
            {t('categories.inUseHint', { name: inUseCategory?.name ?? '' })}
          </Text>

          <InUseChoice
            label={t('categories.inUseShowEntries')}
            description={t('categories.inUseShowEntriesHint')}
            onPress={() => {
              const target = inUseCategory;
              setInUseId(null);
              if (target) showEntriesOf(target);
            }}
          />
          <InUseChoice
            label={t('categories.inUseMerge')}
            description={t('categories.inUseMergeHint')}
            onPress={() => {
              setMergeId(inUseId);
              setInUseId(null);
            }}
          />
        </View>
      </Modal>

      <CategoryMergeModal
        isOpen={mergeId !== null}
        onClose={() => setMergeId(null)}
        categories={categories}
        targetId={mergeId}
        usage={usage}
        isSubmitting={manager.isSubmitting}
        onSubmit={merge}
      />
    </View>
  );
}

/** 막힌 자리에서 고르는 줄. 둘뿐이라 목록 대신 큰 단추 둘이다 (웹의 ChoiceModal 과 같다). */
function InUseChoice({
  label,
  description,
  onPress,
}: {
  label: string;
  description: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="rounded-lg border border-gray-200 px-4 py-3 active:bg-gray-50"
    >
      <Text className="text-base font-medium text-gray-900">{label}</Text>
      <Text className="mt-0.5 text-sm text-gray-500">{description}</Text>
    </Pressable>
  );
}
