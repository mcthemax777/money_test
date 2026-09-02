/*
 * 보내지 못한 거래.
 *
 * 오프라인에서 적은 것은 기기에 먼저 커밋되고 명령으로 큐에 쌓인다. 대개는 다음 동기화
 * 에서 조용히 나가지만, 나가지 못하는 두 경우가 있다.
 *
 *   - **충돌.** 다른 기기가 같은 거래를 더 늦게 고쳤다. 자동 병합은 상태를 수렴시키는
 *     장치일 뿐이고, 어느 금액이 맞는지 아는 것은 사람이다 (설계 문서의 D6).
 *   - **거절·보류.** 서버가 규칙이나 권한으로 받지 않았거나, 앞선 명령이 막혀 함께 미뤘다.
 *
 * 그 둘을 조용히 지우지 않고 여기 모아 보여 준다. 돈은 말없이 사라지면 안 된다.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import type { HeldMutation } from '@money/core/data/local-store';
import { useProject, useProjectTimeZone } from '@money/core/store/project';

import PageHeader from '../components/PageHeader';
import { discardMutation, heldMutations, retryMutation, syncNow } from '../offline';

const STATUS_KEY: Record<HeldMutation['status'], MessageKey> = {
  conflict: 'outbox.status.conflict',
  rejected: 'outbox.status.rejected',
  blocked: 'outbox.status.blocked',
};

const KIND_KEY: Record<string, MessageKey> = {
  'entry.create': 'outbox.kind.create',
  'entry.replace': 'outbox.kind.replace',
  'entry.delete': 'outbox.kind.delete',
};

export default function OutboxScreen() {
  const { t } = useTranslation();
  const projectId = useProject((state) => state.selectedProjectId);
  const timeZone = useProjectTimeZone();

  const [held, setHeld] = useState<HeldMutation[]>([]);
  const [isBusy, setIsBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!projectId) {
      setHeld([]);
      return;
    }
    setHeld(await heldMutations(projectId));
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** 다시 보내 본다. 성공하면 목록에서 사라지고, 또 막히면 이유가 새로 적힌다. */
  const retry = async (mutationId: string) => {
    if (!projectId || isBusy) return;
    setIsBusy(true);
    try {
      await retryMutation(mutationId);
      await syncNow(projectId, timeZone);
      await reload();
    } finally {
      setIsBusy(false);
    }
  };

  const discard = async (mutationId: string) => {
    if (isBusy) return;
    setIsBusy(true);
    try {
      await discardMutation(mutationId);
      await reload();
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <View className="gap-6">
      <PageHeader title={t('outbox.title')} showBack />

      {held.length === 0 ? (
        <View className="rounded-lg bg-white p-6 shadow-sm">
          <Text className="text-gray-600">{t('outbox.empty')}</Text>
        </View>
      ) : (
        <View className="gap-3">
          {held.map((mutation) => (
            <HeldCard
              key={mutation.mutationId}
              mutation={mutation}
              isBusy={isBusy}
              onRetry={() => retry(mutation.mutationId)}
              onDiscard={() => discard(mutation.mutationId)}
            />
          ))}
          <Text className="px-1 text-xs text-gray-500">{t('outbox.discardHint')}</Text>
        </View>
      )}
    </View>
  );
}

function HeldCard({
  mutation,
  isBusy,
  onRetry,
  onDiscard,
}: {
  mutation: HeldMutation;
  isBusy: boolean;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();

  /*
   * 짐에서 사람이 알아볼 값을 꺼낸다.
   *
   * 삭제 명령에는 설명이 없다. 그 거래는 이미 사본에서도 사라져 이름을 되찾을 곳이 없다.
   * 그럴 때는 무엇을 하려 했는지(삭제)만 적는다.
   */
  const payload = mutation.payload as { description?: string; amount?: string };

  return (
    <View className="rounded-lg bg-white p-4 shadow-sm">
      <View className="flex-row items-start justify-between gap-3">
        <View className="shrink">
          <Text className="text-base font-medium text-gray-900">
            {payload.description || t(KIND_KEY[mutation.kind] ?? 'outbox.kind.create')}
          </Text>
          <Text className="mt-1 text-sm text-gray-600">
            {t(STATUS_KEY[mutation.status])}
            {mutation.error ? ` · ${mutation.error}` : ''}
          </Text>
        </View>
        {payload.amount ? (
          <Text className="text-base text-gray-900">{payload.amount}</Text>
        ) : null}
      </View>

      <View className="mt-3 flex-row gap-2">
        <Pressable
          disabled={isBusy}
          onPress={onRetry}
          className={`rounded-lg border border-blue-600 px-3 py-2 ${isBusy ? 'opacity-50' : ''}`}
        >
          <Text className="text-sm font-medium text-blue-600">{t('outbox.retry')}</Text>
        </Pressable>
        <Pressable
          disabled={isBusy}
          onPress={onDiscard}
          className={`rounded-lg border border-gray-300 px-3 py-2 ${isBusy ? 'opacity-50' : ''}`}
        >
          <Text className="text-sm text-gray-700">{t('outbox.discard')}</Text>
        </Pressable>
      </View>
    </View>
  );
}
