'use client';

/*
 * 거래를 고르는 중의 머리글. 뒤로가기 · 몇 개를 골랐는지 · 고른 목적의 단추(태그·분류·삭제).
 *
 * 고르는 중에는 화면 머리글이 통째로 이것으로 바뀐다. 제목과 검색은 그때 쓸 것이 아니다.
 */
import { ArrowLeft, Shapes, Tag, Trash2 } from 'lucide-react';
import { useTranslation } from '@money/core/lib/i18n';

export default function SelectionBar({
  purpose,
  selectedCount,
  isTagging,
  isRecategorizing,
  isDeleting,
  onBack,
  onTag,
  onCategory,
  onDelete,
}: {
  /** 무엇을 하려고 고르는가. 그 일의 단추만 선다. */
  purpose: string | null;
  selectedCount: number;
  isTagging: boolean;
  isRecategorizing: boolean;
  isDeleting: boolean;
  onBack: () => void;
  onTag: () => void;
  onCategory: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onBack}
        aria-label={t('common.back')}
        title={t('common.back')}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 bg-white hover:bg-gray-50"
      >
        <ArrowLeft className="h-4 w-4 text-gray-600" aria-hidden />
      </button>

      {/*
        태그를 붙이러 왔으면 그 버튼이 왼쪽, 뒤로가기 옆에 선다.
        지우기는 오른쪽 끝이다 -- 되돌릴 수 없는 일이라 뒤로가기에서 멀어야 한다.
      */}
      {purpose === 'tag' ? (
        <button
          type="button"
          onClick={onTag}
          disabled={isTagging}
          aria-label={t('tx.tagSelected')}
          title={t('tx.tagSelected')}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-blue-300 bg-white hover:bg-blue-50 disabled:opacity-50"
        >
          <Tag className="h-4 w-4 text-blue-600" aria-hidden />
        </button>
      ) : null}
      {/* 분류를 바꾸러 왔으면 태그 단추 자리에 분류 단추가 선다. */}
      {purpose === 'category' ? (
        <button
          type="button"
          onClick={onCategory}
          disabled={isRecategorizing}
          aria-label={t('tx.categorySelected')}
          title={t('tx.categorySelected')}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-blue-300 bg-white hover:bg-blue-50 disabled:opacity-50"
        >
          <Shapes className="h-4 w-4 text-blue-600" aria-hidden />
        </button>
      ) : null}

      <p className="flex-1 text-base font-semibold text-gray-900">
        {t('tx.selected', { count: selectedCount })}
      </p>

      {purpose === 'delete' ? (
        <button
          type="button"
          onClick={onDelete}
          disabled={isDeleting}
          aria-label={t('tx.deleteSelected')}
          title={t('tx.deleteSelected')}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-red-300 bg-white hover:bg-red-50 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4 text-red-600" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
