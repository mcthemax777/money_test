/*
 * 자산 화면의 고치기 창 셋 (구성원·계좌·카드).
 *
 * 만들기 창(`AssetAddModals`)과 나란히 선다. 묻는 것도 웹의 고치기 창과 같다. 주인·통화·
 * 결제 통장·카드 종류처럼 나중에 바꾸면 지난 기록의 뜻이 달라지는 값만 고칠 수 없고,
 * 그래도 지금 무엇으로 되어 있는지는 적어 둔다 (웹과 같은 자리다).
 *
 * **순서는 한 칸씩 옮긴다.** 앱에는 드래그가 없어서 위/아래 버튼을 둔다. 한 번 누를
 * 때마다 그 항목의 순서 값 하나만 바뀌므로(분수 색인), 다른 사람이 같은 목록에서 옮긴
 * 것을 덮지 않는다.
 */
import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';

import { useInstitutions } from '@money/core/hooks/useInstitutions';
import { useConnectivity } from '@money/core/store/connectivity';
import { NO_BANK_TYPES } from '@money/core/lib/account-type';
import { monthInputOf, monthInputToIso } from '@money/core/lib/datetime';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import {
  dayOfMonthHint,
  DEFAULT_PAYMENT_DUE_DAY,
  DEFAULT_STATEMENT_CLOSING_DAY,
} from '@money/core/lib/day-of-month';
import { formatCurrency, toAmountString } from '@money/core/lib/money';
import type { AssetSaveResult } from '@money/core/hooks/useAssetsData';
import type { AccountType } from '@money/core/lib/types';

// 알약 줄은 만들기 창의 것을 그대로 쓴다. 같은 칸이 두 창에서 다르게 보이지 않게.
import { PickRow } from './AssetAddModals';
import CardColorPicker from './CardColorPicker';
import CardPerformanceField from './CardPerformanceField';
import DayOfMonthSelect from './DayOfMonthSelect';
import ExpiryMonthSelect from './ExpiryMonthSelect';
import MatchTextField from './MatchTextField';
import Modal from './Modal';
import MoveRow from './MoveRow';

const INPUT = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View>
      <Text className="mb-1 text-sm font-medium text-gray-700">{label}</Text>
      {children}
    </View>
  );
}

/** 고칠 수 없는 값. 무엇으로 되어 있는지만 적는다 (주인·통화·결제 통장·카드 종류). */
function ReadOnly({ children }: { children: string }) {
  return <Text className="rounded-lg bg-gray-50 px-3 py-2 text-gray-900">{children}</Text>;
}

function ErrorLine({ message }: { message: string }) {
  if (!message) return null;
  return (
    <View className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
      <Text className="text-sm text-red-600">{message}</Text>
    </View>
  );
}

/** 예/아니오 한 번. 웹의 `window.confirm` 과 같은 자리다. */
function ask(question: string, yes: string, no: string, onYes: () => void) {
  Alert.alert('', question, [
    { text: no, style: 'cancel' },
    { text: yes, style: 'destructive', onPress: onYes },
  ]);
}

/** 삭제를 막고 숨기기만 남기는 사정들. 문구를 뒤지지 않고 서버 코드로 가른다. */
const HIDE_INSTEAD_CODES = [
  'PERSON_HAS_ENTRIES',
  'PERSON_HAS_RECORDS',
  'ACCOUNT_HAS_ENTRIES',
  'ACCOUNT_HAS_RECORDS',
  'CARD_HAS_ENTRIES',
  'CARD_HAS_RECORDS',
];

/**
 * 없애기. **삭제를 먼저 묻고, 거절당하면 숨기기를 묻는다.**
 *
 * 웹의 `deleteOrAskToHide` 와 같은 규칙이다. 조용히 숨기면 지운 줄 알고, 말없이 실패하면
 * 눌러도 안 되는 것으로 보인다. 그래서 거래내역이 남아 있다는 이유를 그대로 보여 주고,
 * 그 자리에서 숨기기로 이어 갈지 묻는다.
 */
