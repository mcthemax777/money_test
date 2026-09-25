/*
 * 자산 화면의 만들기 창 셋 (구성원·계좌·카드).
 *
 * 셋을 한 파일에 둔다. 같은 자리에서 같은 모양으로 열리고, 눌러서 들어온 자리가 곧
 * 주인·결제 통장이라 폼이 묻는 것이 몇 칸뿐이다. 화면 파일에 붙이면 목록을 그리는 코드와
 * 폼이 뒤섞인다.
 *
 * **웹과 같은 것을 묻는다.** 예전에는 서버가 반드시 받아야 하는 것만 받고 계좌번호·만료월·
 * 카드 색은 "웹에서 고치세요"로 두었다. 그런데 앱만 쓰는 사람에게 그 칸들은 없는 것과
 * 같았다 -- 넣을 자리가 화면 어디에도 없었다. 주인과 결제 통장만 묻지 않는다. 누르고 들어온
 * 자리가 그것을 이미 정했기 때문이다.
 */
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { ACCOUNT_TYPE_OPTIONS, NO_BANK_TYPES } from '@money/core/lib/account-type';
import { useInstitutions } from '@money/core/hooks/useInstitutions';
import { monthInputToIso } from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import { dayOfMonthHint } from '@money/core/lib/day-of-month';
import { currencyLabel, toAmountString } from '@money/core/lib/money';
import { SUPPORTED_CURRENCIES, type CurrencyCode } from '@money/types';
import {
  DEFAULT_PAYMENT_DUE_DAY,
  DEFAULT_STATEMENT_CLOSING_DAY,
} from '@money/core/lib/day-of-month';
import type { AssetSaveResult } from '@money/core/hooks/useAssetsData';
import type { Account, AccountType, Person } from '@money/core/lib/types';
import { useProjectLedgerCurrency } from '@money/core/store/project';

import CardColorPicker from './CardColorPicker';
import CardPerformanceField from './CardPerformanceField';
import DayOfMonthSelect from './DayOfMonthSelect';
import ExpiryMonthSelect from './ExpiryMonthSelect';
import MatchTextField from './MatchTextField';
import Modal from './Modal';

/** 폼 한 칸. 이름표와 입력이 늘 같은 간격으로 놓인다. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View>
      <Text className="mb-1 text-sm font-medium text-gray-700">{label}</Text>
      {children}
    </View>
  );
}

const INPUT = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900';

/**
 * 목록에서 하나를 고르는 알약 줄.
 *
 * 은행은 서른 개가 넘어 창 안에서 굴려 고른다. 좁은 화면에 드롭다운을 얹는 것보다
 * 알약이 손가락에 맞고, 고른 것이 한눈에 보인다.
 *
 * 고치기 창(`AssetEditModals`)도 이것을 쓴다. 같은 것(기관·카드사)을 고르는 자리가
 * 만들 때와 고칠 때 다르게 보이면 사용자는 둘을 다른 칸으로 읽는다.
 */
export function PickRow({
  options,
  value,
  onPick,
}: {
  options: Array<{ id: string; name: string }>;
  value: string;
  onPick: (id: string) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((option) => (
        <Pressable
          key={option.id}
          onPress={() => onPick(option.id)}
          className={`rounded-full border px-3 py-1.5 ${
            value === option.id ? 'border-blue-600 bg-blue-50' : 'border-gray-300 bg-white'
          }`}
        >
          <Text className={`text-sm ${value === option.id ? 'text-blue-600' : 'text-gray-700'}`}>
            {option.name}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** 저장 버튼. 세 창이 같은 모양을 쓴다. */
function SubmitButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`items-center rounded-lg bg-blue-600 px-4 py-3 ${disabled ? 'opacity-50' : ''}`}
    >
      <Text className="text-base font-semibold text-white">{label}</Text>
    </Pressable>
  );
}

/** 실패했을 때 창 안에 남는 한 줄. 창을 닫지 않는다 -- 적은 것을 잃지 않게. */
function ErrorLine({ message }: { message: string }) {
  if (!message) return null;
  return (
    <View className="rounded bg-red-50 p-3">
      <Text className="text-sm text-red-800">{message}</Text>
    </View>
  );
}

export function AddPersonModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: { name: string; relationship?: string }) => Promise<AssetSaveResult>;
  isSubmitting: boolean;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [error, setError] = useState('');

  // 열 때마다 비운다. 지난번에 적다 만 것이 남으면 엉뚱한 이름이 저장된다.
  useEffect(() => {
    if (isOpen) {
      setName('');
      setRelationship('');
      setError('');
    }
  }, [isOpen]);

  const save = async () => {
    const result = await onSubmit({
      name: name.trim(),
      ...(relationship.trim() ? { relationship: relationship.trim() } : {}),
    });
    if (result.ok) onClose();
    else setError(result.message ?? '');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('person.add')}
      footer={
        <SubmitButton
          label={t(isSubmitting ? 'account.adding' : 'account.addSubmit')}
          disabled={isSubmitting || !name.trim()}
          onPress={save}
        />
      }
    >
      <View className="gap-4">
        <Field label={t('person.name')}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={t('person.namePlaceholder')}
            placeholderTextColor="#9ca3af"
            className={INPUT}
          />
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

        <ErrorLine message={error} />
      </View>
    </Modal>
  );
}

