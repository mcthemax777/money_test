'use client';

/*
 * 거래 폼의 결제수단 칸. 이체면 "보내는 계좌", 지출·수입이면 계좌·카드를 합친 결제수단이다.
 *
 * 카드를 고르면 그 아래에 실적 포함 체크와, 수입을 카드로 받을 때의 안내가 붙는다.
 */
import { useTranslation } from '@money/core/lib/i18n';
import type { Account, Card } from '@money/core/lib/types';
import CustomSelect from '@/components/CustomSelect';
import type { EntryFormValues, SelectOption, SetEntryForm } from './editor-form';

export default function MethodField({
  formData,
  setFormData,
  accounts,
  cards,
  transferFromOptions,
  paymentMethodOptions,
  selectedPaymentMethodId,
  onPaymentMethodChange,
  onAddMethod,
  isCreditCardSelected,
}: {
  formData: EntryFormValues;
  setFormData: SetEntryForm;
  accounts: Account[];
  cards: Card[];
  /** 이체의 보내는 쪽에서 고를 수 있는 계좌 (받는 쪽과 카드끼리를 뺐다). */
  transferFromOptions: SelectOption[];
  paymentMethodOptions: SelectOption[];
  selectedPaymentMethodId: string;
  onPaymentMethodChange: (value: string) => void;
  onAddMethod: () => void;
  isCreditCardSelected: boolean;
}) {
  const { t } = useTranslation();

  if (formData.type === 'transfer') {
    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{t('editor.fromAccount')}</label>
        {/* 신용카드를 고르면 카드사에 대금을 갚는 것이 아니라 환불을 받는 쪽이 된다 */}
        <CustomSelect
          options={transferFromOptions}
          value={formData.accountId}
          onChange={(value) => setFormData({ ...formData, method: 'account', accountId: value, cardId: '' })}
        />
      </div>
    );
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{t('editor.methodOptional')}</label>
      {/* 계좌와 카드를 한 목록에서 고른다. 접두사로 종류를 구분한다. */}
      <CustomSelect
        options={paymentMethodOptions}
        value={selectedPaymentMethodId}
        onChange={onPaymentMethodChange}
        onAddClick={onAddMethod}
        addButtonLabel={t('editor.addMethod')}
      />

      {/*
        카드 실적에 셀지. 카드를 골랐을 때만 뜬다.

        청구액과는 다른 값이다 -- 꺼도 갚을 대금은 그대로다. 지출은 켜짐이
        기본이고(쓴 돈이다) 카드로 들어온 돈은 꺼짐이 기본이다(캐시백은
        실적을 깎지 않는다).
      */}
      {formData.method === 'card' && formData.cardId && (
        <label className="mt-2 flex items-start gap-2 rounded-lg border border-gray-200 p-3 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.countsPerformance}
            onChange={(e) => setFormData({ ...formData, countsPerformance: e.target.checked })}
            className="mt-0.5 h-4 w-4"
          />
          <span className="flex-1">
            <span className="block text-sm text-gray-900">{t('editor.countsPerformance')}</span>
            <span className="mt-0.5 block text-xs text-gray-500">{t('editor.countsPerformanceHint')}</span>
          </span>
        </label>
      )}

      {/*
        수입을 카드로 받는 자리.

        신용카드면 통장으로 들어오는 돈이 아니라 그 카드의 빚이 줄고,
        체크카드면 연결 통장으로 들어온다. 둘이 전혀 다른 일이라 고른
        뒤에야 알게 하지 않는다.
      */}
      {formData.type === 'income' && formData.method === 'card' && formData.cardId && (
        <p className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          {isCreditCardSelected
            ? t('editor.cardIncomeNote')
            : t('editor.cardIncomeDebitNote', {
                account:
                  accounts.find(
                    (account) =>
                      account.id === cards.find((card) => card.id === formData.cardId)?.paymentAccountId,
                  )?.name ?? t('editor.methodAccount'),
              })}
        </p>
      )}
    </div>
  );
}