function askThenRemove({
  t,
  remove,
  hide,
  onDone,
  onFail,
}: {
  t: (key: MessageKey) => string;
  remove: () => Promise<AssetSaveResult>;
  hide: () => Promise<AssetSaveResult>;
  onDone: () => void;
  onFail: (message: string) => void;
}) {
  ask(t('assets.deleteConfirm'), t('common.confirm'), t('common.cancel'), async () => {
    const result = await remove();
    if (result.ok) {
      onDone();
      return;
    }
    /*
     * 오프라인이면 삭제는 못 해도 숨기기는 된다(사본에 적고 나중에 보낸다). 지우기는
     * 붙은 것을 서버가 세어 판단해야 해서 연결이 있어야 한다 -- 그래서 같은 물음으로
     * 이어 간다. 이유만 다르다.
     */
    const reason = result.offline ? t('assets.removeOffline') : result.message;
    if (!result.offline && !HIDE_INSTEAD_CODES.includes(result.code ?? '')) {
      onFail(result.message ?? '');
      return;
    }

    ask(
      `${reason}\n\n${t('assets.hideInstead')}`,
      t('common.confirm'),
      t('common.cancel'),
      async () => {
        const hidden = await hide();
        if (hidden.ok) onDone();
        else onFail(hidden.message ?? '');
      },
    );
  });
}

/**
 * 저장과 없애기. 없애기는 되돌리기 어려우므로 눌러야 하는 자리를 따로 둔다.
 *
 * 무엇을 물을지는 창마다 다르다 -- 통장·카드는 삭제부터 묻고(`askThenRemove`), 구성원은
 * 숨기기·삭제를 서버가 가르므로 한 번만 묻는다. 그래서 여기는 버튼만 그린다.
 */
function Footer({
  isSubmitting,
  canSave,
  onSave,
  onRemovePress,
}: {
  isSubmitting: boolean;
  canSave: boolean;
  onSave: () => void;
  onRemovePress: () => void;
}) {
  const { t } = useTranslation();

  return (
    <View className="flex-row gap-2">
      <Pressable
        onPress={onRemovePress}
        disabled={isSubmitting}
        className={`rounded-lg border border-red-300 px-4 py-3 ${isSubmitting ? 'opacity-40' : ''}`}
      >
        <Text className="text-base text-red-600">{t('assets.remove')}</Text>
      </Pressable>
      <Pressable
        onPress={onSave}
        disabled={!canSave}
        className={`flex-1 items-center rounded-lg bg-blue-600 px-4 py-3 ${
          canSave ? 'active:bg-blue-700' : 'opacity-40'
        }`}
      >
        <Text className="text-base font-semibold text-white">
          {t(isSubmitting ? 'common.saving' : 'common.save')}
        </Text>
      </Pressable>
    </View>
  );
}

interface EditProps<T> {
  target: T;
  onClose: () => void;
  isSubmitting: boolean;
  onSave: (patch: Record<string, unknown>) => Promise<AssetSaveResult>;
  onMove: (step: 1 | -1) => Promise<AssetSaveResult>;
}

/**
 * 없앨 수 있는 창이 받는 것. 삭제가 하나 더 있다.
 *
 * 삭제와 숨기기가 다른 문이라 둘 다 필요하다 -- 거래내역이 남았을 때 이유를 알리고
 * 숨기기를 다시 물어야 한다 (`askThenRemove`).
 */
type RemovableEditProps<T> = EditProps<T> & {
  onRemove: () => Promise<AssetSaveResult>;
};

