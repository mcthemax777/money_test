'use client';

/*
 * 거래 폼의 분류 칸. 분류 하나짜리면 대분류·소분류 두 칸, 나눈 거래면 줄마다의 상자다.
 *
 * 이체에는 분류 칸이 없어 부르는 쪽이 그때는 그리지 않는다.
 */
import { X } from 'lucide-react';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency, formatNumber, toNumber } from '@money/core/lib/money';
import { showDiscountPerformance } from '@money/core/data/entry-form';
import type { CurrencyCode } from '@money/types';
import CustomSelect from '@/components/CustomSelect';
import type { EntryFormSplitRow, EntryFormValues, SelectOption, SetEntryForm } from './editor-form';
import { TagPillButtons, toggleId } from './TagPills';

interface CategoryFieldsProps {
  formData: EntryFormValues;
  setFormData: SetEntryForm;
  hasSplits: boolean;
  ledgerCurrency: CurrencyCode;
  /** 지금 유형의 대분류. */
  mainCategoryOptions: SelectOption[];
  /** 고른 대분류에 딸린 소분류. */
  subCategoryOptions: (mainCategoryId: string) => SelectOption[];
  /** 분류 추가 팝업. 대분류 id 를 주면 그 아래 소분류를 붙인다. */
  onAddCategory: (parentId?: string) => void;
  onAddSplit: () => void;
  onRemoveSplit: (index: number) => void;
  onUpdateSplit: (index: number, patch: Partial<EntryFormSplitRow>) => void;
  isSplitDiscountShown: (split: EntryFormSplitRow) => boolean;
  onOpenSplitDiscount: (lineKey: string) => void;
  onCloseSplitDiscount: (lineKey: string) => void;
  tags: Array<{ id: string; name: string; color?: string | null }>;
  /** 아직 줄에 담기지 않은 금액. */
  splitLeft: string;
}

export default function CategoryFields(props: CategoryFieldsProps) {
  const { formData, setFormData, hasSplits, mainCategoryOptions, subCategoryOptions, onAddCategory, onAddSplit } =
    props;
  const { t } = useTranslation();

  if (hasSplits) return <SplitRows {...props} />;

  return (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('editor.parentCategory')}
        </label>
        <CustomSelect
          options={mainCategoryOptions}
          value={formData.mainCategoryId}
          onChange={(value) =>
            setFormData({
              ...formData,
              mainCategoryId: value,
              subCategoryId: '',
            })
          }
          onAddClick={() => onAddCategory()}
          addButtonLabel={t('editor.addParentCategory')}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('editor.childCategory')}
        </label>
        <CustomSelect
          options={subCategoryOptions(formData.mainCategoryId)}
          value={formData.subCategoryId}
          onChange={(value) => setFormData({ ...formData, subCategoryId: value })}
          placeholder={t('editor.none')}
          /*
            소분류는 대분류 아래에 붙는다. 대분류를 고르기 전에는 붙일 곳이
            없으므로 버튼 자체를 내리고, 고른 뒤에는 그 대분류로 팝업을 연다.
          */
          onAddClick={
            formData.mainCategoryId ? () => onAddCategory(formData.mainCategoryId) : undefined
          }
          addButtonLabel={t('editor.addChildCategory')}
        />
      </div>

      {/* 분류를 나누는 자리. 누르면 지금 적은 금액과 분류가 첫 줄로 옮겨 간다. */}
      <button
        type="button"
        onClick={onAddSplit}
        className="w-full px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg transition-colors hover:bg-gray-50"
      >
        {t('editor.splitAdd')}
      </button>
    </>
  );
}

/**
 * 분류를 나눈 줄들.
 *
 * 줄이 있는 동안에는 위의 대분류·소분류 칸을 감춘다. 둘이 함께 보이면
 * 어느 쪽이 저장되는지 알 수 없는데, 실제로 저장되는 것은 줄들뿐이다.
 */
