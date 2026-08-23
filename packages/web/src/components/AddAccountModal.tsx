'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import {
  CURRENCY_LABEL,
  SUPPORTED_CURRENCIES,
  type CurrencyCode,
} from '@money/types';
import Modal from '@/components/Modal';
import CustomSelect from '@/components/CustomSelect';
import { useInstitutions } from '@/hooks/useInstitutions';
import { ACCOUNT_TYPE_OPTIONS } from '@/lib/account-type';
import { toAmountString } from '@/lib/money';
import type { AccountType } from '@/lib/types';
import type { Person } from '@/lib/types';


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
      setError(err?.response?.data?.error?.message || '계좌 추가에 실패했습니다.');
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
      title="계좌 추가"
      /* 버튼은 form 밖(하단 고정 영역)에 있으므로 form 속성으로 묶는다 */
      footer={
        <button
          type="submit"
          form={FORM_ID}
          disabled={isSubmitting}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {isSubmitting ? '추가 중...' : '추가하기'}
        </button>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">계좌명</label>
          <input
            type="text"
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="예: 급여 통장"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">통장 주인</label>
          <CustomSelect
            options={people.map((p) => ({ id: p.id, name: p.name }))}
            value={formData.ownerId}
            onChange={(value) => setFormData({ ...formData, ownerId: value })}
            placeholder="선택하세요"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">유형</label>
          <CustomSelect
            options={ACCOUNT_TYPE_OPTIONS}
            value={formData.type}
            onChange={(value) => setFormData({ ...formData, type: value as AccountType })}
            placeholder="선택하세요"
          />
        </div>

        {needsBankName && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">개설 기관</label>
            <CustomSelect
              options={bankOptions}
              value={formData.institutionId}
              onChange={(value) => setFormData({ ...formData, institutionId: value })}
              placeholder="은행 / 증권사를 선택하세요"
            />
            {bankError && <p className="mt-1 text-xs text-red-600">{bankError}</p>}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">통화</label>
          <select
            value={formData.currency}
            onChange={(e) =>
              setFormData({ ...formData, currency: e.target.value as CurrencyCode })
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {SUPPORTED_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {CURRENCY_LABEL[code]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            만든 뒤에는 바꿀 수 없습니다. 잔액과 거래가 이 통화로 기록됩니다.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            개설 잔액 ({formData.currency})
          </label>
          <input
            type="number"
            value={formData.openingBalance}
            onChange={(e) => setFormData({ ...formData, openingBalance: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="1000000"
          />
          <p className="mt-1 text-xs text-gray-500">
            거래내역 맨 앞의 "기초잔액" 한 건으로 기록됩니다. 이후 거래는 이 금액 위에 쌓입니다.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">계좌번호 (선택)</label>
          <input
            type="text"
            value={formData.accountNumber}
            onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="예: 123-456-7890"
          />
        </div>

        {error && (
          <div className="p-3 bg-red-50 text-red-800 text-sm rounded">{error}</div>
        )}
      </form>
    </Modal>
  );
}
