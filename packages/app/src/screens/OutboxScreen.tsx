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
import { LayoutAnimation, Pressable, Share, Text, View } from 'react-native';
import * as Application from 'expo-application';

import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { formatDate, formatTime } from '@money/core/lib/datetime';
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
  'entry.category': 'outbox.kind.entryCategory',
  'entry.restate': 'outbox.kind.entryRestate',
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
  'budget.delete': 'outbox.kind.budgetDelete',
  'budget.setFrom': 'outbox.kind.budgetSetFrom',
  'exchangeRate.set': 'outbox.kind.exchangeRateSet',
  'exchangeRate.clear': 'outbox.kind.exchangeRateClear',
  'category.merge': 'outbox.kind.categoryMerge',
  'tag.merge': 'outbox.kind.tagMerge',
  'person.delete': 'outbox.kind.personDelete',
  'account.delete': 'outbox.kind.accountDelete',
  'card.delete': 'outbox.kind.cardDelete',
  'account.balance': 'outbox.kind.accountBalance',
  'project.update': 'outbox.kind.projectUpdate',
  'recurring.create': 'outbox.kind.recurringCreate',
  'recurring.update': 'outbox.kind.recurringUpdate',
  'recurring.delete': 'outbox.kind.recurringDelete',
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

/**
 * 줄의 제목. 이름이 없는 명령은 무엇을 하려 했는지로 대신한다.
 *
 * 청구액 확정은 여러 건을 한 번에 담아 이름이 없다. 갈래 이름을 제목으로 쓰면 아래 줄과
 * 같은 말이 두 번 서므로, 몇 건을 맞추려 했는지를 적는다.
 */
function headingOf(
  mutation: Mutation,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
): string {
  if (mutation.kind === 'entry.restate') {
    const items = (mutation.payload as { items?: unknown[] } | null)?.items ?? [];
    return t('outbox.restateCount', { count: items.length });
  }
  const payload = mutation.payload as { description?: string; name?: string };
  return titleOf(payload) ?? t(KIND_KEY[mutation.kind] ?? 'outbox.kind.create');
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
          {headingOf(mutation, t)}
        </Text>
        <Text className="mt-1 text-sm text-gray-600">
          {t(KIND_KEY[mutation.kind] ?? 'outbox.kind.create')}
        </Text>
      </View>
      {payload.amount ? <Text className="text-base text-gray-900">{payload.amount}</Text> : null}
    </View>
  );
}

/** 명령을 적은 시각. 이 기기의 시각이 아니라 가계부의 시간대로 적는다 (다른 화면과 같다). */
function createdAtLabel(createdAt: string, timeZone: string): string {
  return `${formatDate(createdAt, timeZone)} ${formatTime(createdAt, timeZone)}`.trim();
}

/**
 * 짐을 사람이 읽을 모양으로 편다.
 *
 * 필드 이름을 그대로 둔다. 이 칸은 "무엇이 서버의 규칙에 걸렸는가"를 찾는 자리라, 화면의
 * 말로 옮기면 서버 코드에서 같은 필드를 찾을 수 없다. null 은 null 로 적는다 -- 빈 값과
 * null 의 차이가 곧 원인이었던 적이 있다(카드 색, 2026-09-29).
 */
function payloadText(payload: unknown): string {
  try {
    return JSON.stringify(payload, null, 2) ?? String(payload);
  } catch {
    return String(payload);
  }
}

/**
 * 공유할 글. 다른 사람(또는 개발자)이 이 글만 보고 원인을 찾을 수 있어야 한다.
 *
 * 앱 버전을 함께 싣는다. 같은 명령이라도 어느 판이 만들었는지에 따라 짐의 모양이 다르다.
 */
