'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import type { Account, Person } from '@/lib/types';
import { toAmountString } from '@/lib/money';
import Modal from '@/components/Modal';
import CustomSelect from '@/components/CustomSelect';


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
  const [formData, setFormData] = useState({
    ownerId: '',
    name: '',
    bankName: '',
    accountNumber: '',
    balance: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (account) {
      setFormData({
        ownerId: account.ownerId ?? '',
        name: account.name,
        bankName: account.bankName ?? '',
        accountNumber: account.accountNumber || '',
        balance: account.balance,
      });
    }
  }, [account]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account) return;

    try {
      setIsSubmitting(true);
      setError('');
      // 잔액을 고치면 서버가 차액만큼 조정 전표를 남긴다 (컬럼을 덮어쓰지 않는다).
      // 계좌 주인은 원장에 이미 반영돼 있어 바꾸지 않는다.
      await apiClient.updateAccountV2(account.id, {
        name: formData.name,
        balance: toAmountString(formData.balance),
        bankName: formData.bankName,
        ...(formData.accountNumber && { accountNumber: formData.accountNumber }),
      });
      const data = await apiClient.getAccountsV2(projectId);
      onSuccess(data || []);
      handleClose();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || '수정에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteClick = async () => {
    if (!account) return;
    if (!window.confirm('정말 삭제하시겠습니까?')) return;

    try {
      setIsDeleting(true);
      setError('');
      await onDelete(account.id);
      handleClose();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || '삭제에 실패했습니다.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleClose = () => {
    setFormData({ ownerId: '', name: '', bankName: '', accountNumber: '', balance: '' });
    setError('');
    onClose();
  };

  if (!account) return null;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="계좌 수정">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            통장 주인
          </label>
          {/* 주인은 이미 원장 전표에 반영돼 있어 나중에 바꾸지 않는다. 표시만 한다. */}
          <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
            {people.find((p) => p.id === formData.ownerId)?.name || '-'}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            계좌명
          </label>
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
          <label className="block text-sm font-medium text-gray-700 mb-1">
            은행명
          </label>
          <input
            type="text"
            required
            value={formData.bankName}
            onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="KB Bank, Samsung Bank 등"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            초기 잔액 (원)
          </label>
          <input
            type="number"
            required
            value={formData.balance}
            onChange={(e) => setFormData({ ...formData, balance: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="0"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            계좌번호 (선택)
          </label>
          <input
            type="text"
            value={formData.accountNumber}
            onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="예: 123-456-7890"
          />
        </div>

        {error && (
          <div className="p-3 bg-red-50 text-red-800 text-sm rounded">
            {error}
          </div>
        )}

        <div className="flex gap-2 pt-4">
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? '수정 중...' : '수정하기'}
          </button>
          <button
            type="button"
            onClick={handleDeleteClick}
            disabled={isDeleting || isSubmitting}
            className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
          >
            {isDeleting ? '삭제 중...' : '삭제하기'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
