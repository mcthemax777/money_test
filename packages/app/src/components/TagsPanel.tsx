/*
 * 태그를 만들고 고치고 지우는 자리.
 *
 * 카테고리 화면 안의 한 탭으로 산다. 둘 다 "거래를 무엇으로 묶어 보나"를 정하는 일이고,
 * 태그는 계층이 없어 화면 하나를 따로 둘 만큼 크지 않다.
 *
 * 카테고리와 달리 **지우기를 막지 않는다.** 태그를 떼어 내도 거래는 온전하고 분류별
 * 합계도 그대로다. 막아 두면 오래된 태그를 영영 정리하지 못한다.
 */
import { useState } from 'react';
import { Alert, LayoutAnimation, Pressable, Text, TextInput, View } from 'react-native';
import { Plus, X } from 'lucide-react-native';
import type { TagDto } from '@money/types';

import { EMPTY_TAG_FORM, useTagManager, type TagFormValues } from '@money/core/hooks/useTagManager';
import { useTranslation } from '@money/core/lib/i18n';

import Modal from './Modal';

/**
 * 고를 수 있는 색.
 *
 * 자유 입력을 두지 않는다. 색을 직접 적게 하면 목록에서 서로 구별되지 않는 비슷한
 * 색들이 쌓이고, 앱에는 색 고르는 기본 위젯이 없다. 카드 색과 같은 방식이다.
 */
const COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
];

/** 목록이 늘고 줄 때의 움직임. 새 줄은 옅은 데서 떠오르고 아래는 밀려 내려간다. */
const SHIFT = LayoutAnimation.create(180, 'easeInEaseOut', 'opacity');

export default function TagsPanel({ projectId }: { projectId: string | null }) {
  const { t } = useTranslation();
  const manager = useTagManager(projectId);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [values, setValues] = useState<TagFormValues>(EMPTY_TAG_FORM);
  const [error, setError] = useState('');

  const openNew = () => {
    setEditingId(null);
    setValues(EMPTY_TAG_FORM);
    setError('');
    setIsFormOpen(true);
  };

  const openEdit = (tag: TagDto.Response) => {
    setEditingId(tag.id);
    setValues(manager.formValuesOf(tag));
    setError('');
    setIsFormOpen(true);
  };

  const submit = async () => {
    const result = await manager.save(editingId, values);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // 목록이 한 줄 늘거나 이름이 바뀐다. 그 자리가 움직이는 것을 보이게 한다.
    LayoutAnimation.configureNext(SHIFT);
    setIsFormOpen(false);
  };

  const remove = (tag: TagDto.Response) => {
    Alert.alert(t('tags.deleteConfirm', { name: tag.name }), t('tags.deleteConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('entryForm.delete'),
        style: 'destructive',
        onPress: () => {
          void manager.remove(tag.id).then((result) => {
            if (!result.ok) {
              setError(result.message);
              return;
            }
            LayoutAnimation.configureNext(SHIFT);
          });
        },
      },
    ]);
  };

  return (
    <View className="gap-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-lg font-bold text-gray-900">{t('tags.title')}</Text>
        <Pressable
          onPress={openNew}
          className="flex-row items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
        >
          <Plus size={16} color="#ffffff" />
          <Text className="text-white">{t('tags.add')}</Text>
        </Pressable>
      </View>

      {error ? (
        <View className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <Text className="text-sm text-red-600">{error}</Text>
        </View>
      ) : null}

      {manager.isLoading ? (
        <Text className="text-gray-600">{t('common.loading')}</Text>
      ) : manager.tags.length === 0 ? (
        <Text className="text-gray-600">{t('tags.empty')}</Text>
      ) : (
        <View className="gap-2">
          {manager.tags.map((tag) => (
            <Pressable
              key={tag.id}
              onPress={() => openEdit(tag)}
              className="flex-row items-center gap-3 rounded-lg bg-white p-4 shadow-sm active:bg-gray-50"
            >
              {/* 색을 정한 태그는 점으로 보인다. 이름만으로는 목록에서 찾기 어렵다. */}
              <View
                className={`h-3 w-3 rounded-full ${tag.color ? '' : 'border border-gray-300'}`}
                style={tag.color ? { backgroundColor: tag.color } : undefined}
              />
              <Text className="flex-1 font-medium text-gray-900">{tag.name}</Text>
              <Pressable
                onPress={() => remove(tag)}
                hitSlop={8}
                accessibilityLabel={t('entryForm.delete')}
                className="p-1"
              >
                <X size={18} color="#9ca3af" />
              </Pressable>
            </Pressable>
          ))}
        </View>
      )}

      <Modal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        title={t(editingId ? 'tags.edit' : 'tags.add')}
        footer={
          <Pressable
            disabled={manager.isSubmitting}
            onPress={submit}
            className={`items-center rounded-lg bg-blue-600 px-4 py-3 ${
              manager.isSubmitting ? 'opacity-50' : ''
            }`}
          >
            <Text className="text-base font-semibold text-white">
              {t(manager.isSubmitting ? 'common.saving' : 'common.save')}
            </Text>
          </Pressable>
        }
      >
        <View className="gap-5">
          <View>
            <Text className="mb-2 text-sm font-medium text-gray-700">{t('tags.name')}</Text>
            <TextInput
              value={values.name}
              onChangeText={(text) => setValues((previous) => ({ ...previous, name: text }))}
              className="rounded-lg border border-gray-300 px-3 py-3 text-base text-gray-900"
            />
          </View>

          <View>
            <Text className="mb-2 text-sm font-medium text-gray-700">{t('tags.color')}</Text>
            <View className="flex-row flex-wrap gap-2">
              {/* 색을 고르지 않는 것도 하나의 선택이다. 빈 동그라미가 그 자리다. */}
              <ColorDot
                color=""
                isSelected={values.color === ''}
                onPress={() => setValues((previous) => ({ ...previous, color: '' }))}
              />
              {COLORS.map((color) => (
                <ColorDot
                  key={color}
                  color={color}
                  isSelected={values.color === color}
                  onPress={() => setValues((previous) => ({ ...previous, color }))}
                />
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** 색 하나. 고른 것은 테두리로 보인다 -- 색 위에 체크를 얹으면 밝은 색에서 보이지 않는다. */
function ColorDot({
  color,
  isSelected,
  onPress,
}: {
  color: string;
  isSelected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={color || undefined}
      className={`h-9 w-9 items-center justify-center rounded-full border-2 ${
        isSelected ? 'border-blue-600' : 'border-transparent'
      }`}
    >
      <View
        className={`h-6 w-6 rounded-full ${color ? '' : 'border border-gray-300'}`}
        style={color ? { backgroundColor: color } : undefined}
      />
    </Pressable>
  );
}