export function AddAccountModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
  people,
  defaultOwnerId,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: {
    ownerId: string;
    type: AccountType;
    name: string;
    institutionId?: string;
    accountNumber?: string;
    /** 알림에서 이 통장을 알아보는 말. 한 줄에 하나씩이다. */
    matchText?: string;
    currency?: string;
    openingBalance?: string;
  }) => Promise<AssetSaveResult>;
  isSubmitting: boolean;
  /**
   * 고를 수 있는 주인들. 지금 보고 있는 자산주인이다.
   *
   * 예전에는 목록에서 그 사람의 버튼을 눌러 들어와 주인이 이미 정해져 있었다. 목록에서
   * 사람 줄을 걷어내면서 그 자리가 없어졌으므로 여기서 고른다 (웹과 같다).
   */
  people: Person[];
  /** 처음 골라 둘 주인. 대개 "나"다. 아무도 없으면 null 이고, 그때는 저장할 수 없다. */
  defaultOwnerId: string | null;
}) {
  const { t } = useTranslation();
  /* 개설 잔액은 저장 통화로 적는다. 계좌 통화는 웹에서 고른다 (여기서는 프로젝트 기본값). */
  const ledgerCurrency = useProjectLedgerCurrency();
  const { options: bankOptions, error: bankError } = useInstitutions('bank');
  const [ownerId, setOwnerId] = useState(defaultOwnerId ?? '');
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('deposit');
  const [institutionId, setInstitutionId] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  /** 알림에서 이 통장을 알아보는 말. 여러 줄이다. */
  const [matchText, setMatchText] = useState('');
  /** 이 통장의 통화. 만든 뒤에는 바꿀 수 없어 여기서만 고른다. */
  const [currency, setCurrency] = useState<CurrencyCode>(ledgerCurrency as CurrencyCode);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setOwnerId(defaultOwnerId ?? '');
      setName('');
      setType('deposit');
      setInstitutionId('');
      setOpeningBalance('');
      setAccountNumber('');
      setMatchText('');
      setCurrency(ledgerCurrency as CurrencyCode);
      setError('');
    }
  }, [isOpen]);

  // 현금과 부동산은 개설 기관이 없다. 보내면 서버가 거부한다.
  const needsBank = !NO_BANK_TYPES.includes(type);

  const save = async () => {
    const result = await onSubmit({
      ownerId,
      type,
      name: name.trim(),
      ...(needsBank && institutionId ? { institutionId } : {}),
      ...(accountNumber.trim() ? { accountNumber: accountNumber.trim() } : {}),
      ...(matchText.trim() ? { matchText: matchText.trim() } : {}),
      currency,
      openingBalance: toAmountString(openingBalance || '0'),
    });
    if (result.ok) onClose();
    else setError(result.message ?? '');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('account.add')}
      footer={
        <SubmitButton
          label={t(isSubmitting ? 'account.adding' : 'account.addSubmit')}
          /* 주인 없는 계좌는 만들 수 없다. 서버가 ownerId 를 반드시 받는다. */
          disabled={isSubmitting || !name.trim() || !ownerId}
          onPress={save}
        />
      }
    >
      <View className="gap-4">
        {/*
          주인. 혼자뿐이어도 고른 채로 보여 준다 -- 누구 밑에 만드는지가 폼에 적혀 있어야
          하고, 구성원이 늘어난 날 갑자기 새 칸이 생기지도 않는다.
        */}
        <Field label={t('account.owner')}>
          <PickRow
            options={people.map((person) => ({ id: person.id, name: person.name }))}
            value={ownerId}
            onPick={setOwnerId}
          />
        </Field>

        <Field label={t('account.name')}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={t('account.namePlaceholder')}
            placeholderTextColor="#9ca3af"
            className={INPUT}
          />
        </Field>

        <Field label={t('account.type')}>
          <PickRow
            options={ACCOUNT_TYPE_OPTIONS.map((option) => ({
              id: option.id,
              name: t(option.nameKey),
            }))}
            value={type}
            onPick={(id) => setType(id as AccountType)}
          />
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

        {/*
          통화. 만든 뒤에는 바꿀 수 없어(원장이 이 통화로 쌓인다) 여기서만 고른다.
          예전에는 이 칸이 없어 앱에서는 외화 통장을 만들 수 없었다.
        */}
        <Field label={t('account.currency')}>
          <PickRow
            options={SUPPORTED_CURRENCIES.map((code) => ({ id: code, name: currencyLabel(code) }))}
            value={currency}
            onPick={(id) => setCurrency(id as CurrencyCode)}
          />
          <Text className="mt-1 text-xs text-gray-500">{t('account.currencyHint')}</Text>
        </Field>

        <Field label={t('account.openingBalance', { currency })}>
          <TextInput
            value={openingBalance}
            onChangeText={setOpeningBalance}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor="#9ca3af"
            className={INPUT}
          />
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

        <ErrorLine message={error} />
      </View>
    </Modal>
  );
}

