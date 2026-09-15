'use client';

/*
 * 태그 하나를 적는 칸들 -- 이름과 색.
 *
 * 태그를 만드는 자리가 둘이다. 설정의 태그 판과, 거래를 적다가 그 자리에서 만드는 창.
 * 두 벌로 두면 고를 수 있는 색이나 고른 표시가 한쪽에서만 바뀌어, 같은 태그를 만드는
 * 일이 화면마다 다르게 보인다.
 */
import { useEffect, useState } from 'react';

import { EMPTY_TAG_FORM, type TagFormValues } from '@money/core/hooks/useTagManager';
import { useTranslation } from '@money/core/lib/i18n';
import { TAG_COLORS } from '@money/core/lib/tag-color';

import Modal from '@/components/Modal';

export function TagFields({
  values,
  onChange,
  /** 같은 쪽에 이 칸이 둘 이상 설 수 있어 id 를 나눈다 (label 의 htmlFor 가 잇는다). */
  idPrefix = 'tag',
}: {
  values: TagFormValues;
  onChange: (next: TagFormValues) => void;
  idPrefix?: string;
}) {
  const { t } = useTranslation();
  const nameId = `${idPrefix}-name`;

  return (
    <>
      <div>
        <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor={nameId}>
          {t('tags.name')}
        </label>
        <input
          id={nameId}
          value={values.name}
          onChange={(event) => onChange({ ...values, name: event.target.value })}
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900"
        />
      </div>

      <div>
        <span className="mb-2 block text-sm font-medium text-gray-700">{t('tags.color')}</span>
        <div className="flex flex-wrap gap-2">
          {/* 색을 고르지 않는 것도 하나의 선택이다. 빈 동그라미가 그 자리다. */}
          <ColorDot
            color=""
            label={t('tags.colorNone')}
            isSelected={values.color === ''}
            onSelect={() => onChange({ ...values, color: '' })}
          />
          {TAG_COLORS.map((color) => (
            <ColorDot
              key={color}
              color={color}
              label={color}
              isSelected={values.color === color}
              onSelect={() => onChange({ ...values, color })}
            />
          ))}
        </div>
      </div>
    </>
  );
}

/** 색 하나. 고른 것은 테두리로 보인다 -- 색 위에 체크를 얹으면 밝은 색에서 보이지 않는다. */
function ColorDot({
  color,
  label,
  isSelected,
  onSelect,
}: {
  color: string;
  label: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={label}
      aria-pressed={isSelected}
      className={`flex h-9 w-9 items-center justify-center rounded-full border-2 transition ${
        isSelected ? 'border-blue-600' : 'border-transparent hover:border-gray-300'
      }`}
    >
      <span
        className={`h-6 w-6 rounded-full ${color ? '' : 'border border-gray-300'}`}
        style={color ? { backgroundColor: color } : undefined}
      />
    </button>
  );
}

/** 하단 고정 버튼과 본문 form을 잇는 id (Modal의 footer는 form 밖에 렌더링된다) */
const QUICK_FORM_ID = 'quick-tag-form';

/**
 * 거래를 적다가 태그 하나를 만드는 창.
 *
 * 설정의 태그 판은 목록·순서·지우기까지 얹혀 있어 거래를 적다가 열기에는 크다. 여기에는
 * **만드는 데 필요한 것만** 둔다. 실패하면 창을 닫지 않고 그 자리에 이유를 적는다 --
 * 적던 이름을 잃지 않게.
 */
export function AddTagModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** 만들기. 실패하면 화면에 그대로 적을 문장이 온다. */
  onSubmit: (values: TagFormValues) => Promise<{ ok: boolean; message?: string }>;
  isSubmitting: boolean;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<TagFormValues>(EMPTY_TAG_FORM);
  const [error, setError] = useState('');

  // 열 때마다 비운다. 지난번에 적다 만 것이 남으면 엉뚱한 이름이 저장된다.
  useEffect(() => {
    if (isOpen) {
      setValues(EMPTY_TAG_FORM);
      setError('');
    }
  }, [isOpen]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!values.name.trim()) {
      setError(t('tags.nameRequired'));
      return;
    }

    const result = await onSubmit({ ...values, name: values.name.trim() });
    if (result.ok) onClose();
    else setError(result.message ?? t('tags.saveFailed'));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('tags.add')}
      footer={
        <button
          type="submit"
          form={QUICK_FORM_ID}
          disabled={isSubmitting}
          className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {t(isSubmitting ? 'common.saving' : 'common.save')}
        </button>
      }
    >
      <form id={QUICK_FORM_ID} onSubmit={submit} className="space-y-5">
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        ) : null}

        <TagFields values={values} onChange={setValues} idPrefix="quick-tag" />
      </form>
    </Modal>
  );
}