function SplitRows({
  formData,
  setFormData,
  ledgerCurrency,
  mainCategoryOptions,
  subCategoryOptions,
  onAddCategory,
  onAddSplit,
  onRemoveSplit,
  onUpdateSplit,
  isSplitDiscountShown,
  onOpenSplitDiscount,
  onCloseSplitDiscount,
  tags,
  splitLeft,
}: CategoryFieldsProps) {
  const { t } = useTranslation();

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{t('editor.split')}</label>

      <div className="space-y-3">
        {formData.splits.map((split, index) => (
          <div key={index} className="unfold p-3 space-y-2 border border-gray-200 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500">
                {t('editor.splitRow', { index: index + 1 })}
              </span>
              <button
                type="button"
                onClick={() => onRemoveSplit(index)}
                aria-label={t('editor.splitRemove')}
                className="p-1 text-gray-400 rounded transition-colors hover:text-gray-700 hover:bg-gray-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <input
              type="number"
              step="any"
              value={split.amount}
              onChange={(e) => onUpdateSplit(index, { amount: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="0"
            />

            {/*
              이 줄에서 깎인 금액.

              줄마다 따로 받는다. 여행경비만 환불받았는데 비율로 나누면
              식비 줄까지 함께 깎여, 분류별 분석이 사실과 어긋난다.

              나누지 않은 거래와 같이 그 줄 금액 바로 아래에 "할인·차감 추가" 글자로
              접어 두고, 펴면 "닫기"로 도로 접는다 (2026-10-11 사용자 요청).
            */}
            {formData.type === 'expense' && !isSplitDiscountShown(split) && (
              <button
                type="button"
                onClick={() => onOpenSplitDiscount(split.lineKey)}
                className="rounded text-sm font-medium text-blue-600 transition-colors hover:text-blue-700"
              >
                + {t('editor.discountAdd')}
              </button>
            )}
            {formData.type === 'expense' && isSplitDiscountShown(split) && (
              <div className="unfold">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className="block text-xs font-medium text-gray-500">{t('editor.discount')}</label>
                  <button
                    type="button"
                    onClick={() => {
                      onUpdateSplit(index, { discountAmount: '' });
                      onCloseSplitDiscount(split.lineKey);
                    }}
                    className="rounded px-2 py-0.5 text-xs font-medium text-gray-500 transition hover:bg-gray-100"
                  >
                    {t('common.close')}
                  </button>
                </div>
                <input
                  type="number"
                  step="any"
                  value={split.discountAmount}
                  onChange={(e) => onUpdateSplit(index, { discountAmount: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0"
                />
                {toNumber(split.discountAmount) > 0 && (
                  <p className="mt-1 text-xs font-medium text-gray-700">
                    {t('editor.netAmount', {
                      amount: formatCurrency(
                        toNumber(split.amount) - toNumber(split.discountAmount),
                        formData.currency,
                      ),
                    })}
                  </p>
                )}

                {/*
                  깎인 만큼 실적도 줄일지. 환불액을 적은 줄 바로 아래에 둔다.

                  **값은 거래에 하나뿐이다.** 깎인 금액은 줄마다 다르지만
                  그것을 실적에서 뺄지는 카드사의 방침 하나라, 어느 줄의
                  체크를 건드려도 나머지 줄의 체크가 같이 움직인다.
                */}
                {showDiscountPerformance({
                  kind: 'expense',
                  discountAmount: split.discountAmount,
                  countsPerformance: formData.countsPerformance,
                  isCard: formData.method === 'card' && Boolean(formData.cardId),
                  isLedgerCurrency: formData.currency === ledgerCurrency,
                }) && (
                  <label className="mt-2 flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.discountCountsPerformance}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          discountCountsPerformance: e.target.checked,
                        })
                      }
                      className="mt-0.5 h-4 w-4"
                    />
                    <span className="flex-1 text-xs text-gray-600">
                      {t('editor.discountCountsPerformance')}
                    </span>
                  </label>
                )}
              </div>
            )}

            <CustomSelect
              options={mainCategoryOptions}
              value={split.mainCategoryId}
              onChange={(value) => onUpdateSplit(index, { mainCategoryId: value, subCategoryId: '' })}
              placeholder={t('editor.parentCategory')}
              onAddClick={() => onAddCategory()}
              addButtonLabel={t('editor.addParentCategory')}
            />

            <CustomSelect
              options={subCategoryOptions(split.mainCategoryId)}
              value={split.subCategoryId}
              onChange={(value) => onUpdateSplit(index, { subCategoryId: value })}
              placeholder={t('editor.none')}
              /* 소분류는 대분류 아래에 붙는다. 고르기 전에는 붙일 곳이 없다. */
              onAddClick={split.mainCategoryId ? () => onAddCategory(split.mainCategoryId) : undefined}
              addButtonLabel={t('editor.addChildCategory')}
            />

            {/*
              이 줄의 태그.

              태그가 줄에 붙으므로 여기서 고른다. 나눈 두 줄이 서로 다른
              태그를 갖는 것이 이 바꿈의 요점이다 -- "이 결제는 여행이었다"가
              여행경비 줄의 사실이지 식비 줄의 사실은 아니다.
            */}
            {tags.length > 0 && (
              <div>
                <span className="mb-1 block text-xs font-medium text-gray-500">
                  {t('editor.tagsOptional')}
                </span>
                <TagPillButtons
                  tags={tags}
                  selectedIds={split.tagIds}
                  size="sm"
                  /* 앞선 값에서 뒤집는다. 잇달아 눌러도 앞엣것이 덮이지 않는다. */
                  onToggle={(tagId) =>
                    setFormData((previous) => ({
                      ...previous,
                      splits: previous.splits.map((row, at) =>
                        at === index ? { ...row, tagIds: toggleId(row.tagIds, tagId) } : row,
                      ),
                    }))
                  }
                />
              </div>
            )}
          </div>
        ))}

        <button
          type="button"
          onClick={onAddSplit}
          className="w-full px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg transition-colors hover:bg-gray-50"
        >
          {t('editor.splitAdd')}
        </button>

        {/*
          남은 금액을 보여 준다. 합이 맞아야 저장되므로, 저장을 눌러 보고서야
          어긋난 것을 알게 하지 않는다.
        */}
        <p className="text-xs text-gray-500">{t('editor.splitLeft', { amount: formatNumber(splitLeft) })}</p>
        <p className="text-xs text-gray-500">{t('editor.splitHint')}</p>
      </div>
    </div>
  );
}
