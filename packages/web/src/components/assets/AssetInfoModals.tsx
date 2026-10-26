'use client';

/*
 * 자산 상세의 "기본 정보" 팝업 셋 (계좌·구성원·카드). 머리글의 정보(i) 단추로 연다.
 *
 * 읽기가 본론이다. 아래 단추(카드·계좌 추가, 수정, 없애기)는 쓰기 권한이 있을 때만 서고,
 * 그 일은 부르는 쪽이 한다. 조회(이 팝업)와 수정 폼은 서로 다른 모달이다 -- state를
 * 공유하면 상세정보 버튼 하나로 두 모달이 동시에 열린다.
 */
import type { ReactNode } from 'react';
import type { Account, Card, Person } from '@money/core/lib/types';
import { formatCurrency } from '@money/core/lib/money';
import { accountTypeLabel } from '@money/core/lib/account-type';
import { useTranslation } from '@money/core/lib/i18n';
import { useCanEdit } from '@money/core/store/project';
import DetailField from '@/components/DetailField';
import Modal from '@/components/Modal';

/** 아래 단추 하나. 세 팝업이 같은 모양을 쓴다 (초록은 추가, 파랑은 수정, 빨강은 없애기). */
function FooterButton({
  tone,
  onClick,
  disabled,
  children,
}: {
  tone: 'green' | 'blue' | 'red';
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const toneClass = {
    green: 'bg-green-600 text-white rounded-lg hover:bg-green-700',
    blue: 'bg-blue-600 text-white rounded-lg hover:bg-blue-700',
    red: 'bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50',
  }[tone];

  return (
    <button onClick={onClick} disabled={disabled} className={`flex-1 px-4 py-2 ${toneClass}`}>
      {children}
    </button>
  );
}

/**
 * 팝업의 아래 단추 줄.
 *
 * 읽기 전용 구성원에게는 손댈 단추가 없다. 상세는 그대로 읽힌다.
 */
function InfoFooter({ children }: { children: ReactNode }) {
  const canEdit = useCanEdit();
  return !canEdit ? null : <div className="flex gap-2">{children}</div>;
}

export function AccountInfoModal({
  account,
  onClose,
  onAddCard,
  onEdit,
  onRemove,
  isSubmitting,
}: {
  account: Account;
  onClose: () => void;
  onAddCard: () => void;
  onEdit: () => void;
  onRemove: () => void;
  isSubmitting: boolean;
}) {
  const { t } = useTranslation();

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={t('account.detail')}
      footer={
        <InfoFooter>
          {/*
            계좌 밑에 만들 수 있는 것은 카드뿐이라 선택 팝업을 거치지 않는다.
            결제 통장은 이 계좌로 미리 채워 둔다.
          */}
          <FooterButton tone="green" onClick={onAddCard}>
            {t('card.add')}
          </FooterButton>
          <FooterButton tone="blue" onClick={onEdit}>
            {t('account.editSubmit')}
          </FooterButton>
          <FooterButton tone="red" onClick={onRemove} disabled={isSubmitting}>
            {t('assets.remove')}
          </FooterButton>
        </InfoFooter>
      }
    >
      <div className="space-y-4">
        <DetailField label={t('account.owner')}>{account.owner?.name || '-'}</DetailField>
        <DetailField label={t('account.name')}>{account.name}</DetailField>
        <DetailField label={t('account.bank')}>{account.institution?.name || '-'}</DetailField>
        <DetailField label={t('account.type')}>{accountTypeLabel(account.type)}</DetailField>
        <DetailField label={t('account.balance')} valueClassName="font-semibold">
          {formatCurrency(account.balance, account.currency)}
        </DetailField>
        {account.accountNumber && (
          <DetailField label={t('account.numberPlain')}>{account.accountNumber}</DetailField>
        )}
      </div>
    </Modal>
  );
}

export function PersonInfoModal({
  person,
  onClose,
  onAddAccount,
  onEdit,
  onRemove,
  isSubmitting,
}: {
  person: Person;
  onClose: () => void;
  onAddAccount: () => void;
  onEdit: () => void;
  onRemove: () => void;
  isSubmitting: boolean;
}) {
  const { t } = useTranslation();

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={t('person.detail')}
      footer={
        <InfoFooter>
          {/*
            이 사람 밑에 계좌를 바로 만든다. 카드는 계좌 밑에 붙으므로 여기서 고를 것이
            없다 -- 계좌 상세나 붙박이 추가 단추에서 만든다.

            상세를 닫고 여는 것은 이 화면의 다른 팝업과 같은 규칙이다. 모달을 겹쳐
            띄우지 않는다.
          */}
          <FooterButton tone="green" onClick={onAddAccount}>
            {t('account.add')}
          </FooterButton>
          <FooterButton tone="blue" onClick={onEdit}>
            {t('account.editSubmit')}
          </FooterButton>
          <FooterButton tone="red" onClick={onRemove} disabled={isSubmitting}>
            {t('assets.remove')}
          </FooterButton>
        </InfoFooter>
      }
    >
      <div className="space-y-4">
        <DetailField label={t('person.name')}>{person.name}</DetailField>
      </div>
    </Modal>
  );
}

export function CardInfoModal({
  card,
  accounts,
  onClose,
  onEdit,
  onRemove,
  isSubmitting,
}: {
  card: Card;
  accounts: Account[];
  onClose: () => void;
  onEdit: () => void;
  onRemove: () => void;
  isSubmitting: boolean;
}) {
  const { t } = useTranslation();
  /**
   * 카드 금액의 통화. 사용액·한도·남은 대금은 전부 결제 통장의 통화다.
   * 기준통화 환산액이 아니라서 원으로 찍으면 달러 카드가 1/1380로 보인다.
   */
  const currency = accounts.find((a) => a.id === card.paymentAccountId)?.currency ?? 'KRW';

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={t('card.detail')}
      footer={
        <InfoFooter>
          <FooterButton tone="blue" onClick={onEdit}>
            {t('account.editSubmit')}
          </FooterButton>
          <FooterButton tone="red" onClick={onRemove} disabled={isSubmitting}>
            {t('assets.remove')}
          </FooterButton>
        </InfoFooter>
      }
    >
      <div className="space-y-4">
        <DetailField label={t('card.name')}>{card.name}</DetailField>
        <DetailField label={t('card.account')}>
          {accounts.find((a) => a.id === card.paymentAccountId)?.name || '-'}
        </DetailField>
        <DetailField label={t('card.number')}>{card.cardNumberMasked}</DetailField>
        <DetailField label={t('card.type')}>
          {t(card.cardType === 'debit' ? 'method.debit_card' : 'method.credit_card')}
        </DetailField>
        <DetailField label={t('card.issuer')}>{card.issuer?.name}</DetailField>

        {card.cardType === 'credit' && (
          <>
            <DetailField label={t('card.usage')}>{formatCurrency(card.currentUsage, currency)}</DetailField>
            <DetailField label={t('card.limitPlain')}>{formatCurrency(card.creditLimit, currency)}</DetailField>
          </>
        )}
      </div>
    </Modal>
  );
}