export function AddCardModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
  account,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: {
    paymentAccountId: string;
    name: string;
    cardType: 'debit' | 'credit';
    issuerId: string;
    /** 실제 카드 번호. 서버가 마스킹해 보관한다. */
    cardNumber?: string;
    /** 만료 월의 말일 (ISO). */
    expiryDate?: string;
    statementClosingDay?: number;
    paymentDueDay?: number;
    creditLimit?: string;
    performanceAmount?: string;
    /** 카드 앞면 색. 비우면 카드 종류의 기본색이다. */
    color?: string;
    /** 알림에서 이 카드를 알아보는 말. 한 줄에 하나씩이다. */
    matchText?: string;
  }) => Promise<AssetSaveResult>;
  isSubmitting: boolean;
  /** 결제 통장. 목록에서 눌러 들어온 계좌다. */
  account: Account;
}) {
  const { t } = useTranslation();
  const { options: issuerOptions, error: issuerError } = useInstitutions('card_issuer');
  const [name, setName] = useState('');
  const [cardType, setCardType] = useState<'debit' | 'credit'>('debit');
  const [issuerId, setIssuerId] = useState('');
  /** 실제 카드 번호. 서버가 마스킹해 보관하므로 여기서만 온전한 값을 적는다. */
  const [cardNumber, setCardNumber] = useState('');
  /** 만료 월 "YYYY-MM". 저장은 그 달의 말일로 한다. */
  const [expiryMonth, setExpiryMonth] = useState('');
  /** 카드 앞면 색. 비워 두면 카드 종류의 기본색으로 그린다. */
  const [color, setColor] = useState('');
  /** 신용카드의 마감일·결제일. 기본값에서 시작해 카드사 날짜에 맞춘다. */
  const [closingDay, setClosingDay] = useState(DEFAULT_STATEMENT_CLOSING_DAY);
  const [dueDay, setDueDay] = useState(DEFAULT_PAYMENT_DUE_DAY);
  /** 신용한도. 신용카드에만 있다. */
  const [creditLimit, setCreditLimit] = useState('');
  /** 실적 기준액. 체크카드에도 있다 (그때는 달력 월로 센다). */
  const [performanceAmount, setPerformanceAmount] = useState('');
  /** 알림에서 이 카드를 알아보는 말. 여러 줄이다. */
  const [matchText, setMatchText] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setName('');
      setCardType('debit');
      setIssuerId('');
      setCardNumber('');
      setExpiryMonth('');
      setColor('');
      setClosingDay(DEFAULT_STATEMENT_CLOSING_DAY);
      setDueDay(DEFAULT_PAYMENT_DUE_DAY);
      setCreditLimit('');
      setPerformanceAmount('');
      setMatchText('');
      setError('');
    }
  }, [isOpen]);

  const save = async () => {
    // 만료일은 월까지만 받는다. 저장은 그 달의 말일이다 (웹과 같다).
    const expiryDate = monthInputToIso(expiryMonth);

    const result = await onSubmit({
      paymentAccountId: account.id,
      name: name.trim(),
      cardType,
      issuerId,
      ...(cardNumber.trim() ? { cardNumber: cardNumber.trim() } : {}),
      ...(expiryDate ? { expiryDate } : {}),
      ...(color ? { color } : {}),
      // 신용카드는 마감일과 결제일이 있어야 한다 (서버가 막는다). 한도도 신용카드만이다.
      ...(cardType === 'credit'
        ? {
            statementClosingDay: closingDay,
            paymentDueDay: dueDay,
            ...(creditLimit.trim() ? { creditLimit: toAmountString(creditLimit) } : {}),
          }
        : {}),
      ...(performanceAmount.trim()
        ? { performanceAmount: toAmountString(performanceAmount) }
        : {}),
      ...(matchText.trim() ? { matchText: matchText.trim() } : {}),
    });
    if (result.ok) onClose();
    else setError(result.message ?? '');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('card.add')}
      footer={
        <SubmitButton
          label={t(isSubmitting ? 'account.adding' : 'account.addSubmit')}
          disabled={isSubmitting || !name.trim() || !issuerId}
          onPress={save}
        />
      }
    >
      <View className="gap-4">
        {/* 결제 통장은 누른 자리가 정한다. */}
        <Field label={t('card.account')}>
          <Text className="rounded-lg bg-gray-50 px-3 py-2 text-gray-900">{account.name}</Text>
        </Field>

        <Field label={t('card.name')}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={t('card.namePlaceholder')}
            placeholderTextColor="#9ca3af"
            className={INPUT}
          />
        </Field>

        {/* 카드 번호. 서버가 마스킹해 보관하므로 온전한 값을 적는 자리는 여기뿐이다. */}
        <Field label={t('card.numberOptional')}>
          <TextInput
            value={cardNumber}
            onChangeText={setCardNumber}
            keyboardType="number-pad"
            placeholder={t('card.numberPlaceholder')}
            placeholderTextColor="#9ca3af"
            className={INPUT}
          />
          <Text className="mt-1 text-xs text-gray-500">{t('card.numberMaskHint')}</Text>
        </Field>

        <Field label={t('card.type')}>
          <PickRow
            options={[
              { id: 'debit', name: t('method.debit_card') },
              { id: 'credit', name: t('method.credit_card') },
            ]}
            value={cardType}
            onPick={(id) => setCardType(id as 'debit' | 'credit')}
          />
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

        {/* 홈 화면의 카드 앞면 색. 고르지 않으면 종류의 기본색으로 보인다. */}
        <Field label={t('card.color')}>
          <CardColorPicker value={color} onChange={setColor} />
          <Text className="mt-1 text-xs text-gray-500">
            {t('card.colorHint', {
              default: t(
                cardType === 'credit' ? 'card.colorDefaultCredit' : 'card.colorDefaultDebit',
              ),
            })}
          </Text>
        </Field>

        {/*
          마감일과 결제일. 신용카드에만 있다 -- 체크카드는 결제 즉시 통장에서 빠져
          청구 주기가 없다.

          예전에는 기본값으로 넣고 "웹에서 고칠 수 있습니다"라고만 적었다. 그런데 앱의
          카드 수정 창에도 이 칸이 없어, 한 번 만든 카드의 날짜를 앱에서는 영영 고칠 수
          없었다. 정산과 사용액 그래프가 이 날짜로 구간을 나눈다.
        */}
        {cardType === 'credit' ? (
          <>
            <Field label={t('card.closingDay')}>
              <DayOfMonthSelect value={closingDay} onSelect={setClosingDay} />
            </Field>
            <Field label={t('card.paymentDay')}>
              <DayOfMonthSelect value={dueDay} onSelect={setDueDay} />
            </Field>
            <Text className="text-xs leading-5 text-gray-500">{dayOfMonthHint()}</Text>

            <Field label={t('card.limit', { currency: account.currency })}>
              <TextInput
                value={creditLimit}
                onChangeText={setCreditLimit}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor="#9ca3af"
                className={INPUT}
              />
            </Field>
          </>
        ) : null}

        {/*
          실적 기준액. 앱이 이 값으로 실적 판과 사용액 그래프의 기준선을 그린다 --
          비워 두면 그 둘이 아예 뜨지 않아, 앱에서만 쓰는 사람은 볼 길이 없었다.
        */}
        <CardPerformanceField
          cardType={cardType}
          value={performanceAmount}
          onChange={setPerformanceAmount}
          statementClosingDay={cardType === 'credit' ? closingDay : undefined}
          inputClassName={INPUT}
        />

        <MatchTextField value={matchText} onChange={setMatchText} />

        <ErrorLine message={error} />
      </View>
    </Modal>
  );
}
