/*
 * 자산 화면의 고치기 창 셋 (구성원·계좌·카드).
 *
 * 만들기 창(`AssetAddModals`)과 나란히 선다. 묻는 것은 더 적다 -- 이름과, 목록에서의
 * 자리와, 없애기뿐이다. 주인이나 통화처럼 나중에 바꾸면 지난 기록의 뜻이 달라지는 값은
 * 여기서 다루지 않는다 (웹에서 한다).
 *
 * **순서는 한 칸씩 옮긴다.** 앱에는 드래그가 없어서 위/아래 버튼을 둔다. 한 번 누를
 * 때마다 그 항목의 순서 값 하나만 바뀌므로(분수 색인), 다른 사람이 같은 목록에서 옮긴
 * 것을 덮지 않는다.
 */
import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';

import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import {
  dayOfMonthHint,
  DEFAULT_PAYMENT_DUE_DAY,
  DEFAULT_STATEMENT_CLOSING_DAY,
} from '@money/core/lib/day-of-month';
import { toAmountString } from '@money/core/lib/money';
import type { AssetSaveResult } from '@money/core/hooks/useAssetsData';

import CardPerformanceField from './CardPerformanceField';
import DayOfMonthSelect from './DayOfMonthSelect';
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
    if (!HIDE_INSTEAD_CODES.includes(result.code ?? '')) {
      onFail(result.message ?? '');
      return;
    }

    ask(
      `${result.message}\n\n${t('assets.hideInstead')}`,
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
  onClose,
  isSubmitting,
  onSave,
  onMove,
  onRemove,
}: RemovableEditProps<{ id: string; name: string; accountNumber?: string | null }>) {
  const { t } = useTranslation();
  const [name, setName] = useState(target.name);
  const [accountNumber, setAccountNumber] = useState(target.accountNumber ?? '');
  const [error, setError] = useState('');

  useEffect(() => {
    setName(target.name);
    setAccountNumber(target.accountNumber ?? '');
    setError('');
  }, [target.id, target.name, target.accountNumber]);

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
            run(onSave({ name: name.trim(), accountNumber: accountNumber.trim() || null }), true)
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
        <Field label={t('account.name')}>
          <TextInput value={name} onChangeText={setName} className={INPUT} />
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

        <MoveRow disabled={isSubmitting} onMove={(step) => void run(onMove(step), false)} />
        <ErrorLine message={error} />
      </View>
    </Modal>
  );
}

export function EditCardModal({
  target,
  currency,
  onClose,
  isSubmitting,
  onSave,
  onMove,
  onRemove,
}: {
  /** 이 카드 금액의 통화. 결제 통장에 달려 있어 카드만 보고는 알 수 없다. */
  currency: string;
} & RemovableEditProps<{
  id: string;
  name: string;
  cardType: 'debit' | 'credit';
  statementClosingDay: number | null;
  paymentDueDay: number | null;
  creditLimit: string | null;
  performanceAmount: string | null;
}>) {
  const { t } = useTranslation();
  const [name, setName] = useState(target.name);
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
  const [error, setError] = useState('');

  const isCredit = target.cardType === 'credit';

  useEffect(() => {
    setName(target.name);
    setClosingDay(target.statementClosingDay ?? DEFAULT_STATEMENT_CLOSING_DAY);
    setDueDay(target.paymentDueDay ?? DEFAULT_PAYMENT_DUE_DAY);
    setCreditLimit(target.creditLimit ?? '');
    setPerformanceAmount(target.performanceAmount ?? '');
    setError('');
  }, [
    target.id,
    target.name,
    target.statementClosingDay,
    target.paymentDueDay,
    target.creditLimit,
    target.performanceAmount,
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
          canSave={!isSubmitting && !!name.trim()}
          onSave={() =>
            run(
              onSave({
                name: name.trim(),
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
        <Field label={t('card.name')}>
          <TextInput value={name} onChangeText={setName} className={INPUT} />
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

        <MoveRow disabled={isSubmitting} onMove={(step) => void run(onMove(step), false)} />
        <ErrorLine message={error} />
      </View>
    </Modal>
  );
}
