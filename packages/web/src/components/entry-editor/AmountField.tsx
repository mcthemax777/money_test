'use client';

/*
 * 거래 폼의 금액 칸. 금액, 그 안의 통화 고르기, 외화일 때의 청구액·환율 안내가 한 덩어리다.
 */
import { useTranslation } from '@money/core/lib/i18n';
import { formatNumber } from '@money/core/lib/money';
import { SUPPORTED_CURRENCIES, type CurrencyCode } from '@money/types';
import type { EntryFormValues, SetEntryForm } from './editor-form';

export default function AmountField({
  formData,
  setFormData,
  ledgerCurrency,
  paymentCurrency,
  needsRate,
  needsBilled,
  mustBill,
  hasBilled,
  isCreditCardSelected,
  derivedRate,
  defaultRate,
  convertedPreview,
}: {
  formData: EntryFormValues;
  setFormData: SetEntryForm;
  ledgerCurrency: CurrencyCode;
  /** 지금 고른 결제수단의 통화 */
  paymentCurrency: CurrencyCode;
  needsRate: boolean;
  needsBilled: boolean;
  mustBill: boolean;
  hasBilled: boolean;
  isCreditCardSelected: boolean;
  /** 청구액을 넣었을 때 실제로 적용되는 환율. 넣지 않았으면 빈 값이다. */
  derivedRate: string;
  /** 설정의 환율. */
  defaultRate: string;
  /** 저장하면 기록될 장부 통화 금액. 셀 수 없으면 빈 값이다. */
  convertedPreview: string;
}) {
  const { t } = useTranslation();

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{t('editor.amount')}</label>
      {/*
        통화는 금액 칸 오른쪽 안에 지금 통화로 선다. 누르면 통화를 고른다 (2026-10-10 사용자
        요청). 결제수단을 고르면 그 계좌 통화로 맞춰지고, 원화 카드를 둔 채 달러로 바꾸면
        "원화 카드로 한 외화 결제"가 된다.
      */}
      <div className="flex items-stretch rounded-lg border border-gray-300 focus-within:ring-2 focus-within:ring-blue-500">
        <input
          type="number"
          step="any"
          required
          /* 팝업이 열리면 여기부터 입력한다 (Modal이 이 표시를 찾아 포커스한다) */
          data-autofocus
          value={formData.amount}
          onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
          className="flex-1 min-w-0 rounded-l-lg px-3 py-2 focus:outline-none"
          placeholder="50000"
        />
        <select
          value={formData.currency}
          aria-label={t('editor.currency')}
          onChange={(e) => {
            const currency = e.target.value as CurrencyCode;
            setFormData({
              ...formData,
              currency,
              billedAmount: '',
              // 직접 고른 통화다. 결제수단을 바꿔도 유지한다.
              currencyTouched: true,
            });
          }}
          className="shrink-0 cursor-pointer rounded-r-lg bg-transparent pl-2 pr-1 text-sm font-medium text-blue-600 focus:outline-none"
        >
          {SUPPORTED_CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </div>

      {needsRate && (
        <div className="mt-2 space-y-2">
          {/*
            환율은 받지 않는다. 실제 금액만 받고 환율은 계산해서 보여 준다.

            사용자가 아는 값은 "통장에서 얼마가 빠졌는가"이지 환율이 아니다.
            기본 환율이 실제와 다르면 설정에서 바꾼다. 여기서 환율을 받으면
            거래마다 서로 다른 값이 들어가 어떤 것이 맞는지 알 수 없게 된다.
          */}
          {needsBilled && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                {t(isCreditCardSelected ? 'editor.billedCredit' : 'editor.billedDebit', {
                  currency: ledgerCurrency,
                })}
                {mustBill && <span className="ml-1 text-red-500">*</span>}
              </label>
              <input
                type="number"
                step="any"
                required={mustBill}
                value={formData.billedAmount}
                onChange={(e) => setFormData({ ...formData, billedAmount: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={t(
                  isCreditCardSelected
                    ? 'editor.billedCreditPlaceholder'
                    : 'editor.billedDebitPlaceholder',
                )}
              />
              <p className="mt-1 text-xs text-gray-500">
                {isCreditCardSelected ? t('editor.billedCreditHint') : t('editor.billedDebitHint')}
              </p>
            </div>
          )}

          {/* 적용되는 환율. 입력값이 아니라 결과다. */}
          <div className="px-3 py-2 bg-gray-50 rounded-lg">
            <div className="flex justify-between text-xs">
              <span className="text-gray-600">
                {t('editor.rateLabel', { from: formData.currency, to: ledgerCurrency })}
              </span>
              <span className="font-medium text-gray-900">
                {derivedRate || formatNumber(defaultRate) || '-'}
                {!hasBilled && <span className="ml-1 text-gray-500">{t('editor.rateDefault')}</span>}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              {convertedPreview
                ? t('editor.recordedAs', { amount: convertedPreview })
                : t('editor.recordedHint')}
              {!hasBilled && t('editor.rateSettingsHint')}
            </p>
          </div>
        </div>
      )}

      {paymentCurrency !== formData.currency && formData.currency !== ledgerCurrency && (
        <p className="mt-1 text-xs text-gray-500">
          {t('editor.foreignHint', { payment: paymentCurrency, ledger: ledgerCurrency })}
        </p>
      )}
    </div>
  );
}
