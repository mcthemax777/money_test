'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import {
  SUPPORTED_CURRENCIES,
  type CurrencyCode,
} from '@money/types';
import Modal from '@/components/Modal';
import CustomSelect from '@/components/CustomSelect';
import { useInstitutions } from '@/hooks/useInstitutions';
import { ACCOUNT_TYPE_OPTIONS } from '@/lib/account-type';
import { useTranslation } from '@/lib/i18n';
import { currencyLabel, toAmountString } from '@/lib/money';
import type { AccountType } from '@/lib/types';
import type { Person } from '@/lib/types';
import { useApiError } from '@/lib/api-error';


interface AddAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (accounts: any[]) => void;
  people: Person[];
  /** 넘기지 않으면 서버가 기본 프로젝트로 만든다. */
  projectId?: string | null;
  /**
   * 통장 주인을 미리 골라 둔다. 구성원 상세에서 바로 들어온 경우처럼 주인이
   * 이미 정해진 자리에서 쓴다. 사용자가 폼에서 다른 사람으로 바꿀 수 있다.
   */
  defaultOwnerId?: string | null;
}


/** 개설 기관을 물어볼 필요가 없는 유형. 서버의 NO_INSTITUTION_TYPES와 같아야 한다. */
const NO_BANK_TYPES = ['cash', 'real_estate'];

/** 하단 고정 버튼과 본문 form을 잇는 id */
const FORM_ID = 'add-account-form';

const EMPTY_FORM = {
  ownerId: '',
  type: 'deposit' as AccountType,
  name: '',
  institutionId: '',
  currency: 'KRW' as CurrencyCode,
  openingBalance: '',
  accountNumber: '',
};

export default function AddAccountModal({
  isOpen,
  onClose,
  onSuccess,
  people,
  projectId,
  defaultOwnerId,
}: AddAccountModalProps) {
  const { t } = useTranslation();
  const { messageOf } = useApiError();
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const { options: bankOptions, error: bankError } = useInstitutions('bank');

  // 열릴 때 한 번만 채운다. 열려 있는 동안 사용자가 고른 값을 덮어쓰지 않는다.
  useEffect(() => {
    if (isOpen && defaultOwnerId) {
      setFormData((prev) => ({ ...prev, ownerId: defaultOwnerId }));
    }
  }, [isOpen, defaultOwnerId]);

  const needsBankName = !NO_BANK_TYPES.includes(formData.type);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      setError('');
      await apiClient.createAccountV2({
        ownerId: formData.ownerId,
        type: formData.type,
        name: formData.name,
        // 개설 잔액은 컬럼에 직접 쓰지 않고 원장 맨 앞(1970-01-01)의 기초잔액 전표로 기록된다.
        openingBalance: toAmountString(formData.openingBalance),
        currency: formData.currency,
        // 기관이 없는 유형(현금/부동산)에 institutionId를 보내면 서버가 거부한다.
        ...(needsBankName && formData.institutionId
          ? { institutionId: formData.institutionId }
          : {}),
        ...(formData.accountNumber ? { accountNumber: formData.accountNumber } : {}),
        ...(projectId ? { projectId } : {}),
      });
      const data = await apiClient.getAccountsV2(projectId);
      onSuccess(data || []);
      handleClose();
    } catch (err: any) {
      setError(messageOf(err, 'account.addFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setFormData(EMPTY_FORM);
    setError('');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('account.add')}
      /* 버튼은 form 밖(하단 고정 영역)에 있으므로 form 속성으로 묶는다 */
      footer={
        <button
          type="submit"
          form={FORM_ID}
          disabled={isSubmitting}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {isSubmitting ? t('account.adding') : t('account.addSubmit')}
        </button>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('account.name')}
          </label>
          <input
            type="text"
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={t('account.namePlaceholder')}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('account.owner')}
          </label>
          <CustomSelect
            options={people.map((p) => ({ id: p.id, name: p.name }))}
            value={formData.ownerId}
            onChange={(value) => setFormData({ ...formData, ownerId: value })}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('account.type')}
          </label>
          <CustomSelect
            options={ACCOUNT_TYPE_OPTIONS.map((option) => ({
              id: option.id,
              name: t(option.nameKey),
            }))}
            value={formData.type}
            onChange={(value) => setFormData({ ...formData, type: value as AccountType })}
          />
        </div>

        {needsBankName && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('account.institution')}
            </label>
            <CustomSelect
              options={bankOptions}
              value={formData.institutionId}
              onChange={(value) => setFormData({ ...formData, institutionId: value })}
              placeholder={t('account.institutionPlaceholder')}
            />
            {bankError && <p className="mt-1 text-xs text-red-600">{bankError}</p>}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('account.currency')}
          </label>
          <select
            value={formData.currency}
            onChange={(e) =>
              setFormData({ ...formData, currency: e.target.value as CurrencyCode })
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {SUPPORTED_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {currencyLabel(code)}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">{t('account.currencyHint')}</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('account.openingBalance', { currency: formData.currency })}
          </label>
          <input
            type="number"
            value={formData.openingBalance}
            onChange={(e) => setFormData({ ...formData, openingBalance: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="1000000"
          />
          <p className="mt-1 text-xs text-gray-500">
            {t('account.openingBalanceHint')}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('account.number')}
          </label>
          <input
            type="text"
            value={formData.accountNumber}
            onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={t('account.numberPlaceholder')}
          />
        </div>

        {error && (
          <div className="p-3 bg-red-50 text-red-800 text-sm rounded">{error}</div>
        )}
      </form>
    </Modal>
  );
}
