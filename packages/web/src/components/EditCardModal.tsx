'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import Modal from '@/components/Modal';
import CustomSelect from '@/components/CustomSelect';

interface Card {
  id: string;
  name: string;
  accountId: string;
  cardNumberMasked: string;
  cardType: 'debit' | 'credit';
  issuer: string;
  creditLimit?: number;
  currentBalance?: number;
  expiryDate?: string;
  billingDayOfMonth?: number;
}

interface Account {
  id: string;
  name: string;
}

interface EditCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  card: Card | null;
  accounts: Account[];
  onSuccess: (updatedCards: Card[]) => void;
  onDelete: (id: string) => Promise<void>;
}

export default function EditCardModal({
  isOpen,
  onClose,
  card,
  accounts,
  onSuccess,
  onDelete,
}: EditCardModalProps) {
  const [formData, setFormData] = useState({
    accountId: '',
    name: '',
    issuer: '',
    creditLimit: '',
    expiryDate: '',
    cardType: 'debit' as 'debit' | 'credit',
    cardNumber: '',
    billingDayOfMonth: 1,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (card) {
      setFormData({
        accountId: card.accountId,
        name: card.name,
        issuer: card.issuer,
        creditLimit: card.creditLimit?.toString() || '',
        expiryDate: card.expiryDate || '',
        cardType: card.cardType,
        cardNumber: card.cardNumberMasked || '',
        billingDayOfMonth: card.billingDayOfMonth || 1,
      });
    }
  }, [card]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!card) return;

    try {
      setIsSubmitting(true);
      setError('');
      const isoDate = formData.expiryDate ? new Date(formData.expiryDate).toISOString() : undefined;
      await apiClient.updateCard(card.id, {
        name: formData.name,
        accountId: formData.accountId,
        issuer: formData.issuer,
        cardType: formData.cardType,
        ...(formData.cardNumber && { cardNumber: formData.cardNumber }),
        ...(isoDate && { expiryDate: isoDate }),
        creditLimit: formData.cardType === 'credit' ? parseInt(formData.creditLimit) : undefined,
        billingDayOfMonth: formData.cardType === 'credit' ? formData.billingDayOfMonth : undefined,
      });
      const data = await apiClient.getCards();
      onSuccess(data || []);
      handleClose();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || '수정에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteClick = async () => {
    if (!card) return;
    if (!window.confirm('정말 삭제하시겠습니까?')) return;

    try {
      setIsDeleting(true);
      setError('');
      await onDelete(card.id);
      handleClose();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || '삭제에 실패했습니다.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleClose = () => {
    setFormData({
      accountId: '',
      name: '',
      issuer: '',
      creditLimit: '',
      expiryDate: '',
      cardType: 'debit',
      cardNumber: '',
      billingDayOfMonth: 1,
    });
    setError('');
    onClose();
  };

  if (!card) return null;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="카드 수정">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            계좌
          </label>
          <CustomSelect
            options={accounts.map((acc) => ({ id: acc.id, name: acc.name }))}
            value={formData.accountId}
            onChange={(value) => setFormData({ ...formData, accountId: value })}
            placeholder="선택하세요"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            카드 이름
          </label>
          <input
            type="text"
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="예: 내 체크카드"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            카드 번호 (선택)
          </label>
          <input
            type="text"
            value={formData.cardNumber}
            onChange={(e) => setFormData({ ...formData, cardNumber: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="16자리"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            카드 유형
          </label>
          <CustomSelect
            options={[
              { id: 'debit', name: '체크카드' },
              { id: 'credit', name: '신용카드' },
            ]}
            value={formData.cardType}
            onChange={(value) => setFormData({ ...formData, cardType: value as 'debit' | 'credit' })}
            placeholder="선택하세요"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            발급사
          </label>
          <input
            type="text"
            required
            value={formData.issuer}
            onChange={(e) => setFormData({ ...formData, issuer: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="KB Bank, Samsung Card 등"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            만료일 (선택)
          </label>
          <input
            type="date"
            value={formData.expiryDate}
            onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {formData.cardType === 'credit' && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                신용한도 (원)
              </label>
              <input
                type="number"
                value={formData.creditLimit}
                onChange={(e) => setFormData({ ...formData, creditLimit: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="5000000"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                결제일 (매월 몇 일?)
              </label>
              <select
                value={formData.billingDayOfMonth}
                onChange={(e) => setFormData({ ...formData, billingDayOfMonth: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                  <option key={day} value={day}>
                    {day}일
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

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
