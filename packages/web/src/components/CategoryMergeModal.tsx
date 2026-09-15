'use client';

/*
 * 분류를 없애면서 그 거래를 다른 분류로 옮기는 창.
 *
 * 없애기가 막힌 자리를 푸는 길이다. 거래에 쓰이고 있는 분류는 그냥 감출 수 없는데
 * (서버의 CATEGORY_IN_USE), 그때 남는 길이 거래를 하나씩 손보는 것뿐이면 오래 쓴
 * 가계부에서는 사실상 못 없애는 분류가 된다.
 *
 * **없앨 것마다 한 줄이다.** 대분류를 없애면 그 소분류도 함께 사라지는데, 소분류마다
 * 성격이 달라 한 곳으로 몰 수 없다 -- "식비 > 외식"과 "식비 > 카페"가 같은 데로 갈
 * 까닭이 없다.
 */
import { useEffect, useMemo, useState } from 'react';
import type { CategoryDto } from '@money/types';

import { categoriesRemovedWith, mergeTargetLabel, mergeTargetsOf } from '@money/core/lib/category-tree';
import { useTranslation } from '@money/core/lib/i18n';

import Modal from '@/components/Modal';

/** 하단 고정 버튼과 본문 form을 잇는 id (Modal의 footer는 form 밖에 렌더링된다) */
const FORM_ID = 'category-merge-form';

export default function CategoryMergeModal({
  isOpen,
  onClose,
  categories,
  targetId,
  usage,
  isSubmitting,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** 이 가계부의 분류 전부. 없앨 것과 옮길 곳을 여기서 고른다. */
  categories: CategoryDto.Response[];
  /** 없애려던 분류. 대분류면 그 소분류도 함께 사라진다. */
  targetId: string | null;
  /**
   * 없앨 분류마다의 거래 수. 열쇠는 분류 id 다.
   *
   * 거래가 없는 줄에는 갈 곳을 묻지 않는다 -- 옮길 것이 없는데도 고르게 하면, 대분류
   * 하나를 없애려고 빈 소분류마다 뜻 없는 선택을 해야 한다.
   */
  usage: Record<string, number>;
  isSubmitting: boolean;
  /** 옮기고 없앤다. 실패하면 화면에 그대로 적을 문장이 온다. */
  onSubmit: (moves: CategoryDto.MergeMove[]) => Promise<{ ok: boolean; message?: string }>;
}) {
  const { t } = useTranslation();

  /** 없앨 것들. 대분류면 그 소분류가 뒤에 붙는다. */
  const removing = useMemo(
    () => (targetId ? categoriesRemovedWith(categories, targetId) : []),
    [categories, targetId],
  );
  const removingIds = useMemo(() => removing.map((row) => row.id), [removing]);

  /** 없앨 것 id → 옮길 곳 id. 고르지 않은 줄은 비어 있다. */
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  // 열 때마다 비운다. 지난번에 고르다 만 것이 남으면 엉뚱한 데로 옮긴다.
  useEffect(() => {
    if (isOpen) {
      setTargets({});
      setError('');
    }
  }, [isOpen, targetId]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    /*
     * 거래가 있는 줄만 갈 곳이 있어야 한다. 빈 줄은 옮길 것이 없어 그냥 감춘다
     * (`toId` 를 비워 보내면 서버가 그렇게 한다).
     */
    const missing = removing.some((row) => (usage[row.id] ?? 0) > 0 && !targets[row.id]);
    if (missing) {
      setError(t('categories.mergeAllRequired'));
      return;
    }

    /*
     * 한 번 더 묻는다. 거래 수백 건이 한꺼번에 옮겨지고 되돌리는 길이 없는 일이라,
     * 고르다 잘못 누른 손이 그대로 실행으로 이어지면 안 된다.
     */
    if (!window.confirm(t('categories.mergeConfirm'))) return;

    const moves = removing.map((row) => ({
      fromId: row.id,
      ...(targets[row.id] ? { toId: targets[row.id] } : {}),
    }));

    const result = await onSubmit(moves);
    if (result.ok) onClose();
    else setError(result.message ?? t('categories.mergeFailed'));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('categories.mergeTitle')}
      footer={
        <button
          type="submit"
          form={FORM_ID}
          disabled={isSubmitting}
          className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {t(isSubmitting ? 'common.saving' : 'categories.mergeSubmit')}
        </button>
      }
    >
      <form id={FORM_ID} onSubmit={submit} className="space-y-5">
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        ) : null}

        <p className="text-sm text-gray-600">{t('categories.mergeHint')}</p>

        {removing.map((row) => {
          const options = mergeTargetsOf(categories, removingIds, row.type);
          const selectId = `merge-${row.id}`;
          const hasEntries = (usage[row.id] ?? 0) > 0;

          return (
            <div key={row.id}>
              <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor={selectId}>
                {t('categories.mergeTarget', { name: mergeTargetLabel(categories, row) })}
              </label>
              {!hasEntries ? (
                /* 옮길 거래가 없다. 고를 것을 두면 뜻 없는 선택이 하나 늘 뿐이다. */
                <p className="text-sm text-gray-500">{t('categories.mergeNoEntries')}</p>
              ) : options.length === 0 ? (
                /* 같은 유형의 분류가 하나도 없다. 옮길 곳이 없으니 먼저 만들어야 한다. */
                <p className="text-sm text-gray-500">{t('categories.mergeNoTarget')}</p>
              ) : (
                <select
                  id={selectId}
                  value={targets[row.id] ?? ''}
                  onChange={(event) =>
                    setTargets((previous) => ({ ...previous, [row.id]: event.target.value }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900"
                >
                  <option value="">{t('categories.mergePick')}</option>
                  {options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {mergeTargetLabel(categories, option)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
      </form>
    </Modal>
  );
}
