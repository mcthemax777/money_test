'use client';

/*
 * 자산 화면의 카드 추가 팝업.
 *
 * 붙박이 추가 단추와 계좌 상세의 "카드 추가"가 연다. 계좌 상세에서 열면 결제 통장이 그
 * 계좌로 채워져 있다. 폼 상태와 저장은 `useAssetCardAdd` 가 갖고, 팝업은 그것을 그린다.
 *
 * 거래 폼 안의 카드 만들기(entry-editor/QuickCardModal)와는 칸이 조금 다르다 -- 여기에는
 * 알림 문구 칸과 색 안내가 있고, 한도는 표시 통화로 적는다.
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
import { useProjectDisplayCurrency } from '@money/core/store/project';
import CardColorPicker from '@/components/CardColorPicker';
import CardPerformanceField from '@/components/CardPerformanceField';
import CustomSelect from '@/components/CustomSelect';
import MatchTextField from '@/components/MatchTextField';
import Modal from '@/components/Modal';

/** 하단 고정 버튼과 본문 form을 잇는 id (Modal의 footer는 form 밖에 렌더링된다) */
const CARD_ADD_FORM_ID = 'card-add-form';

/** 카드 추가 폼의 빈 모양. 처음, 추가한 뒤, 닫을 때 같은 값으로 되돌린다. */
const EMPTY_CARD_FORM = {
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
  /** 알림에서 이 카드를 알아보는 말. 여러 줄이다. */
  matchText: '',
  // 청구 주기는 마감일과 결제일 두 값으로 계산한다
  statementClosingDay: DEFAULT_STATEMENT_CLOSING_DAY,
  paymentDueDay: DEFAULT_PAYMENT_DUE_DAY,
};

