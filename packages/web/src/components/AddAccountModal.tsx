'use client';

import { useState } from 'react';
import { apiClient } from '@/lib/api-client';
import Modal from '@/components/Modal';
import CustomSelect from '@/components/CustomSelect';
import { useInstitutions } from '@/hooks/useInstitutions';
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
}

/**
 * 사용자가 직접 만드는 계좌 유형.
 * credit_card(카드 부채)와 opening_balance(자본)는 서버가 관리하므로 목록에 없다.
 */
const ACCOUNT_TYPES = [
  { id: 'deposit', name: '예금 / 입출금' },
  { id: 'savings', name: '저축' },
  { id: 'cash', name: '현금' },
  { id: 'investment', name: '투자' },
  { id: 'real_estate', name: '부동산' },
  { id: 'loan', name: '대출' },
];

/** 개설 기관을 물어볼 필요가 없는 유형. 서버의 NO_INSTITUTION_TYPES와 같아야 한다. */
const NO_BANK_TYPES = ['cash', 'real_estate'];

const EMPTY_FORM = {
  ownerId: '',
  type: 'deposit' as AccountType,
  name: '',
  institutionId: '',
  openingBalance: '',
  openingBalanceDate: new Date().toISOString().split('T')[0],
  accountNumber: '',
};

export default function AddAccountModal({
  isOpen,
  onClose,
  onSuccess,
  people,
  projectId,
}: AddAccountModalProps) {
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const { options: bankOptions, error: bankError } = useInstitutions('bank');

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
        // 개설 잔액은 컬럼에 직접 쓰지 않고 전표로 기록된다.
        // 기준일보다 앞선 거래를 넣을 계좌라면 날짜를 더 앞으로 잡아야 원장 순서가 맞는다.
        openingBalance: toAmountString(formData.openingBalance),
        openingBalanceDate: formData.openingBalanceDate,
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
    <Modal isOpen={isOpen} onClose={handleClose} title="계좌 추가">
      <form onSubmit={handleSubmit} className="space-y-4">
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
            options={ACCOUNT_TYPES}
            value={formData.type}
            onChange={(value) => setFormData({ ...formData, type: value as AccountType })}
            placeholder="선택하세요"
          />
        </div>

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
          <label className="block text-sm font-medium text-gray-700 mb-1">개설 잔액 (원)</label>
          <input
            type="number"
            value={formData.openingBalance}
            onChange={(e) => setFormData({ ...formData, openingBalance: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="1000000"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            개설 잔액 기준일
          </label>
          <input
            type="date"
            value={formData.openingBalanceDate}
            onChange={(e) => setFormData({ ...formData, openingBalanceDate: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-gray-500">
            이 날짜의 잔액으로 기록됩니다. 이전 거래를 입력할 계획이면 그보다 앞선 날짜를 고르세요.
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

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {isSubmitting ? '추가 중...' : '추가하기'}
        </button>
      </form>
    </Modal>
  );
}
