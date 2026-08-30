'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@money/core/lib/api-client';
import type { Account, Card } from '@money/core/lib/types';
import { useTranslation } from '@money/core/lib/i18n';
import { useProjectDisplayCurrency } from '@money/core/store/project';
import { toAmountString } from '@money/core/lib/money';
import { monthInputOf, monthInputToIso } from '@money/core/lib/datetime';
import Modal from '@/components/Modal';
import CustomSelect from '@/components/CustomSelect';
import { useInstitutions } from '@/hooks/useInstitutions';
import {
  dayOfMonthHint,
  dayOfMonthOptions,
  DEFAULT_PAYMENT_DUE_DAY,
  DEFAULT_STATEMENT_CLOSING_DAY,
} from '@money/core/lib/day-of-month';
import CardColorPicker from '@/components/CardColorPicker';
import CardPerformanceField from '@/components/CardPerformanceField';
import { useApiError } from '@money/core/lib/api-error';

/** 하단 고정 버튼과 본문 form을 잇는 id */
const FORM_ID = 'edit-card-form';

const EMPTY_FORM = {
  paymentAccountId: '',
  name: '',
  issuerId: '',
  creditLimit: '',
  performanceAmount: '',
  expiryDate: '',
  cardType: 'debit' as 'debit' | 'credit',
  // 서버는 마스킹된 번호만 주므로 입력칸은 항상 빈 값에서 시작한다.
  // 비워 두면 기존 번호를 그대로 두고, 새로 입력하면 그 값으로 교체한다.
  cardNumber: '',
  /** 카드 앞면 색. 빈 값이면 카드 종류의 기본색으로 그린다. */
  color: '',
  // 신용카드는 마감일과 결제일을 따로 관리한다 (구 statementClosingDay 하나를 대체)
  statementClosingDay: DEFAULT_STATEMENT_CLOSING_DAY,
  paymentDueDay: DEFAULT_PAYMENT_DUE_DAY,
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
  const { t } = useTranslation();
  const { messageOf } = useApiError();
  /* 한도는 프로젝트 기준통화로 적는다. 카드 행에는 통화가 없다. */
  const displayCurrency = useProjectDisplayCurrency();
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
        performanceAmount: card.performanceAmount ?? '',
        // 저장된 값은 ISO 인스턴트다. 월 입력란이 읽는 "YYYY-MM"으로 바꾼다.
        expiryDate: monthInputOf(card.expiryDate),
        cardType: card.cardType,
        cardNumber: '',
        color: card.color ?? '',
        statementClosingDay: card.statementClosingDay ?? DEFAULT_STATEMENT_CLOSING_DAY,
        paymentDueDay: card.paymentDueDay ?? DEFAULT_PAYMENT_DUE_DAY,
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
        setError(t('card.issuerRequired'));
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
        // 실적은 카드 종류를 가리지 않는다. 비우면 빈 문자열을 보내 조건을 지운다.
        performanceAmount: formData.performanceAmount
          ? toAmountString(formData.performanceAmount)
          : '',
        // 비우면 빈 문자열을 보내 기본색으로 되돌린다.
        color: formData.color,
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
      setError(messageOf(err, 'account.editFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteClick = async () => {
    if (!card) return;
    if (!window.confirm(t('account.deleteConfirm'))) return;

    try {
      setIsDeleting(true);
      setError('');
      await onDelete(card.id);
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

  if (!card) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('card.edit')}
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
            {t('card.paymentAccount')}
          </label>
          {/* 신용카드는 부채 계정이 딸려 있어 통장을 바꾸면 원장이 어긋난다. 표시만 한다. */}
          <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
            {accounts.find((acc) => acc.id === formData.paymentAccountId)?.name || '-'}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('card.name')}
          </label>
          <input
            type="text"
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={t('card.namePlaceholder')}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('card.numberOptional')}
          </label>
          <input
            type="text"
            value={formData.cardNumber}
            onChange={(e) => setFormData({ ...formData, cardNumber: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={card.cardNumberMasked || t('card.numberPlaceholder')}
          />
          <p className="mt-1 text-xs text-gray-500">
            {card.cardNumberMasked
              ? t('card.numberKeepHint')
              : t('card.numberMaskHint')}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('card.type')}
          </label>
          {/* 신용카드는 부채 계정과 청구서가 딸려 있어 종류를 바꾸면 원장이 어긋난다. 표시만 한다. */}
          <p className="px-3 py-2 bg-gray-50 rounded-lg text-gray-900">
            {t(formData.cardType === 'credit' ? 'method.credit_card' : 'method.debit_card')}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('card.issuer')}
          </label>
          <CustomSelect
            options={issuerOptions}
            value={formData.issuerId}
            onChange={(value) => setFormData({ ...formData, issuerId: value })}
            placeholder={t('card.issuerPlaceholder')}
          />
          {issuerError && <p className="mt-1 text-xs text-red-600">{issuerError}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('card.expiry')}
          </label>
          <input
            type="month"
            value={formData.expiryDate}
            onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('card.colorPlain')}</label>
          <CardColorPicker
            value={formData.color}
            onChange={(color) => setFormData({ ...formData, color })}
          />
        </div>

        <CardPerformanceField
          cardType={formData.cardType}
          value={formData.performanceAmount}
          onChange={(performanceAmount) => setFormData({ ...formData, performanceAmount })}
          statementClosingDay={formData.statementClosingDay}
        />

        {formData.cardType === 'credit' && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('card.limit', { currency: displayCurrency })}
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
                {t('card.closingDay')}
              </label>
              <select
                value={formData.statementClosingDay}
                onChange={(e) => setFormData({ ...formData, statementClosingDay: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {dayOfMonthOptions().map((option) => (
                  <option key={option.day} value={option.day}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">{dayOfMonthHint()}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('card.paymentDay')}
              </label>
              <select
                value={formData.paymentDueDay}
                onChange={(e) => setFormData({ ...formData, paymentDueDay: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {dayOfMonthOptions().map((option) => (
                  <option key={option.day} value={option.day}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                {t('card.dueHint', { hint: dayOfMonthHint() })}
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