export function useAssetCardAdd({
  projectId,
  setIsSubmitting,
  onAdded,
}: {
  projectId: string | null;
  /** 화면의 다른 쓰기(없애기)와 함께 쓰는 "보내는 중" 표시. */
  setIsSubmitting: (value: boolean) => void;
  /** 카드를 만든 뒤 다시 받은 카드 목록. 총자산까지 다시 받은 뒤에 돌아온다. */
  onAdded: (cards: Card[]) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { messageOf } = useApiError();
  /** 카드 추가 팝업을 띄울지. 다른 추가는 저마다 팝업 상태를 따로 갖는다. */
  const [isOpen, setIsOpen] = useState(false);
  const [cardForm, setCardForm] = useState(EMPTY_CARD_FORM);
  const [addError, setAddError] = useState('');

  /** 결제 통장을 채워 연다. 다른 칸은 닫을 때 비운 그대로다. */
  const open = (accountId: string) => {
    setCardForm((prev) => ({ ...prev, accountId }));
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
    setCardForm(EMPTY_CARD_FORM);
    setAddError('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      setAddError('');

      // 결제 통장도 필수다. 붙박이 단추로 열면 비어 있을 수 있다.
      if (!cardForm.accountId) {
        setAddError(t('card.accountRequired'));
        setIsSubmitting(false);
        return;
      }

      // 카드사는 필수다. CustomSelect는 <input required>와 달리 브라우저 검증이 없어
      // 비워 두면 서버에서 "기관을 찾을 수 없습니다"가 돌아와 원인을 알기 어렵다.
      if (!cardForm.issuerId) {
        setAddError(t('card.issuerRequired'));
        setIsSubmitting(false);
        return;
      }

      // 만료일은 월까지만 받는다. 저장은 그 달 말일로 한다.
      const isoDate = monthInputToIso(cardForm.expiryDate) ?? undefined;
      await apiClient.createCard({
        paymentAccountId: cardForm.accountId,
        name: cardForm.name,
        cardNumber: cardForm.cardNumber || undefined,
        cardType: cardForm.cardType,
        issuerId: cardForm.issuerId,
        ...(isoDate && { expiryDate: isoDate }),
        creditLimit: cardForm.cardType === 'credit' ? toAmountString(cardForm.creditLimit) : undefined,
        // 실적은 카드 종류를 가리지 않는다. 비워 두면 조건 없음이라 빈 문자열로 보낸다.
        performanceAmount: cardForm.performanceAmount ? toAmountString(cardForm.performanceAmount) : '',
        // 비워 두면 보내지 않는다. 서버는 null로 두고 화면이 종류별 기본색을 쓴다.
        color: cardForm.color || undefined,
        // 알림에서 알아보는 말. 비워 두면 보내지 않는다.
        matchText: cardForm.matchText || undefined,
        statementClosingDay: cardForm.cardType === 'credit' ? cardForm.statementClosingDay : undefined,
        paymentDueDay: cardForm.cardType === 'credit' ? cardForm.paymentDueDay : undefined,
        projectId: projectId ?? undefined,
      });
      const cardsData = await apiClient.getCards(projectId);
      await onAdded(cardsData || []);
      setCardForm(EMPTY_CARD_FORM);
      setIsOpen(false);
    } catch (err: any) {
      setAddError(messageOf(err, 'card.addFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return { isOpen, open, close, submit, cardForm, setCardForm, addError };
}

export default function AssetCardAddModal({
  form,
  accounts,
  isSubmitting,
}: {
  form: ReturnType<typeof useAssetCardAdd>;
  accounts: Account[];
  isSubmitting: boolean;
}) {
  const { t } = useTranslation();
  const displayCurrency = useProjectDisplayCurrency();
  const { options: issuerOptions } = useInstitutions('card_issuer');
  const { isOpen, close, submit, cardForm, setCardForm, addError } = form;

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={t('card.add')}
      footer={
        <button
          type="submit"
          form={CARD_ADD_FORM_ID}
          disabled={isSubmitting}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {isSubmitting ? t('account.adding') : t('account.addSubmit')}
        </button>
      }
    >
      <form id={CARD_ADD_FORM_ID} onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('card.name')}</label>
          <input
            type="text"
            required
            value={cardForm.name}
            onChange={(e) => setCardForm({ ...cardForm, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={t('card.namePlaceholder')}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('card.account')}</label>
          <CustomSelect
            options={accounts.map((acc) => ({ id: acc.id, name: acc.name }))}
            value={cardForm.accountId}
            onChange={(value) => setCardForm({ ...cardForm, accountId: value })}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('card.numberOptional')}</label>
          <input
            type="text"
            value={cardForm.cardNumber}
            onChange={(e) => setCardForm({ ...cardForm, cardNumber: e.target.value })}
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
            value={cardForm.cardType}
            onChange={(value) => setCardForm({ ...cardForm, cardType: value as 'debit' | 'credit' })}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('card.issuer')}</label>
          <CustomSelect
            options={issuerOptions}
            value={cardForm.issuerId}
            onChange={(value) => setCardForm({ ...cardForm, issuerId: value })}
            placeholder={t('card.issuerPlaceholder')}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('card.expiry')}</label>
          <input
            type="month"
            value={cardForm.expiryDate}
            onChange={(e) => setCardForm({ ...cardForm, expiryDate: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('card.color')}</label>
          <CardColorPicker value={cardForm.color} onChange={(color) => setCardForm({ ...cardForm, color })} />
          <p className="mt-1 text-xs text-gray-500">
            {t('card.colorHint', {
              default: t(cardForm.cardType === 'credit' ? 'card.colorDefaultCredit' : 'card.colorDefaultDebit'),
            })}
          </p>
        </div>

        <CardPerformanceField
          cardType={cardForm.cardType}
          value={cardForm.performanceAmount}
          onChange={(performanceAmount) => setCardForm({ ...cardForm, performanceAmount })}
          statementClosingDay={cardForm.statementClosingDay}
        />

        <MatchTextField value={cardForm.matchText} onChange={(matchText) => setCardForm({ ...cardForm, matchText })} />

        {cardForm.cardType === 'credit' && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('card.limit', { currency: displayCurrency })}
              </label>
              <input
                type="number"
                step="any"
                value={cardForm.creditLimit}
                onChange={(e) => setCardForm({ ...cardForm, creditLimit: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="5000000"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('card.closingDay')}</label>
              <select
                value={cardForm.statementClosingDay}
                onChange={(e) => setCardForm({ ...cardForm, statementClosingDay: parseInt(e.target.value) })}
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
                value={cardForm.paymentDueDay}
                onChange={(e) => setCardForm({ ...cardForm, paymentDueDay: parseInt(e.target.value) })}
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

        {addError && <div className="p-3 bg-red-50 text-red-800 text-sm rounded">{addError}</div>}
      </form>
    </Modal>
  );
}
