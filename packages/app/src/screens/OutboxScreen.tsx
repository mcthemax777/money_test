/*
 * 보내지 못한 거래.
 *
 * 오프라인에서 적은 것은 기기에 먼저 커밋되고 명령으로 큐에 쌓인다. 이 화면은 그 큐를
 * 두 칸으로 보여 준다.
 *
 *   - **보내는 중.** 아직 서버에 닿지 못한 것. 사람이 할 일은 없고 다음 동기화가
 *     가져간다. 그래도 보여 준다 -- 오프라인에서 적어 둔 것이 어디 있는지 알 수 없으면
 *     사람은 같은 거래를 한 번 더 적는다.
 *   - **사람이 골라야 하는 것.** 아래 두 가지다.
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
import type { Mutation } from '@money/types';
import { useProject, useProjectTimeZone } from '@money/core/store/project';

import PageHeader from '../components/PageHeader';
import {
  discardMutation,
  heldMutations,
  queuedMutations,
  reissueAsNewEntry,
  retryMutation,
  syncNow,
} from '../offline';

const STATUS_KEY: Record<HeldMutation['status'], MessageKey> = {
  conflict: 'outbox.status.conflict',
  rejected: 'outbox.status.rejected',
  blocked: 'outbox.status.blocked',
};

const KIND_KEY: Record<string, MessageKey> = {
  'entry.create': 'outbox.kind.create',
  'entry.replace': 'outbox.kind.replace',
  'entry.delete': 'outbox.kind.delete',
  'entry.tags': 'outbox.kind.entryTags',
  'person.create': 'outbox.kind.personCreate',
  'person.update': 'outbox.kind.personUpdate',
  'account.create': 'outbox.kind.accountCreate',
  'account.update': 'outbox.kind.accountUpdate',
  'card.create': 'outbox.kind.cardCreate',
  'card.update': 'outbox.kind.cardUpdate',
  'category.create': 'outbox.kind.categoryCreate',
  'category.update': 'outbox.kind.categoryUpdate',
  'tag.create': 'outbox.kind.tagCreate',
  'tag.update': 'outbox.kind.tagUpdate',
  'budget.set': 'outbox.kind.budgetSet',
  'budget.override': 'outbox.kind.budgetOverride',
};

/**
 * 줄 하나에 적을 이름.
 *
 * 거래는 설명이, 자산은 이름이 그 자리다. 둘 다 없으면(숨기기처럼 이름을 담지 않는
 * 명령) 무엇을 하려 했는지만 적는다.
 */
function titleOf(payload: { description?: string; name?: string }): string | null {
  return payload.description || payload.name || null;
}

