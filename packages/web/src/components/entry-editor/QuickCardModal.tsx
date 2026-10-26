'use client';

/*
 * 거래 폼 안에서 카드를 바로 만드는 팝업. 결제수단 칸의 "추가"에서 카드를 고르면 뜬다.
 *
 * 자산 화면의 카드 추가와는 칸이 조금 다르다 (알림 문구 칸이 없고, 한도는 장부 통화로
 * 적는다). 폼 값과 오류는 이 팝업이 들고, 열림만 부르는 쪽이 정한다.
 */
import { useState } from 'react';
import { apiClient } from '@money/core/lib/api-client';
import { useApiError } from '@money/core/lib/api-error';
import { useInstitutions } from '@money/core/hooks/useInstitutions';
import { useTranslation } from '@money/core/lib/i18n';
import { toAmountString } from '@money/core/lib/money';
import { monthInputToIso } from '@money/core/lib/datetime';
import {
  dayOfMonthHint,
  dayOfMonthOptions,
  DEFAULT_PAYMENT_DUE_DAY,
  DEFAULT_STATEMENT_CLOSING_DAY,
} from '@money/core/lib/day-of-month';
import type { Account, Card } from '@money/core/lib/types';
import type { CurrencyCode } from '@money/types';
import CardColorPicker from '@/components/CardColorPicker';
import CardPerformanceField from '@/components/CardPerformanceField';
import CustomSelect from '@/components/CustomSelect';
import Modal from '@/components/Modal';

/** 하단 고정 버튼과 본문 form을 잇는 id (Modal의 footer는 form 밖에 렌더링된다) */
const CARD_FORM_ID = 'card-form';

/** 빈 카드 폼. 처음과 만든 뒤에 같은 값으로 되돌린다. */
function emptyCardForm() {
  return {
    accountId: '',
    name: '',
    cardNumber: '',
    cardType: 'debit' as 'debit' | 'credit',
    issuerId: '',
    expiryDate: '',
    creditLimit: '',
    /** 혜택 조건이 되는 사용액. 체크카드도 쓴다 (달력 월로 센다). */
    performanceAmount: '',
    /** 카드 앞면 색. 빈 값이면 카드 종류의 기본색으로 그린다. */
    color: '',
    // 청구 주기는 마감일과 결제일 두 값으로 계산한다
    statementClosingDay: DEFAULT_STATEMENT_CLOSING_DAY,
    paymentDueDay: DEFAULT_PAYMENT_DUE_DAY,
  };
}