export function EditPersonModal({
  target,
  onClose,
  isSubmitting,
  onSave,
  onMove,
  onRemove,
}: RemovableEditProps<{ id: string; name: string; relationship?: string | null }>) {
  const { t } = useTranslation();
  const [name, setName] = useState(target.name);
  const [relationship, setRelationship] = useState(target.relationship ?? '');
  const [error, setError] = useState('');

  // 다른 구성원을 눌러 열면 그 값으로 다시 채운다.
  useEffect(() => {
    setName(target.name);
    setRelationship(target.relationship ?? '');
    setError('');
  }, [target.id, target.name, target.relationship]);

  const run = async (task: Promise<AssetSaveResult>, close: boolean) => {
    const result = await task;
    if (!result.ok) {
      setError(result.message ?? '');
      return;
    }
    if (close) onClose();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t('person.edit')}
      footer={
        <Footer
          isSubmitting={isSubmitting}
          canSave={!isSubmitting && !!name.trim()}
          onSave={() =>
            run(onSave({ name: name.trim(), relationship: relationship.trim() || null }), true)
          }
          onRemovePress={() =>
            askThenRemove({
              t,
              remove: onRemove,
              hide: () => onSave({ isActive: false }),
              onDone: onClose,
              onFail: setError,
            })
          }
        />
      }
    >
      <View className="gap-4">
        <Field label={t('person.name')}>
          <TextInput value={name} onChangeText={setName} className={INPUT} />
        </Field>

        <Field label={t('person.relationship')}>
          <TextInput
            value={relationship}
            onChangeText={setRelationship}
            placeholder={t('person.relationshipPlaceholder')}
            placeholderTextColor="#9ca3af"
            className={INPUT}
          />
        </Field>

        <MoveRow disabled={isSubmitting} onMove={(step) => void run(onMove(step), false)} />
        <ErrorLine message={error} />
      </View>
    </Modal>
  );
}