export default function OutboxScreen() {
  const { t } = useTranslation();
  const projectId = useProject((state) => state.selectedProjectId);
  const timeZone = useProjectTimeZone();

  const [held, setHeld] = useState<HeldMutation[]>([]);
  const [queued, setQueued] = useState<Mutation[]>([]);
  const [isBusy, setIsBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!projectId) {
      setHeld([]);
      setQueued([]);
      return;
    }
    const [heldRows, queuedRows] = await Promise.all([
      heldMutations(projectId),
      queuedMutations(projectId),
    ]);
    setHeld(heldRows);
    setQueued(queuedRows);
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

  /**
   * 사라진 거래를 고치려던 명령을 새 거래로 낸다.
   *
   * 다시 보내기와 갈라 둔다. 그쪽은 "그래도 내 값으로 하겠다"이고 이쪽은 "그 거래는
   * 없어졌으니 새로 적겠다"라, 결과가 다르다 -- 여기서는 새 id 의 거래가 하나 생긴다.
   */
  const reissue = async (mutation: HeldMutation) => {
    if (!projectId || isBusy) return;
    setIsBusy(true);
    try {
      await reissueAsNewEntry(mutation);
      await syncNow(projectId, timeZone);
      await reload();
    } finally {
      setIsBusy(false);
    }
  };

  /** 지금 보내 본다. 온라인이면 큐가 비고, 아니면 그대로 남는다. */
  const sendNow = async () => {
    if (!projectId || isBusy) return;
    setIsBusy(true);
    try {
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

      {queued.length === 0 && held.length === 0 ? (
        <View className="rounded-lg bg-white p-6 shadow-sm">
          <Text className="text-gray-600">{t('outbox.empty')}</Text>
        </View>
      ) : null}

      {queued.length > 0 ? (
        <View className="gap-3">
          <View className="flex-row items-center justify-between gap-3">
            <Text className="text-base font-semibold text-gray-900">
              {t('outbox.queuedTitle')}
            </Text>
            <Pressable
              disabled={isBusy}
              onPress={sendNow}
              className={`rounded-lg bg-blue-600 px-3 py-2 ${isBusy ? 'opacity-50' : ''}`}
            >
              <Text className="text-sm text-white">
                {isBusy ? t('outbox.sending') : t('outbox.sendNow')}
              </Text>
            </Pressable>
          </View>
          <Text className="px-1 text-xs text-gray-500">
            {t('outbox.waiting', { count: queued.length })}
          </Text>
          {queued.map((mutation) => (
            <QueuedCard key={mutation.mutationId} mutation={mutation} />
          ))}
        </View>
      ) : null}

      {held.length > 0 ? (
        <View className="gap-3">
          <Text className="text-base font-semibold text-gray-900">{t('outbox.heldTitle')}</Text>
          {held.map((mutation) => (
            <HeldCard
              key={mutation.mutationId}
              mutation={mutation}
              isBusy={isBusy}
              onRetry={() => retry(mutation.mutationId)}
              onReissue={() => reissue(mutation)}
              onDiscard={() => discard(mutation.mutationId)}
            />
          ))}
          <Text className="px-1 text-xs text-gray-500">{t('outbox.discardHint')}</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * 줄을 선 명령 한 줄.
 *
 * 버튼이 없다. 여기 있는 것은 사람이 고를 일이 아니라 나갈 차례를 기다리는 것뿐이고,
 * 지우려면 그 거래를 가계 화면에서 지우면 된다(그러면 지움 명령이 뒤에 붙는다).
 */
function QueuedCard({ mutation }: { mutation: Mutation }) {
  const { t } = useTranslation();
  const payload = mutation.payload as { description?: string; name?: string; amount?: string };

  return (
    <View className="flex-row items-start justify-between gap-3 rounded-lg bg-white p-4 shadow-sm">
      <View className="shrink">
        <Text className="text-base font-medium text-gray-900">
          {titleOf(payload) ?? t(KIND_KEY[mutation.kind] ?? 'outbox.kind.create')}
        </Text>
        <Text className="mt-1 text-sm text-gray-600">
          {t(KIND_KEY[mutation.kind] ?? 'outbox.kind.create')}
        </Text>
      </View>
      {payload.amount ? <Text className="text-base text-gray-900">{payload.amount}</Text> : null}
    </View>
  );
}

function HeldCard({
  mutation,
  isBusy,
  onRetry,
  onReissue,
  onDiscard,
}: {
  mutation: HeldMutation;
  isBusy: boolean;
  onRetry: () => void;
  onReissue: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();

  /*
   * 짐에서 사람이 알아볼 값을 꺼낸다.
   *
   * 삭제 명령에는 설명이 없다. 그 거래는 이미 사본에서도 사라져 이름을 되찾을 곳이 없다.
   * 그럴 때는 무엇을 하려 했는지(삭제)만 적는다.
   */
  const payload = mutation.payload as { description?: string; name?: string; amount?: string };

  return (
    <View className="rounded-lg bg-white p-4 shadow-sm">
      <View className="flex-row items-start justify-between gap-3">
        <View className="shrink">
          <Text className="text-base font-medium text-gray-900">
            {titleOf(payload) ?? t(KIND_KEY[mutation.kind] ?? 'outbox.kind.create')}
          </Text>
          {/*
            충돌은 이유를 덧붙이지 않는다. 서버가 주는 말("다른 기기에서 더 늦게
            고쳤습니다")이 상태 문구와 같은 뜻이라 같은 문장이 두 번 이어진다.
            거절과 보류는 이유가 저마다 달라(권한·규칙·앞 명령) 반드시 함께 적는다.
          */}
          <Text className="mt-1 text-sm text-gray-600">
            {t(STATUS_KEY[mutation.status])}
            {mutation.error && mutation.status !== 'conflict' ? ` · ${mutation.error}` : ''}
          </Text>
        </View>
        {payload.amount ? (
          <Text className="text-base text-gray-900">{payload.amount}</Text>
        ) : null}
      </View>

      {/*
        고치려던 거래가 사라졌으면 다시 보내기 대신 새로 적기를 준다.
        다시 보내 봐야 없는 거래를 고치려는 것이라 영영 거절된다 -- 삭제는 언제나 이긴다.
      */}
      {mutation.targetMissing ? (
        <Text className="mt-2 text-xs text-gray-500">{t('outbox.reissueHint')}</Text>
      ) : null}

      <View className="mt-3 flex-row gap-2">
        {mutation.targetMissing ? (
          <Pressable
            disabled={isBusy}
            onPress={onReissue}
            className={`rounded-lg border border-blue-600 px-3 py-2 ${isBusy ? 'opacity-50' : ''}`}
          >
            <Text className="text-sm font-medium text-blue-600">{t('outbox.reissue')}</Text>
          </Pressable>
        ) : (
          <Pressable
            disabled={isBusy}
            onPress={onRetry}
            className={`rounded-lg border border-blue-600 px-3 py-2 ${isBusy ? 'opacity-50' : ''}`}
          >
            <Text className="text-sm font-medium text-blue-600">{t('outbox.retry')}</Text>
          </Pressable>
        )}
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
