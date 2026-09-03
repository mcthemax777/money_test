'use client';

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
import type { TagDto } from '@money/types';

import { EMPTY_TAG_FORM, useTagManager, type TagFormValues } from '@money/core/hooks/useTagManager';
import { useTranslation } from '@money/core/lib/i18n';

import Modal from '@/components/Modal';

/** 하단 고정 버튼과 본문 form을 잇는 id (Modal의 footer는 form 밖에 렌더링된다) */
const FORM_ID = 'tag-form';

/**
 * 고를 수 있는 색.
 *
 * 자유 입력을 두지 않는다. 색을 직접 적게 하면 목록에서 서로 구별되지 않는 비슷한
 * 색들이 쌓인다. 앱의 태그 판과 같은 값이라 두 화면의 색이 어긋나지 않는다.
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

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    const result = await manager.save(editingId, values);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setIsFormOpen(false);
  };

  const remove = async (tag: TagDto.Response) => {
    if (!window.confirm(t('tags.deleteConfirm', { name: tag.name }))) return;

    const result = await manager.remove(tag.id);
    setError(result.ok ? '' : result.message);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">{t('tags.title')}</h2>
        <button
          type="button"
          onClick={openNew}
          className="rounded-lg bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700"
        >
          {t('tags.add')}
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      ) : null}

      {manager.isLoading ? (
        <p className="text-gray-600">{t('common.loading')}</p>
      ) : manager.tags.length === 0 ? (
        <p className="text-gray-600">{t('tags.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {manager.tags.map((tag) => (
            <li
              key={tag.id}
              /* 새 줄이 옅은 데서 떠오른다. 목록이 늘어난 자리가 눈에 남는다. */
              className="unfold flex items-center gap-3 rounded-lg bg-white p-4 shadow-sm"
            >
              {/* 색을 정한 태그는 점으로 보인다. 이름만으로는 목록에서 찾기 어렵다. */}
              <span
                className={`h-3 w-3 shrink-0 rounded-full ${tag.color ? '' : 'border border-gray-300'}`}
                style={tag.color ? { backgroundColor: tag.color } : undefined}
              />
              <button
                type="button"
                onClick={() => openEdit(tag)}
                className="min-w-0 flex-1 truncate text-left font-medium text-gray-900 hover:text-blue-600"
              >
                {tag.name}
              </button>
              <button
                type="button"
                onClick={() => remove(tag)}
                aria-label={t('entryForm.delete')}
                className="shrink-0 rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-red-600"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <Modal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        title={t(editingId ? 'tags.edit' : 'tags.add')}
        footer={
          <button
            type="submit"
            form={FORM_ID}
            disabled={manager.isSubmitting}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {t(manager.isSubmitting ? 'common.saving' : 'common.save')}
          </button>
        }
      >
        <form id={FORM_ID} onSubmit={submit} className="space-y-5">
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="tag-name">
              {t('tags.name')}
            </label>
            <input
              id="tag-name"
              value={values.name}
              onChange={(event) =>
                setValues((previous) => ({ ...previous, name: event.target.value }))
              }
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
                onSelect={() => setValues((previous) => ({ ...previous, color: '' }))}
              />
              {COLORS.map((color) => (
                <ColorDot
                  key={color}
                  color={color}
                  label={color}
                  isSelected={values.color === color}
                  onSelect={() => setValues((previous) => ({ ...previous, color }))}
                />
              ))}
            </div>
          </div>
        </form>
      </Modal>
    </div>
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
