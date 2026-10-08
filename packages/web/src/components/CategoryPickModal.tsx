'use client';

/*
 * 고른 거래의 분류를 한 번에 바꾸는 창 (2026-10-09 사용자 요청 -- 태그 손보기처럼).
 *
 * 분류는 줄마다 하나라 태그처럼 켜고 끄지 않는다. 하나를 골라 고른 줄 전부를 그리로 옮긴다.
 * 지출·수입을 갈라 늘어놓는다 -- 지출 줄은 지출 분류로, 수입 줄은 수입 분류로만 바뀐다
 * (`planCategoryChange`). 대분류 뒤에 그 소분류가 선다. 검색 창의 분류 칸과 같은 차례다.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import type { CategoryDto } from '@money/types';

import { groupCategoriesByType } from '@money/core/lib/category-tree';
import { useTranslation } from '@money/core/lib/i18n';

import Modal from '@/components/Modal';
import { Chip } from '@/components/TransactionSearchModal';

export default function CategoryPickModal({
  isOpen,
  onClose,
  onApply,
  categories,
  count,
  installmentCount = 0,
  isSubmitting,
}: {
  isOpen: boolean;
  onClose: () => void;
  onApply: (categoryId: string) => void;
  categories: CategoryDto.Response[];
  /** 고른 거래 수. 무엇에 걸리는지 숫자로 보여 준다. */
  count: number;
  /** 고른 것 가운데 할부 거래의 수. 회차 하나를 골라도 원거래가 바뀐다고 알린다. */
  installmentCount?: number;
  isSubmitting: boolean;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<string | null>(null);
  const sections = useMemo(() => groupCategoriesByType(categories), [categories]);

  // 열 때마다 비운다. 지난번에 고른 분류가 남으면 엉뚱한 데로 옮긴다.
  useEffect(() => {
    if (isOpen) setPicked(null);
  }, [isOpen]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('tx.categorySelected')}
      footer={
        <button
          type="button"
          disabled={!picked || isSubmitting}
          onClick={() => picked && onApply(picked)}
          className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {t(isSubmitting ? 'common.saving' : 'tx.categoryApply')}
        </button>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1">
          <p className="text-sm text-gray-600">{t('tx.tagTargets', { count })}</p>
          <p className="text-xs text-gray-500">{t('tx.categoryHowTo')}</p>
          {installmentCount > 0 ? (
            <p className="text-xs text-amber-700">
              {t('tx.tagInstallmentNote', { count: installmentCount })}
            </p>
          ) : null}
        </div>

        {sections.length === 0 ? (
          <p className="text-sm text-gray-500">{t('categories.empty')}</p>
        ) : (
          sections.map((section) => (
            <div key={section.type}>
              <p className="mb-1.5 text-xs text-gray-500">
                {t(section.type === 'expense' ? 'tx.kind.expense' : 'tx.kind.income')}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {section.groups.map((group) => (
                  <Fragment key={group.parent?.id ?? 'orphans'}>
                    {group.parent ? (
                      <Chip
                        label={group.parent.name}
                        selected={picked === group.parent.id}
                        onClick={() => setPicked(group.parent!.id)}
                      />
                    ) : null}
                    {group.parent && group.children.length > 0 ? (
                      <span className="select-none text-sm text-gray-300" aria-hidden>
                        ›
                      </span>
                    ) : null}
                    {group.children.map((child) => (
                      <Chip
                        key={child.id}
                        label={child.name}
                        selected={picked === child.id}
                        onClick={() => setPicked(child.id)}
                        subtle
                      />
                    ))}
                  </Fragment>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
