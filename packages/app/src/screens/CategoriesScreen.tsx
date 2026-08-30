import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import {
  NO_SUB_CATEGORIES,
  useCategoryManager,
  type CategoryFormValues,
} from '@money/core/hooks/useCategoryManager';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import type { Category } from '@money/core/lib/types';
import { useProject } from '@money/core/store/project';

import Modal from '../components/Modal';
import PageHeader from '../components/PageHeader';

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
  defaultIsExtra: false,
};

/** 카테고리 화면. 웹의 /categories 와 같은 배치다. */
export default function CategoriesScreen() {
  const { t } = useTranslation();
  const selectedProjectId = useProject((state) => state.selectedProjectId);
  const manager = useCategoryManager(selectedProjectId);
  const { categories, isLoading, isSubmitting } = manager;

  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [formData, setFormData] = useState<CategoryFormValues>(EMPTY_FORM);
  /** 좁은 화면에서 보고 있는 단. 넓은 화면에서는 두 단이 함께 보이므로 쓰이지 않는다. */
  const [activeType, setActiveType] = useState<'expense' | 'income'>('expense');

  const closeForm = () => {
    setIsModalOpen(false);
    setFormData(EMPTY_FORM);
    setEditingId(null);
    setError('');
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

  const remove = async (id: string) => {
    const result = await manager.remove(id);
    setError(result.ok ? '' : result.message);
  };

  return (
    <View className="gap-6">
      <PageHeader
        title={t('categories.title')}
        action={
          <Pressable
            onPress={() => setIsModalOpen(true)}
            className="rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
          >
            <Text className="text-white">{t('categories.add')}</Text>
          </Pressable>
        }
      />

      {isLoading ? (
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

                  {parents.length === 0 ? (
                    <Text className="text-gray-600">{t(panel.emptyKey)}</Text>
                  ) : (
                    <View className="gap-4">
                      {parents.map((parent) => {
                        const children = manager.childrenOf(parent.id);

                        return (
                          <Pressable
                            key={parent.id}
                            onPress={() => {
                              setSelectedCategory(parent);
                              setIsDetailModalOpen(true);
                            }}
                            className="rounded-lg bg-white p-4 shadow-sm active:bg-gray-50"
                          >
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
                                      {child.defaultIsExtra ? t('categories.extraMark') : ''}
                                    </Text>
                                  </View>
                                ))}
                              </View>
                            ) : null}
                          </Pressable>
                        );
                      })}
                    </View>
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

            {!selectedCategory.parentId ? (
              <>
                {selectedCategory.defaultIsExtra ? (
                  <Text className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
                    {t('categories.defaultExtra')}
                  </Text>
                ) : null}

                {manager.childrenOf(selectedCategory.id).length > 0 ? (
                  <View>
                    <Text className="mb-1 text-sm font-medium text-gray-700">
                      {t('categories.subcategories')}
                    </Text>
                    <View className="gap-2">
                      {manager.childrenOf(selectedCategory.id).map((child) => (
                        <View
                          key={child.id}
                          className="flex-row items-center justify-between rounded-lg bg-gray-50 px-3 py-2"
                        >
                          <Text className="text-sm text-gray-900">{child.name}</Text>
                          <Text className="text-xs text-gray-500">
                            {child.isDefault ? t('categories.defaultMark') : ''}
                            {child.defaultIsExtra ? t('categories.extraMark') : ''}
                          </Text>
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
          <View>
            <Text className="mb-1 text-sm font-medium text-gray-700">{t('categories.name')}</Text>
            <TextInput
              value={formData.name}
              onChangeText={(name) => setFormData({ ...formData, name })}
              placeholder={t('categories.parentPlaceholder')}
              className="rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
            />
          </View>

          {/* 유형은 만들 때만 고른다. 고친 뒤 바꾸면 그 분류의 거래가 갈 곳을 잃는다. */}
          {!editingId ? (
            <View>
              <Text className="mb-1 text-sm font-medium text-gray-700">{t('account.type')}</Text>
              <View className="flex-row gap-2">
                {TYPE_PANELS.map((panel) => {
                  const isSelected = formData.type === panel.type;

                  return (
                    <Pressable
                      key={panel.type}
                      onPress={() => setFormData({ ...formData, type: panel.type })}
                      className={`flex-1 items-center rounded-lg border px-4 py-2 ${
                        isSelected ? 'border-blue-600 bg-blue-50' : 'border-gray-300'
                      }`}
                    >
                      <Text className={isSelected ? 'text-blue-600' : 'text-gray-700'}>
                        {t(panel.type === 'expense' ? 'home.tab.expense' : 'home.tab.income')}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          <View>
            <Text className="mb-1 text-sm font-medium text-gray-700">
              {t('categories.subcategories')}
            </Text>
            <View className="gap-2">
              {formData.subCategories.map((row, index) => (
                <View key={row.id || `new-${index}`} className="flex-row items-center gap-2">
                  <TextInput
                    value={row.name}
                    placeholder={t('categories.subPlaceholder')}
                    onChangeText={(name) => {
                      const next = [...formData.subCategories];
                      next[index] = { ...row, name };
                      setFormData({ ...formData, subCategories: next });
                    }}
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
                  />
                  <Pressable
                    onPress={() =>
                      setFormData({
                        ...formData,
                        subCategories: formData.subCategories.filter((_, i) => i !== index),
                      })
                    }
                    className="rounded-lg border border-gray-300 px-3 py-2"
                  >
                    <Text className="text-gray-600">×</Text>
                  </Pressable>
                </View>
              ))}

              <Pressable
                onPress={() =>
                  setFormData({
                    ...formData,
                    subCategories: [
                      ...formData.subCategories,
                      { id: '', name: '', defaultIsExtra: false },
                    ],
                  })
                }
                className="items-center rounded-lg border border-gray-300 px-4 py-2"
              >
                <Text className="text-sm text-gray-700">{t('categories.addSub')}</Text>
              </Pressable>
            </View>
          </View>

          {error ? (
            <View className="rounded bg-red-50 p-3">
              <Text className="text-sm text-red-800">{error}</Text>
            </View>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}
