'use client';

/*
 * 이체에만 서는 칸들. 받는 계좌, 통화가 다른 환전의 받은 금액, 카드사와의 이동 안내,
 * 수수료와 그 분류다. 폼의 형제 칸이라 조각(fragment)으로 돌려준다.
 */
import { useTranslation } from '@money/core/lib/i18n';
import type { Category } from '@money/core/lib/types';
import type { CurrencyCode } from '@money/types';
import CustomSelect from '@/components/CustomSelect';
import {
  subCategoryOptionsOf,
  type EntryFormValues,
  type SelectOption,
  type SetEntryForm,
} from './editor-form';

export default function TransferFields({
  formData,
  setFormData,
  categories,
  toAccountOptions,
  isCrossCurrencyTransfer,
  paymentCurrency,
  toCurrency,
  transferCardSide,
  onAddCategory,
}: {
  formData: EntryFormValues;
  setFormData: SetEntryForm;
  categories: Category[];
  /** 받는 쪽에서 고를 수 있는 계좌 (보내는 쪽과 카드끼리를 뺐다). */
  toAccountOptions: SelectOption[];
  isCrossCurrencyTransfer: boolean;
  paymentCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  transferCardSide: 'payment' | 'refund' | null;
  onAddCategory: () => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{t('editor.toAccount')}</label>
        <CustomSelect
          options={toAccountOptions}
          value={formData.toAccountId}
          onChange={(value) => setFormData({ ...formData, toAccountId: value })}
        />
      </div>

      {/*
        통화가 다른 환전.

        보낸 금액과 받은 금액을 그대로 적으면 실제 적용된 환율이
        저절로 기록된다. 서버 환율로 추정하지 않으므로 은행 수수료가
        섞인 실거래 환율이 그대로 남는다.
      */}
      {isCrossCurrencyTransfer && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('editor.receivedAmount', { currency: toCurrency })}
          </label>
          <input
            type="number"
            step="any"
            value={formData.toAmount}
            onChange={(e) => setFormData({ ...formData, toAmount: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="135000"
          />
          <p className="mt-1 text-xs text-gray-500">
            {t('editor.exchangeHint', { from: paymentCurrency, to: toCurrency })}
          </p>
        </div>
      )}

      {/*
        한쪽이 신용카드면 카드사와의 자금 이동이다. 방향이 뜻을 바꾸므로
        저장하기 전에 무엇으로 기록되는지 알려 준다.
      */}
      {transferCardSide && (
        <div className="p-3 bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded-lg">
          {transferCardSide === 'payment' ? t('editor.toCardPayment') : t('editor.toCardRefund')}{' '}
          {t('editor.cardTransferNote')}
        </div>
      )}

      {/* 카드사와의 이체에는 수수료를 붙일 수 없다 (서버도 거부한다) */}
      <div className={transferCardSide ? 'hidden' : undefined}>
        <label className="block text-sm font-medium text-gray-700 mb-1">{t('editor.transferFee')}</label>
        <input
          type="number"
          step="any"
          value={formData.transferFee}
          onChange={(e) => setFormData({ ...formData, transferFee: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="0"
        />
      </div>

      {formData.transferFee && parseFloat(formData.transferFee) > 0 && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('editor.feeParentCategory')}
            </label>
            <CustomSelect
              options={categories
                .filter((c) => !c.parentId && c.type === 'expense')
                .map((cat) => ({ id: cat.id, name: cat.name }))}
              value={formData.transferFeeMainCategoryId}
              onChange={(value) =>
                setFormData({
                  ...formData,
                  transferFeeMainCategoryId: value,
                  transferFeeSubCategoryId: '',
                })
              }
              onAddClick={onAddCategory}
              addButtonLabel={t('editor.addParentCategory')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('editor.feeChildCategory')}
            </label>
            <CustomSelect
              options={subCategoryOptionsOf(categories, formData.transferFeeMainCategoryId, t('editor.none'))}
              value={formData.transferFeeSubCategoryId}
              onChange={(value) =>
                setFormData({
                  ...formData,
                  transferFeeSubCategoryId: value,
                })
              }
              placeholder={t('editor.none')}
            />
          </div>
        </>
      )}
    </>
  );
}
