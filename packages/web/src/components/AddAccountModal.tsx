'use client';

import { useState } from 'react';
import { apiClient } from '@/lib/api-client';
import Modal from '@/components/Modal';
import CustomSelect from '@/components/CustomSelect';

interface Person {
  id: string;
  name: string;
}

interface AddAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (accounts: any[]) => void;
  people: Person[];
}

export default function AddAccountModal({
  isOpen,
  onClose,
  onSuccess,
  people,
}: AddAccountModalProps) {
  const [formData, setFormData] = useState({
    ownerId: '',
    name: '',
    bankName: '',
    balance: '',
    accountNumber: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      setError('');
      await apiClient.createAccountV2({
        ownerId: formData.ownerId,
        name: formData.name,
        balance: parseInt(formData.balance),
        bankName: formData.bankName,
        ...(formData.accountNumber && { accountNumber: formData.accountNumber }),
      });
      const data = await apiClient.getAccountsV2();
      onSuccess(data || []);
      handleClose();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || '계좌 추가에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setFormData({
      ownerId: '',
      name: '',
      bankName: '',
      balance: '',
      accountNumber: '',
    });
    setError('');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="계좌 추가"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            통장 주인
          </label>
          <CustomSelect
            options={people.map((p) => ({ id: p.id, name: p.name }))}
            value={formData.ownerId}
            onChange={(value) => setFormData({ ...formData, ownerId: value })}
            placeholder="선택하세요"
          />
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
            placeholder="1000000"
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
