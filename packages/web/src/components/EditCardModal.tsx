'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import type { Account, Card } from '@/lib/types';
import { toAmountString } from '@/lib/money';
import { monthInputOf, monthInputToIso } from '@/lib/datetime';
import Modal from '@/components/Modal';
import CustomSelect from '@/components/CustomSelect';
import { useInstitutions } from '@/hooks/useInstitutions';
import { DAY_OF_MONTH_HINT, DAY_OF_MONTH_OPTIONS } from '@/lib/day-of-month';

/** 하단 고정 버튼과 본문 form을 잇는 id */
const FORM_ID = 'edit-card-form';

const EMPTY_FORM = {
  paymentAccountId: '',
  name: '',
  issuerId: '',
  creditLimit: '',
  expiryDate: '',
  cardType: 'debit' as 'debit' | 'credit',
  // 서버는 마스킹된 번호만 주므로 입력칸은 항상 빈 값에서 시작한다.
  // 비워 두면 기존 번호를 그대로 두고, 새로 입력하면 그 값으로 교체한다.
  cardNumber: '',
  // 신용카드는 마감일과 결제일을 따로 관리한다 (구 statementClosingDay 하나를 대체)
  statementClosingDay: 15,
  paymentDueDay: 25,
};

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
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');
  const { options: issuerOptions, error: issuerError } = useInstitutions('card_issuer');

  // isOpen을 의존성에 넣는 이유는 EditAccountModal과 같다. 닫을 때 폼을 비우므로
  // 같은 카드로 다시 열 때 값을 채워 넣어야 한다.
  useEffect(() => {
    if (isOpen && card) {
      setFormData({
        paymentAccountId: card.paymentAccountId,
        name: card.name,
        issuerId: card.issuerId,
        creditLimit: card.creditLimit ?? '',
        // 저장된 값은 ISO 인스턴트다. 월 입력란이 읽는 "YYYY-MM"으로 바꾼다.
        expiryDate: monthInputOf(card.expiryDate),
        cardType: card.cardType,
        cardNumber: '',
        statementClosingDay: card.statementClosingDay ?? 15,
        paymentDueDay: card.paymentDueDay ?? 25,
      });
    }
  }, [isOpen, card]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!card) return;

    try {
      setIsSubmitting(true);
      setError('');

      // 카드사는 필수다. CustomSelect는 <input required>와 달리 브라우저 검증이 없어
      // 비워 두면 서버에서 "기관을 찾을 수 없습니다"가 돌아와 원인을 알기 어렵다.
      if (!formData.issuerId) {
        setError('발급사를 선택하세요.');
        setIsSubmitting(false);
        return;
      }

      // 결제 통장과 카드 종류는 등록 후 바꾸지 않는다.
      // 신용카드는 부채 계정이 딸려 있어서 통장을 갈아끼우면 원장이 어긋난다.
      const isCredit = card.cardType === 'credit';
      await apiClient.updateCard(card.id, {
        name: formData.name,
        issuerId: formData.issuerId,
        // 만료일을 비우면 null을 보내 지운다. 키를 빼면 기존 값이 남는다.
        expiryDate: monthInputToIso(formData.expiryDate),
        // 카드 번호는 새로 입력했을 때만 보낸다 (마스킹된 값을 되돌려 보내면 안 된다).
        ...(formData.cardNumber ? { cardNumber: formData.cardNumber } : {}),
        ...(isCredit
          ? {
              creditLimit: toAmountString(formData.creditLimit),
              statementClosingDay: formData.statementClosingDay,
              paymentDueDay: formData.paymentDueDay,
            }
          : {}),
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
    setFormData(EMPTY_FORM);
    setError('');
    onClose();
  };

  if (!card) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="카드 수정"
      /* 버튼은 form 밖(하단 고정 영역)이라 form 속성으로 묶는다 */
      footer={
        <div className="flex gap-2">
          <button
            type="submit"
            form={FORM_ID}
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
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
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
            placeholder={card.cardNumberMasked || '16자리'}
          />
          <p className="mt-1 text-xs text-gray-500">
            {card.cardNumberMasked
              ? '비워 두면 현재 번호를 그대로 씁니다. 바꾸려면 전체 번호를 입력하세요.'
              : '전체 번호를 입력하면 마스킹해서 보관합니다.'}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            카드 유형
          </label>
          {/* 신용카드는 부채 계정과 청구서가 딸려 있어 종류를 바꾸면 원장이 어긋난다. 표시만 한다. */}
          <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
            {formData.cardType === 'credit' ? '신용카드' : '체크카드'}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            발급사
          </label>
          <CustomSelect
            options={issuerOptions}
            value={formData.issuerId}
            onChange={(value) => setFormData({ ...formData, issuerId: value })}
            placeholder="카드사를 선택하세요"
          />
          {issuerError && <p className="mt-1 text-xs text-red-600">{issuerError}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            만료 월 (선택)
          </label>
          <input
            type="month"
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
                마감일
              </label>
              <select
                value={formData.statementClosingDay}
                onChange={(e) => setFormData({ ...formData, statementClosingDay: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {DAY_OF_MONTH_OPTIONS.map((option) => (
                  <option key={option.day} value={option.day}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">{DAY_OF_MONTH_HINT}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                결제일
              </label>
              <select
                value={formData.paymentDueDay}
                onChange={(e) => setFormData({ ...formData, paymentDueDay: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {DAY_OF_MONTH_OPTIONS.map((option) => (
                  <option key={option.day} value={option.day}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                마감 이후 처음 돌아오는 이 날짜에 청구됩니다. {DAY_OF_MONTH_HINT}
              </p>
            </div>
          </>
        )}

        {error && (
          <div className="p-3 bg-red-50 text-red-800 text-sm rounded">
            {error}
          </div>
        )}

      </form>
    </Modal>
  );
}
