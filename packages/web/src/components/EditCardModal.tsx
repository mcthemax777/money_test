'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import type { Account, Card } from '@/lib/types';
import { toAmountString } from '@/lib/money';
import Modal from '@/components/Modal';
import CustomSelect from '@/components/CustomSelect';



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
    paymentAccountId: '',
    name: '',
    issuer: '',
    creditLimit: '',
    expiryDate: '',
    cardType: 'debit' as 'debit' | 'credit',
    cardNumber: '',
    // 신용카드는 마감일과 결제일을 따로 관리한다 (구 statementClosingDay 하나를 대체)
    statementClosingDay: 15,
    paymentDueDay: 25,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (card) {
      setFormData({
        paymentAccountId: card.paymentAccountId,
        name: card.name,
        issuer: card.issuer,
        creditLimit: card.creditLimit ?? '',
        expiryDate: card.expiryDate || '',
        cardType: card.cardType,
        cardNumber: card.cardNumberMasked || '',
        statementClosingDay: card.statementClosingDay ?? 15,
        paymentDueDay: card.paymentDueDay ?? 25,
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
      // 결제 통장과 카드 종류는 등록 후 바꾸지 않는다.
      // 신용카드는 부채 계정이 딸려 있어서 통장을 갈아끼우면 원장이 어긋난다.
      await apiClient.updateCard(card.id, {
        name: formData.name,
        creditLimit: formData.cardType === 'credit' ? toAmountString(formData.creditLimit) : undefined,
        statementClosingDay: formData.cardType === 'credit' ? formData.statementClosingDay : undefined,
        paymentDueDay: formData.cardType === 'credit' ? formData.paymentDueDay : undefined,
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
      paymentAccountId: '',
      name: '',
      issuer: '',
      creditLimit: '',
      expiryDate: '',
      cardType: 'debit',
      cardNumber: '',
      statementClosingDay: 15,
      paymentDueDay: 25,
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
            결제 통장
          </label>
          {/* 신용카드는 부채 계정이 딸려 있어 통장을 바꾸면 원장이 어긋난다. 표시만 한다. */}
          <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
            {accounts.find((acc) => acc.id === formData.paymentAccountId)?.name || '-'}
          </p>
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
                value={formData.statementClosingDay}
                onChange={(e) => setFormData({ ...formData, statementClosingDay: parseInt(e.target.value) })}
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