export function EditAccountModal({
  target,
  ownerName,
  onClose,
  isSubmitting,
  onSave,
  onMove,
  onRemove,
}: {
  /** 통장 주인의 이름. 주인은 원장 전표에 이미 반영돼 있어 여기서 바꾸지 않는다. */
  ownerName: string;
} & RemovableEditProps<{
  id: string;
  name: string;
  type: AccountType;
  institutionId?: string | null;
  accountNumber?: string | null;
  /** 지금 잔액. 고치면 서버가 기초잔액 전표를 다시 계산한다. */
  balance: string;
  currency: string;
  /** 알림에서 이 통장을 알아보는 말. 한 줄에 하나씩이다. */
  matchText?: string | null;
}>) {
  const { t } = useTranslation();
  const { options: bankOptions, error: bankError } = useInstitutions('bank');
  const [name, setName] = useState(target.name);
  /** 개설 기관. 현금·부동산에는 없다 (보내면 서버가 거부한다). */
  const [institutionId, setInstitutionId] = useState(target.institutionId ?? '');
  const [accountNumber, setAccountNumber] = useState(target.accountNumber ?? '');
  /**
   * 현재 잔액.
   *
   * 조정 전표를 새로 쌓지 않는다 -- 서버가 기초잔액 전표를 "목표 잔액 - 나머지 거래 합계"로
   * 다시 계산한다. 그 셈은 지금 서버에 있는 거래를 세므로 아웃박스에 실을 수 없고
   * (settings-write-port 의 D12), 그래서 이 칸만 온라인에서 저장된다. 오프라인이면
   * 아래 한 줄에 이유가 뜬다.
   */
  const [balance, setBalance] = useState(target.balance);
  const isOffline = useConnectivity((state) => state.isOffline);
  const [matchText, setMatchText] = useState(target.matchText ?? '');
  const [error, setError] = useState('');

  useEffect(() => {
    setName(target.name);
    setInstitutionId(target.institutionId ?? '');
    setAccountNumber(target.accountNumber ?? '');
    setBalance(target.balance);
    setMatchText(target.matchText ?? '');
    setError('');
  }, [
    target.id,
    target.name,
    target.institutionId,
    target.accountNumber,
    target.balance,
    target.matchText,
  ]);

  // 현금과 부동산은 개설 기관이 없다 (만들기 창과 같은 규칙이다).
  const needsBank = !NO_BANK_TYPES.includes(target.type);
  /* "10000" 과 "10000.00" 은 글자로는 다르고 값으로는 같다. 숫자로 견준다. */
  const balanceChanged = balance !== '' && Number(balance) !== Number(target.balance);

  const run = async (task: Promise<AssetSaveResult>, close: boolean) => {
    const result = await task;
    if (!result.ok) {
      setError(result.message ?? '');
      return;
    }
    if (close) onClose();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t('account.edit')}
      footer={
        <Footer
          isSubmitting={isSubmitting}
          canSave={!isSubmitting && !!name.trim()}
          onSave={() =>
            run(
              onSave({
                name: name.trim(),
                accountNumber: accountNumber.trim() || null,
                // 기관을 비우면 null 을 보내 연결을 끊는다. '' 는 없는 id 로 읽힌다.
                ...(needsBank ? { institutionId: institutionId || null } : {}),
                // 실제로 바꿨을 때만 보낸다. 잔액 맞추기는 온라인에서만 되므로,
                // 이름만 고치는 사람이 오프라인에서 막히지 않아야 한다.
                ...(balanceChanged ? { balance: toAmountString(balance) } : {}),
                // 비우면 null 을 보내 지운다. 적어 둔 말을 지울 길이 있어야 한다.
                matchText: matchText.trim() || null,
              }),
              true,
            )
          }
          onRemovePress={() =>
            askThenRemove({
              t,
              remove: onRemove,
              hide: () => onSave({ isActive: false }),
              onDone: onClose,
              onFail: setError,
            })
          }
        />
      }
    >
      <View className="gap-4">
        {/* 주인은 이미 원장 전표에 반영돼 있어 나중에 바꾸지 않는다. 적어 두기만 한다. */}
        <Field label={t('account.owner')}>
          <ReadOnly>{ownerName || '-'}</ReadOnly>
        </Field>

        <Field label={t('account.name')}>
          <TextInput value={name} onChangeText={setName} className={INPUT} />
        </Field>

        {needsBank ? (
          <Field label={t('account.institution')}>
            {bankError ? (
              <Text className="text-sm text-red-600">{bankError}</Text>
            ) : (
              <PickRow options={bankOptions} value={institutionId} onPick={setInstitutionId} />
            )}
          </Field>
        ) : null}

        <Field label={t('account.currentBalance', { currency: target.currency })}>
          <TextInput
            value={balance}
            onChangeText={setBalance}
            keyboardType="numeric"
            className={INPUT}
          />
          {/*
           * 오프라인이면 저장하기 전에 말한다. 누른 뒤에야 알면 다른 칸까지 안 된 줄 안다.
           * 칸을 잠그지는 않는다 -- 연결이 돌아왔는지는 요청을 보내 봐야 안다.
           */}
          {isOffline ? (
            <Text className="mt-2 text-xs text-gray-500">{t('online.onlyOnline')}</Text>
          ) : null}
          {/* 실제로 바꿨을 때만 알린다. 다른 칸만 고치는 사람에게는 뜨지 않는다. */}
          {balanceChanged ? (
            <View className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <Text className="text-xs leading-5 text-amber-800">
                {t('account.balanceHint', {
                  from: formatCurrency(target.balance, target.currency),
                  to: formatCurrency(toAmountString(balance), target.currency),
                })}
              </Text>
            </View>
          ) : null}
        </Field>

        <Field label={t('account.number')}>
          <TextInput
            value={accountNumber}
            onChangeText={setAccountNumber}
            placeholder={t('account.numberPlaceholder')}
            placeholderTextColor="#9ca3af"
            className={INPUT}
          />
        </Field>

        <MatchTextField value={matchText} onChange={setMatchText} />

        <MoveRow disabled={isSubmitting} onMove={(step) => void run(onMove(step), false)} />
        <ErrorLine message={error} />
      </View>
    </Modal>
  );
}

