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
import { Pressable, Text, View } from 'react-native';
import type { CategoryDto } from '@money/types';

import { useTranslation } from '@money/core/lib/i18n';
import type { QuickAddResult } from '@money/core/hooks/useQuickAdd';
import {
  filledSubCategories,
  NO_SUB_CATEGORIES,
  type CategoryFormValues,
} from '@money/core/hooks/useCategoryManager';
import { EMPTY_TAG_FORM, type TagFormValues } from '@money/core/hooks/useTagManager';

import CategoryFormFields from './CategoryFormFields';
import { Field, Select } from './FormFields';
import Modal from './Modal';
import { TagFields } from './TagFields';

/** 새 분류의 빈 폼. 유형은 부르는 쪽이 거래의 갈래로 채운다. */
const EMPTY_FORM: CategoryFormValues = {
  name: '',
  type: 'expense',
  subCategories: NO_SUB_CATEGORIES,
};

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
 * 분류를 만든다. 설정의 분류 화면과 **같은 폼**이다 (CategoryFormFields).
 *
 * 예전에는 이 창에만 이름과 "붙일 대분류" 두 칸이 있었다. 같은 일을 하는 자리가 화면마다
 * 다르게 생겼을 뿐 아니라, 여기서는 소분류를 함께 만들 수 없어 거래를 적다가 만든 분류는
 * 늘 대분류 하나뿐이었다.
 *
 * 유형은 묻지 않는다. 거래의 갈래가 이미 정했고, 그 갈래에서 고를 수 없는 분류를 만들어
 * 봐야 방금 만든 것이 목록에 나타나지 않는다.
 */
export function AddCategoryModal({
  isOpen,
  onClose,
  type,
  parents,
  onSubmit,
  isSubmitting,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** 지금 적는 거래의 갈래가 정한다. */
  type: 'income' | 'expense';
  /**
   * 소분류를 붙일 수 있는 대분류. 지금 갈래의 것만 온다.
   *
   * 웹은 소분류 칸의 "+ 추가"로 들어와 대분류가 이미 정해져 있지만, 앱의 분류 칸은
   * 대분류와 소분류가 한 줄에 섞여 있어 그 길이 없다. 그래서 창 안에서 고르게 한다 --
   * 이 칸이 없으면 이미 있는 대분류 밑에 소분류를 붙일 방법이 아예 없다.
   */
  parents: CategoryDto.Response[];
  /**
   * 대분류와 소분류들을 만든다. 만들어진 것 중 **곧바로 고를 하나**의 id 를 돌려준다.
   *
   * 소분류를 하나만 적었으면 그것이 적으려던 분류이고, 아니면 대분류다 (여럿을 적었으면
   * 어느 것인지 알 수 없다).
   */
  onSubmit: (input: {
    values: CategoryFormValues;
    /** 고른 대분류. 있으면 그 아래 소분류만 만든다. */
    parentId?: string;
  }) => Promise<QuickAddResult>;
  isSubmitting: boolean;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<CategoryFormValues>({ ...EMPTY_FORM, type });
  /** 붙일 대분류. 비어 있으면 대분류를 새로 만든다. */
  const [parentId, setParentId] = useState('');
  const [error, setError] = useState('');

  const parent = parents.find((row) => row.id === parentId);

  // 열 때마다 비운다. 지난번에 적다 만 것이 남으면 엉뚱한 이름이 저장된다.
  useEffect(() => {
    if (isOpen) {
      setValues({ ...EMPTY_FORM, type });
      setParentId('');
      setError('');
    }
  }, [isOpen, type]);

  const submit = async () => {
    // 소분류 모드에는 이름 칸이 없다. 그때는 소분류 줄이 채워졌는지 본다.
    if (parent) {
      if (filledSubCategories(values.subCategories).length === 0) {
        setError(t('editor.subNameRequired'));
        return;
      }
    } else if (!values.name.trim()) {
      setError(t('categories.nameRequired'));
      return;
    }

    const result = await onSubmit({
      values: { ...values, name: values.name.trim(), type },
      parentId: parent?.id,
    });
    if (result.ok) onClose();
    else setError(result.message ?? t('categories.addFailed'));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('categories.add')}
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

        {/* 붙일 자리. 비워 두면 대분류를 새로 만든다. */}
        {parents.length > 0 ? (
          <Field label={t('editor.parentCategory')}>
            <Select
              value={parentId}
              options={[
                { value: '', label: t('categories.asParent') },
                ...parents.map((row) => ({ value: row.id, label: row.name })),
              ]}
              onSelect={setParentId}
            />
          </Field>
        ) : null}

        <CategoryFormFields
          name={values.name}
          onNameChange={(name) => setValues((previous) => ({ ...previous, name }))}
          type={values.type}
          onTypeChange={(next) => setValues((previous) => ({ ...previous, type: next }))}
          subCategories={values.subCategories}
          onSubCategoriesChange={(subCategories) =>
            setValues((previous) => ({ ...previous, subCategories }))
          }
          canPickType={false}
          parentName={parent?.name}
        />
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
