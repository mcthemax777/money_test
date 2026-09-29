/*
 * 문의하기. 설정에서 들어온다.
 *
 * 한 화면이 세 모양을 오간다 -- 보낸 문의 목록, 새 문의 쓰기, 문의 하나의 대화. 주소를
 * 따로 두지 않는 것은 대화가 목록의 하위이고 뒤로가기가 목록으로 돌아와야 해서다.
 *
 * 관리자가 답하면 푸시가 오고, 눌러 들어오면 이 화면의 목록이 열린다. 읽지 않은 답이 있는
 * 문의에는 빨간 수가 서고, 열면 읽은 것이 되어 설정의 배지도 줄어든다(`useInquiryThread`).
 * 연결이 없으면 읽지도 보내지도 못하고 그 이유를 적는다.
 */
import { useState } from 'react';
import { LayoutAnimation, Pressable, Text, TextInput, View } from 'react-native';
import { INQUIRY_BODY_MAX, type InquiryDto } from '@money/types';

import { useInquiries, useInquiryThread } from '@money/core/hooks/useInquiries';
import { formatDateTime } from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import { useProjectTimeZone } from '@money/core/store/project';

import CountBadge from '../components/CountBadge';
import PageHeader from '../components/PageHeader';

type Mode = { kind: 'list' } | { kind: 'new' } | { kind: 'thread'; id: string };

/** 모양을 바꿀 때의 움직임. 목록이 밀려나고 대화가 들어서는 것을 투명도로 잇는다. */
function animate() {
  LayoutAnimation.configureNext(LayoutAnimation.create(180, 'easeInEaseOut', 'opacity'));
}

export default function InquiriesScreen() {
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const list = useInquiries();

  const go = (next: Mode) => {
    animate();
    setMode(next);
    // 대화에서 돌아오면 읽은 수가 바뀌었으니 목록을 다시 읽는다.
    if (next.kind === 'list') void list.reload();
  };

  if (mode.kind === 'thread') return <Thread id={mode.id} onBack={() => go({ kind: 'list' })} />;
  if (mode.kind === 'new') {
    return (
      <Compose
        error={list.error}
        onCancel={() => go({ kind: 'list' })}
        onSend={async (body) => {
          const created = await list.create(body);
          if (created) {
            animate();
            setMode({ kind: 'thread', id: created.id });
          }
          return Boolean(created);
        }}
      />
    );
  }
  return <List list={list} onOpen={(id) => go({ kind: 'thread', id })} onNew={() => go({ kind: 'new' })} />;
}