export function EditCardModal({
  target,
  currency,
  accountName,
  onClose,
  isSubmitting,
  onSave,
  onMove,
  onRemove,
}: {
  /** 이 카드 금액의 통화. 결제 통장에 달려 있어 카드만 보고는 알 수 없다. */
  currency: string;
  /** 결제 통장의 이름. 부채 계정이 딸려 있어 통장 자체는 바꾸지 않는다. */
  accountName: string;
} & RemovableEditProps<{
  id: string;
  name: string;
  cardType: 'debit' | 'credit';
  issuerId: string;
  /** 서버가 마스킹해 준 번호. 온전한 값은 화면이 모른다. */
  cardNumberMasked?: string | null;
  expiryDate?: string | null;
  color?: string | null;
  statementClosingDay: number | null;
  paymentDueDay: number | null;
  creditLimit: string | null;
  performanceAmount: string | null;
  /** 알림에서 이 카드를 알아보는 말. 한 줄에 하나씩이다. */
  matchText?: string | null;
}>) {
  const { t } = useTranslation();
  const { options: issuerOptions, error: issuerError } = useInstitutions('card_issuer');
  const [name, setName] = useState(target.name);
  const [issuerId, setIssuerId] = useState(target.issuerId);
  /**
   * 카드 번호. **언제나 빈 칸에서 시작한다.**
   *
   * 서버는 마스킹된 번호만 주므로 화면은 원래 값을 모른다. 그래서 비워 두면 그대로 두고,
   * 새로 적으면 그 값으로 바꾼다 (웹과 같은 규칙이다).
   */
  const [cardNumber, setCardNumber] = useState('');
  /** 만료 월 "YYYY-MM". 저장은 그 달의 말일이다. */
  const [expiryMonth, setExpiryMonth] = useState(monthInputOf(target.expiryDate));
  const [color, setColor] = useState(target.color ?? '');
  /**
   * 마감일과 결제일. 신용카드에만 있다.
   *
   * 만들 때 기본값으로 들어가고 카드사 날짜는 대개 명세서를 봐야 아는 값이라, 고치는
   * 자리가 더 자주 쓰인다. 예전에는 앱에 이 칸이 아예 없어 웹으로 가야만 고칠 수 있었다.
   */
  const [closingDay, setClosingDay] = useState(
    target.statementClosingDay ?? DEFAULT_STATEMENT_CLOSING_DAY,
  );
  const [dueDay, setDueDay] = useState(target.paymentDueDay ?? DEFAULT_PAYMENT_DUE_DAY);
  const [creditLimit, setCreditLimit] = useState(target.creditLimit ?? '');
  /** 실적 기준액. 앱의 실적 판과 사용액 그래프 기준선이 이 값으로 그려진다. */
  const [performanceAmount, setPerformanceAmount] = useState(target.performanceAmount ?? '');
  const [matchText, setMatchText] = useState(target.matchText ?? '');
  const [error, setError] = useState('');

  const isCredit = target.cardType === 'credit';

  useEffect(() => {
    setName(target.name);
    setIssuerId(target.issuerId);
    setCardNumber('');
    setExpiryMonth(monthInputOf(target.expiryDate));
    setColor(target.color ?? '');
    setClosingDay(target.statementClosingDay ?? DEFAULT_STATEMENT_CLOSING_DAY);
    setDueDay(target.paymentDueDay ?? DEFAULT_PAYMENT_DUE_DAY);
    setCreditLimit(target.creditLimit ?? '');
    setPerformanceAmount(target.performanceAmount ?? '');
    setMatchText(target.matchText ?? '');
    setError('');
  }, [
    target.id,
    target.name,
    target.issuerId,
    target.expiryDate,
    target.color,
    target.statementClosingDay,
    target.paymentDueDay,
    target.creditLimit,
    target.performanceAmount,
    target.matchText,
  ]);

  const run = async (task: Promise<AssetSaveResult>, close: boolean) => {
    const result = await task;
    if (!result.ok) {
      setError(result.message ?? '');
      return;
    }
    if (close) onClose();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t('card.edit')}
      footer={
        <Footer
          isSubmitting={isSubmitting}
          canSave={!isSubmitting && !!name.trim() && !!issuerId}
          onSave={() =>
            run(
              onSave({
                name: name.trim(),
                issuerId,
                // 새로 적었을 때만 보낸다. 마스킹된 값을 되돌려 보내면 그것이 저장된다.
                ...(cardNumber.trim() ? { cardNumber: cardNumber.trim() } : {}),
                // 비우면 null 을 보내 지운다 (키를 빼면 있던 값이 남는다).
                expiryDate: monthInputToIso(expiryMonth),
                // 빈 값은 "종류의 기본색으로 되돌리기"다.
                color: color || null,
                // 체크카드에는 청구 주기도 한도도 없다. 보내면 서버가 거부한다.
                ...(isCredit
                  ? {
                      statementClosingDay: closingDay,
                      paymentDueDay: dueDay,
                      creditLimit: creditLimit.trim() ? toAmountString(creditLimit) : null,
                    }
                  : {}),
                // 빈 값은 "조건 없음"이다. 지울 수 있어야 하므로 비어 있어도 보낸다.
                performanceAmount: performanceAmount.trim()
                  ? toAmountString(performanceAmount)
                  : null,
                // 빈 값은 "지우기"다. 실적 기준액과 같은 규칙이다.
                matchText: matchText.trim() || null,
              }),
              true,
            )
          }
          onRemovePress={() =>
            askThenRemove({
              t,
              remove: onRemove,
              hide: () => onSave({ isActive: false }),
              onDone: onClose,
              onFail: setError,
            })
          }
        />
      }
    >
      <View className="gap-4">
        {/* 결제 통장과 카드 종류는 부채 계정이 딸려 있어 바꾸지 않는다. 적어 두기만 한다. */}
        <Field label={t('card.paymentAccount')}>
          <ReadOnly>{accountName || '-'}</ReadOnly>
        </Field>

        <Field label={t('card.name')}>
          <TextInput value={name} onChangeText={setName} className={INPUT} />
        </Field>

        <Field label={t('card.numberOptional')}>
          <TextInput
            value={cardNumber}
            onChangeText={setCardNumber}
            keyboardType="number-pad"
            placeholder={target.cardNumberMasked || t('card.numberPlaceholder')}
            placeholderTextColor="#9ca3af"
            className={INPUT}
          />
          <Text className="mt-1 text-xs text-gray-500">
            {t(target.cardNumberMasked ? 'card.numberKeepHint' : 'card.numberMaskHint')}
          </Text>
        </Field>

        <Field label={t('card.type')}>
          <ReadOnly>{t(isCredit ? 'method.credit_card' : 'method.debit_card')}</ReadOnly>
        </Field>

        <Field label={t('card.issuer')}>
          {issuerError ? (
            <Text className="text-sm text-red-600">{issuerError}</Text>
          ) : (
            <PickRow options={issuerOptions} value={issuerId} onPick={setIssuerId} />
          )}
        </Field>

        <Field label={t('card.expiry')}>
          <ExpiryMonthSelect value={expiryMonth} onChange={setExpiryMonth} />
        </Field>

        <Field label={t('card.colorPlain')}>
          <CardColorPicker value={color} onChange={setColor} />
        </Field>

        {isCredit ? (
          <>
            <Field label={t('card.closingDay')}>
              <DayOfMonthSelect value={closingDay} onSelect={setClosingDay} />
            </Field>
            <Field label={t('card.paymentDay')}>
              <DayOfMonthSelect value={dueDay} onSelect={setDueDay} />
            </Field>
            <Text className="text-xs leading-5 text-gray-500">{dayOfMonthHint()}</Text>

            <Field label={t('card.limit', { currency })}>
              <TextInput
                value={creditLimit}
                onChangeText={setCreditLimit}
                keyboardType="numeric"
                className={INPUT}
              />
            </Field>
          </>
        ) : null}

        <CardPerformanceField
          cardType={target.cardType}
          value={performanceAmount}
          onChange={setPerformanceAmount}
          statementClosingDay={isCredit ? closingDay : undefined}
          inputClassName={INPUT}
        />

        <MatchTextField value={matchText} onChange={setMatchText} />

        <MoveRow disabled={isSubmitting} onMove={(step) => void run(onMove(step), false)} />
        <ErrorLine message={error} />
      </View>
    </Modal>
  );
}
