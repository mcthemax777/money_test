'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@money/core/lib/api-client';
import type { Account, Person } from '@money/core/lib/types';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency, toAmountString } from '@money/core/lib/money';
import Modal from '@/components/Modal';
import CustomSelect from '@/components/CustomSelect';
import { useInstitutions } from '@/hooks/useInstitutions';
import { useApiError } from '@money/core/lib/api-error';

/** 개설 기관이 없는 유형. AddAccountModal, 서버의 NO_INSTITUTION_TYPES와 같아야 한다. */
const NO_BANK_TYPES = ['cash', 'real_estate'];
/** 하단 고정 버튼과 본문 form을 잇는 id */
const FORM_ID = 'edit-account-form';


const EMPTY_FORM = {
  ownerId: '',
  name: '',
  institutionId: '',
  accountNumber: '',
  balance: '',
};


interface EditAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  account: Account | null;
  people: Person[];
  onSuccess: (updatedAccounts: Account[]) => void;
  onDelete: (id: string) => Promise<void>;
  /** 넘기지 않으면 서버가 기본 프로젝트로 조회한다. */
  projectId?: string | null;
}

export default function EditAccountModal({
  isOpen,
  onClose,
  account,
  people,
  onSuccess,
  onDelete,
  projectId,
}: EditAccountModalProps) {
  const { t } = useTranslation();
  const { messageOf } = useApiError();
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');
  const { options: bankOptions, error: bankError } = useInstitutions('bank');

  const needsBankName = !!account && !NO_BANK_TYPES.includes(account.type);

  // isOpen을 의존성에 넣는 이유: 닫을 때 폼을 비우므로, 같은 계좌 객체(참조 동일)로
  // 다시 열면 account만 볼 때는 effect가 재실행되지 않아 빈 폼이 보였다.
  useEffect(() => {
    if (isOpen && account) {
      setFormData({
        ownerId: account.ownerId ?? '',
        name: account.name,
        institutionId: account.institutionId ?? '',
        accountNumber: account.accountNumber || '',
        balance: account.balance,
      });
    }
  }, [isOpen, account]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account) return;

    try {
      setIsSubmitting(true);
      setError('');
      // 잔액을 고치면 서버가 기초잔액 전표를 다시 계산한다 (조정 전표가 새로 생기지 않는다).
      // 계좌 주인은 원장에 이미 반영돼 있어 바꾸지 않는다.
      await apiClient.updateAccountV2(account.id, {
        name: formData.name,
        balance: toAmountString(formData.balance),
        // 기관을 비우면 null을 보내 연결을 끊는다. ''를 그대로 보내면 서버가 없는 id로 본다.
        ...(needsBankName ? { institutionId: formData.institutionId || null } : {}),
        ...(formData.accountNumber && { accountNumber: formData.accountNumber }),
      });
      const data = await apiClient.getAccountsV2(projectId);
      onSuccess(data || []);
      handleClose();
    } catch (err: any) {
      setError(messageOf(err, 'account.editFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteClick = async () => {
    if (!account) return;
    if (!window.confirm(t('account.deleteConfirm'))) return;

    try {
      setIsDeleting(true);
      setError('');
      await onDelete(account.id);
      handleClose();
    } catch (err: any) {
      setError(messageOf(err, 'account.deleteFailed'));
    } finally {
      setIsDeleting(false);
    }
  };

  const handleClose = () => {
    setFormData(EMPTY_FORM);
    setError('');
    onClose();
  };

  if (!account) return null;

  // 문자열 비교는 "10000"과 "10000.00"을 다르게 본다. 숫자로 견준다.
  const balanceChanged =
    formData.balance !== '' && Number(formData.balance) !== Number(account.balance);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('account.edit')}
      /* 버튼은 form 밖(하단 고정 영역)이라 form 속성으로 묶는다 */
      footer={
        <div className="flex gap-2">
          <button
            type="submit"
            form={FORM_ID}
            disabled={isSubmitting}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? t('account.editing') : t('account.editSubmit')}
          </button>
          <button
            type="button"
            onClick={handleDeleteClick}
            disabled={isDeleting || isSubmitting}
            className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
          >
            {isDeleting ? t('account.deleting') : t('account.deleteSubmit')}
          </button>
        </div>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('account.owner')}
          </label>
          {/* 주인은 이미 원장 전표에 반영돼 있어 나중에 바꾸지 않는다. 표시만 한다. */}
          <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
            {people.find((p) => p.id === formData.ownerId)?.name || '-'}
          </p>
        </div>

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
            {t('account.currentBalance', { currency: account.currency })}
          </label>
          <input
            type="number"
            required
            value={formData.balance}
            onChange={(e) => setFormData({ ...formData, balance: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="0"
          />
          {/* 잔액을 실제로 바꿨을 때만 경고한다. 다른 항목만 고치는 경우에는 뜨지 않는다. */}
          {balanceChanged && (
            <div className="mt-2 p-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg">
              {t('account.balanceHint', {
                from: formatCurrency(account.balance, account.currency),
                to: formatCurrency(toAmountString(formData.balance), account.currency),
              })}
            </div>
          )}
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
          <div className="p-3 bg-red-50 text-red-800 text-sm rounded">
            {error}
          </div>
        )}

      </form>
    </Modal>
  );
}