function List({
  list,
  onOpen,
  onNew,
}: {
  list: ReturnType<typeof useInquiries>;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const { t } = useTranslation();
  const timeZone = useProjectTimeZone();

  return (
    <View className="gap-4">
      <PageHeader
        title={t('inquiries.title')}
        showBack
        action={
          <Pressable onPress={onNew} className="rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700">
            <Text className="font-medium text-white">{t('inquiries.new')}</Text>
          </Pressable>
        }
      />
      <Text className="text-sm text-gray-600">{t('inquiries.hint')}</Text>

      {list.error ? <Text className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{list.error}</Text> : null}
      {list.isLoading && list.inquiries.length === 0 ? (
        <Text className="text-sm text-gray-500">{t('inquiries.loading')}</Text>
      ) : null}
      {!list.isLoading && !list.error && list.inquiries.length === 0 ? (
        <Text className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          {t('inquiries.empty')}
        </Text>
      ) : null}

      {list.inquiries.map((inquiry) => (
        <Pressable
          key={inquiry.id}
          onPress={() => onOpen(inquiry.id)}
          className="gap-2 rounded-lg bg-white p-4 shadow-sm active:bg-gray-50"
        >
          <View className="flex-row items-center justify-between gap-2">
            <View className="flex-row items-center gap-2">
              <StatusChip status={inquiry.status} />
              <CountBadge count={inquiry.unreadCount} inline />
            </View>
            <Text className="text-xs text-gray-500">{formatDateTime(inquiry.lastMessageAt, timeZone)}</Text>
          </View>
          <Text className="text-gray-900" numberOfLines={2}>
            {inquiry.preview}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function StatusChip({ status }: { status: InquiryDto.Summary['status'] }) {
  const { t } = useTranslation();
  const answered = status === 'answered';
  return (
    <View className={`rounded-full px-2 py-0.5 ${answered ? 'bg-green-50' : 'bg-gray-100'}`}>
      <Text className={`text-xs font-medium ${answered ? 'text-green-700' : 'text-gray-600'}`}>
        {t(answered ? 'inquiries.status.answered' : 'inquiries.status.waiting')}
      </Text>
    </View>
  );
}

/** 글 쓰는 칸과 보내기. 새 문의와 덧붙여 묻기가 함께 쓴다. */
function Composer({
  placeholder,
  onSend,
  autoFocus,
}: {
  placeholder: string;
  onSend: (body: string) => Promise<boolean>;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const [body, setBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  const canSend = body.trim().length > 0 && !isSending;

  const send = async () => {
    if (!canSend) return;
    setIsSending(true);
    const sent = await onSend(body.trim());
    setIsSending(false);
    if (sent) setBody('');
  };

  return (
    <View className="gap-2">
      <TextInput
        value={body}
        onChangeText={setBody}
        placeholder={placeholder}
        multiline
        autoFocus={autoFocus}
        maxLength={INQUIRY_BODY_MAX}
        textAlignVertical="top"
        className="min-h-32 rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900"
      />
      <View className="flex-row items-center justify-between">
        <Text className="text-xs text-gray-400">
          {body.length}/{INQUIRY_BODY_MAX}
        </Text>
        <Pressable
          onPress={send}
          disabled={!canSend}
          className={`rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700 ${canSend ? '' : 'opacity-50'}`}
        >
          <Text className="font-medium text-white">{t(isSending ? 'inquiries.sending' : 'inquiries.send')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Compose({
  error,
  onCancel,
  onSend,
}: {
  error: string;
  onCancel: () => void;
  onSend: (body: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  return (
    <View className="gap-4">
      <PageHeader title={t('inquiries.new')} onBack={onCancel} />
      <Text className="text-sm text-gray-600">{t('inquiries.hint')}</Text>
      {error ? <Text className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</Text> : null}
      <Composer placeholder={t('inquiries.placeholder')} onSend={onSend} autoFocus />
    </View>
  );
}

function Thread({ id, onBack }: { id: string; onBack: () => void }) {
  const { t } = useTranslation();
  const timeZone = useProjectTimeZone();
  const { thread, isLoading, error, send } = useInquiryThread(id);

  return (
    <View className="gap-4">
      <PageHeader title={t('inquiries.title')} onBack={onBack} />
      {error ? <Text className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</Text> : null}
      {isLoading && !thread ? <Text className="text-sm text-gray-500">{t('inquiries.loading')}</Text> : null}

      {thread ? (
        <>
          <View className="flex-row">
            <StatusChip status={thread.status} />
          </View>
          <View className="gap-3">
            {thread.messages.map((message) => {
              const mine = message.author === 'user';
              return (
                <View key={message.id} className={`max-w-[85%] gap-1 ${mine ? 'self-end' : 'self-start'}`}>
                  <Text className={`text-xs text-gray-500 ${mine ? 'text-right' : ''}`}>
                    {t(mine ? 'inquiries.author.user' : 'inquiries.author.admin')} ·{' '}
                    {formatDateTime(message.createdAt, timeZone)}
                  </Text>
                  <View className={`rounded-2xl px-4 py-3 ${mine ? 'bg-blue-600' : 'bg-white shadow-sm'}`}>
                    <Text className={mine ? 'text-white' : 'text-gray-900'} selectable>
                      {message.body}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
          <Composer
            placeholder={t('inquiries.followUpPlaceholder')}
            onSend={async (body) => {
              const sent = await send(body);
              if (sent) animate();
              return sent;
            }}
          />
        </>
      ) : null}
    </View>
  );
}