function shareTextOf(mutation: HeldMutation, heading: string, kind: string, status: string): string {
  return [
    `[${heading}] ${kind}`,
    `status: ${mutation.status} (${status})`,
    `error: ${mutation.error ?? '-'}`,
    `kind: ${mutation.kind}`,
    `targets: ${mutation.targets.join(', ')}`,
    `mutationId: ${mutation.mutationId}`,
    `clientSeq: ${mutation.clientSeq}`,
    `createdAt: ${mutation.createdAt}`,
    `app: ${Application.nativeApplicationVersion ?? '-'} (${Application.nativeBuildVersion ?? '-'})`,
    'payload:',
    payloadText(mutation.payload),
  ].join('\n');
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
  const timeZone = useProjectTimeZone();
  /** 자세히 펼쳤는가. 목록이 길어지므로 처음에는 접어 둔다. */
  const [isOpen, setIsOpen] = useState(false);

  const heading = headingOf(mutation, t);
  const kindLabel = t(KIND_KEY[mutation.kind] ?? 'outbox.kind.create');
  const statusLabel = t(STATUS_KEY[mutation.status]);

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.create(180, 'easeInEaseOut', 'opacity'));
    setIsOpen((open) => !open);
  };

  /** 공유 창을 연다. 사용자가 닫거나 실패해도 이 화면에서 할 일은 없다. */
  const share = () => {
    Share.share({ message: shareTextOf(mutation, heading, kindLabel, statusLabel) }).catch(
      (error) => console.warn('보내지 못한 거래를 공유하지 못했습니다:', error),
    );
  };

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
          <Text className="text-base font-medium text-gray-900">{heading}</Text>
          {/*
            충돌은 이유를 덧붙이지 않는다. 서버가 주는 말("다른 기기에서 더 늦게
            고쳤습니다")이 상태 문구와 같은 뜻이라 같은 문장이 두 번 이어진다.
            거절과 보류는 이유가 저마다 달라(권한·규칙·앞 명령) 반드시 함께 적는다.
          */}
          <Text className="mt-1 text-sm text-gray-600">
            {statusLabel}
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

      {/*
        자세히. 무엇을 하려던 명령이고 서버가 왜 받지 않았는지를 빠짐없이 적는다.
        같은 일이 다시 났을 때 이 칸(또는 공유한 글)만 보고 원인을 찾을 수 있어야 한다.
      */}
      {isOpen ? (
        <View className="mt-3 gap-2 rounded-md bg-gray-50 p-3">
          <DetailRow label={t('outbox.detail.kind')} value={`${kindLabel} (${mutation.kind})`} />
          <DetailRow label={t('outbox.detail.target')} value={mutation.targets.join('\n') || '-'} mono />
          <DetailRow
            label={t('outbox.detail.createdAt')}
            value={createdAtLabel(mutation.createdAt, timeZone)}
          />
          <DetailRow
            label={t('outbox.detail.reason')}
            value={`${statusLabel}\n${mutation.error ?? t('outbox.detail.noReason')}`}
          />
          <DetailRow label={t('outbox.detail.payload')} value={payloadText(mutation.payload)} mono />
          <DetailRow label={t('outbox.detail.id')} value={mutation.mutationId} mono />
        </View>
      ) : null}

      <View className="mt-3 flex-row flex-wrap gap-2">
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
        <Pressable onPress={toggle} className="rounded-lg px-3 py-2">
          <Text className="text-sm text-gray-600">
            {t(isOpen ? 'outbox.hideDetails' : 'outbox.showDetails')}
          </Text>
        </Pressable>
        {isOpen ? (
          <Pressable onPress={share} className="rounded-lg px-3 py-2">
            <Text className="text-sm text-blue-600">{t('outbox.share')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** 자세히 칸의 한 줄. 긴 값(짐, id)은 고정폭 글꼴로 적어 필드와 괄호가 줄을 맞춘다. */
function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View>
      <Text className="text-xs font-medium text-gray-500">{label}</Text>
      <Text
        selectable
        className="mt-0.5 text-sm text-gray-800"
        style={mono ? { fontFamily: 'monospace', fontSize: 12 } : undefined}
      >
        {value}
      </Text>
    </View>
  );
}
