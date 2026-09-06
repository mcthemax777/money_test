/*
 * 자산 화면의 고치기 창 셋 (구성원·계좌·카드).
 *
 * 만들기 창(`AssetAddModals`)과 나란히 선다. 묻는 것은 더 적다 -- 이름과, 목록에서의
 * 자리와, 숨기기뿐이다. 주인이나 통화처럼 나중에 바꾸면 지난 기록의 뜻이 달라지는 값은
 * 여기서 다루지 않는다 (웹에서 한다).
 *
 * **순서는 한 칸씩 옮긴다.** 앱에는 드래그가 없어서 위/아래 버튼을 둔다. 한 번 누를
 * 때마다 그 항목의 순서 값 하나만 바뀌므로(분수 색인), 다른 사람이 같은 목록에서 옮긴
 * 것을 덮지 않는다.
 */
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useTranslation } from '@money/core/lib/i18n';
import type { AssetSaveResult } from '@money/core/hooks/useAssetsData';

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

/** 저장과 숨기기. 숨기기는 되돌리기 어려우므로 눌러야 하는 자리를 따로 둔다. */
function Footer({
  isSubmitting,
  canSave,
  onSave,
  onHide,
}: {
  isSubmitting: boolean;
  canSave: boolean;
  onSave: () => void;
  onHide: () => void;
}) {
  const { t } = useTranslation();

  return (
    <View className="flex-row gap-2">
      <Pressable
        onPress={onHide}
        disabled={isSubmitting}
        className={`rounded-lg border border-red-300 px-4 py-3 ${isSubmitting ? 'opacity-40' : ''}`}
      >
        <Text className="text-base text-red-600">{t('assets.hide')}</Text>
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

export function EditPersonModal({
  target,
  onClose,
  isSubmitting,
  onSave,
  onMove,
}: EditProps<{ id: string; name: string; relationship?: string | null }>) {
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
          onHide={() => run(onSave({ isActive: false }), true)}
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
}: EditProps<{ id: string; name: string; accountNumber?: string | null }>) {
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
          onHide={() => run(onSave({ isActive: false }), true)}
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
  onClose,
  isSubmitting,
  onSave,
  onMove,
}: EditProps<{ id: string; name: string }>) {
  const { t } = useTranslation();
  const [name, setName] = useState(target.name);
  const [error, setError] = useState('');

  useEffect(() => {
    setName(target.name);
    setError('');
  }, [target.id, target.name]);

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
          onSave={() => run(onSave({ name: name.trim() }), true)}
          onHide={() => run(onSave({ isActive: false }), true)}
        />
      }
    >
      <View className="gap-4">
        <Field label={t('card.name')}>
          <TextInput value={name} onChangeText={setName} className={INPUT} />
        </Field>

        <MoveRow disabled={isSubmitting} onMove={(step) => void run(onMove(step), false)} />
        <ErrorLine message={error} />
      </View>
    </Modal>
  );
}
