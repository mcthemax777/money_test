/*
 * 거래를 적다가 그 자리에서 만드는 창 -- 분류와 태그.
 *
 * 구성원·통장·카드는 자산 화면이 쓰는 창을 그대로 쓴다(`AssetAddModals`). 분류와
 * 태그는 설정 화면 쪽에 목록·순서·지우기까지 얹힌 판으로만 있어, 거래를 적다가 열기에는
 * 크다. 여기에는 **만드는 데 필요한 것만** 둔다 -- 이름과, 분류는 어디에 붙일지, 태그는 색.
 *
 * 만들고 나서 그 값을 곧바로 고르는 것이 요점이라(`useQuickAdd`) 창은 id 를 돌려준다.
 */
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { CategoryDto } from '@money/types';

import { useTranslation } from '@money/core/lib/i18n';
import type { QuickAddResult } from '@money/core/hooks/useQuickAdd';
import { EMPTY_TAG_FORM, type TagFormValues } from '@money/core/hooks/useTagManager';

import Modal from './Modal';
import { Field, Select } from './FormFields';
import { TagFields } from './TagFields';

function ErrorLine({ message }: { message: string }) {
  if (!message) return null;
  return (
    <View className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
      <Text className="text-sm text-red-600">{message}</Text>
    </View>
  );
}

function SaveButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`items-center rounded-lg bg-blue-600 px-4 py-3 ${disabled ? 'opacity-50' : ''}`}
    >
      <Text className="text-base font-semibold text-white">{label}</Text>
    </Pressable>
  );
}

/**
 * 분류 하나를 만든다.
 *
 * 유형(수입·지출)은 묻지 않는다. 거래의 갈래가 이미 정했고, 그 갈래에서 고를 수 없는
 * 분류를 만들어 봐야 방금 만든 것이 목록에 나타나지 않는다.
 *
 * 대분류로 만들지, 어느 대분류 아래 소분류로 만들지는 고른다. 웹의 같은 자리는 소분류를
 * 붙일 대분류를 먼저 누르고 들어오지만, 앱의 분류 칸은 대분류와 소분류가 한 줄에 섞여
 * 있어 그 길이 없다 -- 그래서 창 안에서 고르게 한다.
 */
export function AddCategoryModal({
  isOpen,
  onClose,
  parents,
  type,
  onSubmit,
  isSubmitting,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** 소분류를 붙일 수 있는 대분류. 지금 갈래의 것만 온다. */
  parents: CategoryDto.Response[];
  type: 'income' | 'expense';
  onSubmit: (input: {
    name: string;
    type: 'income' | 'expense';
    parentId?: string;
  }) => Promise<QuickAddResult>;
  isSubmitting: boolean;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [error, setError] = useState('');

  // 열 때마다 비운다. 지난번에 적다 만 것이 남으면 엉뚱한 이름이 저장된다.
  useEffect(() => {
    if (isOpen) {
      setName('');
      setParentId('');
      setError('');
    }
  }, [isOpen]);

  const submit = async () => {
    if (!name.trim()) {
      setError(t('categories.nameRequired'));
      return;
    }

    const result = await onSubmit({
      name: name.trim(),
      type,
      ...(parentId ? { parentId } : {}),
    });
    if (result.ok) onClose();
    else setError(result.message ?? t('categories.addFailed'));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t(parentId ? 'categories.addSub' : 'categories.add')}
      footer={
        <SaveButton
          label={t(isSubmitting ? 'common.saving' : 'common.save')}
          onPress={submit}
          disabled={isSubmitting}
        />
      }
    >
      <View className="gap-4">
        <ErrorLine message={error} />

        <Field label={t('categories.name')}>
          <TextInput
            value={name}
            onChangeText={setName}
            autoFocus
            className="rounded-lg border border-gray-300 px-3 py-3 text-base text-gray-900"
          />
        </Field>

        {/* 붙일 자리. 비워 두면 대분류로 선다. */}
        {parents.length > 0 ? (
          <Field label={t('editor.parentCategory')}>
            <Select
              value={parentId}
              options={[
                { value: '', label: t('categories.asParent') },
                ...parents.map((parent) => ({
                  value: parent.id,
                  label: parent.name,
                })),
              ]}
              onSelect={setParentId}
            />
          </Field>
        ) : null}
      </View>
    </Modal>
  );
}

/** 태그 하나를 만든다. 이름과 색뿐이다 (설정의 태그 판과 같은 값). */
export function AddTagModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: { name: string; color?: string }) => Promise<QuickAddResult>;
  isSubmitting: boolean;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<TagFormValues>(EMPTY_TAG_FORM);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setValues(EMPTY_TAG_FORM);
      setError('');
    }
  }, [isOpen]);

  const submit = async () => {
    const name = values.name.trim();
    if (!name) {
      setError(t('tags.nameRequired'));
      return;
    }

    const result = await onSubmit({
      name,
      ...(values.color ? { color: values.color } : {}),
    });
    if (result.ok) onClose();
    else setError(result.message ?? t('tags.saveFailed'));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('tags.add')}
      footer={
        <SaveButton
          label={t(isSubmitting ? 'common.saving' : 'common.save')}
          onPress={submit}
          disabled={isSubmitting}
        />
      }
    >
      <View className="gap-4">
        <ErrorLine message={error} />

        <TagFields values={values} onChange={setValues} autoFocus />
      </View>
    </Modal>
  );
}