export default function QuickCardModal({
  isOpen,
  onClose,
  projectId,
  accounts,
  ledgerCurrency,
  onCardsChange,
}: {
  isOpen: boolean;
  onClose: () => void;
  projectId: string | null;
  accounts: Account[];
  ledgerCurrency: CurrencyCode;
  /** 카드를 만든 뒤 다시 받은 카드 목록. */
  onCardsChange: (cards: Card[]) => void;
}) {
  const { t } = useTranslation();
  const { messageOf } = useApiError();
  const { options: issuerOptions } = useInstitutions('card_issuer');
  const [cardFormData, setCardFormData] = useState(emptyCardForm);
  const [cardSubmitting, setCardSubmitting] = useState(false);
  /** 카드 만들기 창의 오류. 예전에는 콘솔에만 남아 단추가 아무 일도 하지 않는 것처럼 보였다 (2026-10-16). */
  const [cardError, setCardError] = useState('');

  const handleCardSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setCardSubmitting(true);
      setCardError('');

      // 카드사는 필수다. CustomSelect는 <input required>와 달리 브라우저 검증이 없어
      // 비워 두면 서버에서 "기관을 찾을 수 없습니다"가 돌아와 원인을 알기 어렵다.
      if (!cardFormData.issuerId) {
        alert(t('card.issuerRequired'));
        setCardSubmitting(false);
        return;
      }

      // 만료일은 월까지만 받는다. 저장은 그 달 말일로 한다.
      const isoDate = monthInputToIso(cardFormData.expiryDate) ?? undefined;
      const isCredit = cardFormData.cardType === 'credit';
      await apiClient.createCard({
        // 결제 통장은 사용자가 만든 계좌여야 한다. 신용카드면 서버가 부채 계정을 함께 만든다.
        paymentAccountId: cardFormData.accountId,
        name: cardFormData.name,
        ...(cardFormData.cardNumber && { cardNumber: cardFormData.cardNumber }),
        cardType: cardFormData.cardType,
        issuerId: cardFormData.issuerId,
        ...(isoDate && { expiryDate: isoDate }),
        creditLimit: isCredit ? toAmountString(cardFormData.creditLimit) : undefined,
        // 실적은 카드 종류를 가리지 않는다. 비워 두면 조건 없음이라 빈 문자열로 보낸다.
        performanceAmount: cardFormData.performanceAmount
          ? toAmountString(cardFormData.performanceAmount)
          : '',
        // 비워 두면 보내지 않는다. 서버는 null로 두고 화면이 종류별 기본색을 쓴다.
        color: cardFormData.color || undefined,
        // 신용카드는 마감일과 결제일이 필수다 (없으면 청구서를 만들 수 없다)
        statementClosingDay: isCredit ? cardFormData.statementClosingDay : undefined,
        paymentDueDay: isCredit ? cardFormData.paymentDueDay : undefined,
        projectId: projectId ?? undefined,
      });
      const data = await apiClient.getCards(projectId);
      onCardsChange(data || []);
      setCardFormData(emptyCardForm());
      onClose();
    } catch (err) {
      console.error('카드 추가 실패:', err);
      setCardError(messageOf(err, 'card.addFailed'));
    } finally {
      setCardSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        onClose();
        setCardError('');
      }}
      title={t('card.add')}
      footer={
        <button
          type="submit"
          form={CARD_FORM_ID}
          disabled={cardSubmitting}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {cardSubmitting ? t('account.adding') : t('account.addSubmit')}
        </button>
      }
    >
      <form id={CARD_FORM_ID} onSubmit={handleCardSubmit} className="space-y-4">
        {cardError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {cardError}
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('card.name')}</label>
          <input
            type="text"
            required
            value={cardFormData.name}
            onChange={(e) => setCardFormData({ ...cardFormData, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={t('card.namePlaceholder')}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('card.account')}</label>
          <CustomSelect
            options={accounts.map((acc) => ({ id: acc.id, name: acc.name }))}
            value={cardFormData.accountId}
            onChange={(value) => setCardFormData({ ...cardFormData, accountId: value })}
            onAddClick={() => {}}
            addButtonLabel={t('account.add')}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('card.numberOptional')}</label>
          <input
            type="text"
            value={cardFormData.cardNumber}
            onChange={(e) => setCardFormData({ ...cardFormData, cardNumber: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={t('card.numberPlaceholder')}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('card.type')}</label>
          <CustomSelect
            options={[
              { id: 'debit', name: t('method.debit_card') },
              { id: 'credit', name: t('method.credit_card') },
            ]}
            value={cardFormData.cardType}
            onChange={(value) => setCardFormData({ ...cardFormData, cardType: value as 'debit' | 'credit' })}
            onAddClick={() => {}}
            addButtonLabel=""
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('card.issuer')}</label>
          <CustomSelect
            options={issuerOptions}
            value={cardFormData.issuerId}
            onChange={(value) => setCardFormData({ ...cardFormData, issuerId: value })}
            placeholder={t('card.issuerPlaceholder')}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('card.expiry')}</label>
          <input
            type="month"
            value={cardFormData.expiryDate}
            onChange={(e) => setCardFormData({ ...cardFormData, expiryDate: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('card.color')}</label>
          <CardColorPicker
            value={cardFormData.color}
            onChange={(color) => setCardFormData({ ...cardFormData, color })}
          />
        </div>

        <CardPerformanceField
          cardType={cardFormData.cardType}
          value={cardFormData.performanceAmount}
          onChange={(performanceAmount) => setCardFormData({ ...cardFormData, performanceAmount })}
          statementClosingDay={cardFormData.statementClosingDay}
        />

        {cardFormData.cardType === 'credit' && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('card.limit', { currency: ledgerCurrency })}
              </label>
              <input
                type="number"
                step="any"
                value={cardFormData.creditLimit}
                onChange={(e) => setCardFormData({ ...cardFormData, creditLimit: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="5000000"
              />
            </div>

            {/* 마감일과 결제일로 청구 주기를 계산한다 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('card.closingDay')}</label>
              <select
                value={cardFormData.statementClosingDay}
                onChange={(e) =>
                  setCardFormData({ ...cardFormData, statementClosingDay: parseInt(e.target.value) })
                }
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
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('card.paymentDay')}</label>
              <select
                value={cardFormData.paymentDueDay}
                onChange={(e) => setCardFormData({ ...cardFormData, paymentDueDay: parseInt(e.target.value) })}
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
          </>
        )}
      </form>
    </Modal>
  );
}
