'use client';

/*
 * 문의하기. 앱의 InquiriesScreen 과 같은 짝이다.
 *
 * 한 화면이 세 모양을 오간다 -- 보낸 문의 목록, 새 문의 쓰기, 문의 하나의 대화. 읽지 않은 답이
 * 있는 문의에는 빨간 수가 서고, 열면 읽은 것이 되어 설정의 배지도 줄어든다. 웹은 푸시를 받지
 * 않으므로 답은 이 화면이나 설정을 열 때 보인다.
 */
import { useEffect, useState } from 'react';
import { INQUIRY_BODY_MAX, type InquiryDto } from '@money/types';
import { useInquiries, useInquiryThread } from '@money/core/hooks/useInquiries';
import { formatDateTime } from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import { useProjectTimeZone } from '@money/core/store/project';

import CountBadge from '@/components/CountBadge';
import PageHeader from '@/components/PageHeader';

type Mode = { kind: 'list' } | { kind: 'new' } | { kind: 'thread'; id: string };

export default function InquiriesPage() {
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const isVisible = useIsTabVisible();
  /*
   * 목록은 목록을 보는 동안만 묻는다. 새 문의를 쓰는 중에는 답이 와도 화면에 보이지 않으니
   * "보고 있다"가 아니다 -- 그때 온 답은 푸시로 알린다. 대화 화면은 제 것을 따로 묻는다.
   */
  const list = useInquiries({ active: isVisible && mode.kind === 'list' });

  const go = (next: Mode) => {
    setMode(next);
    // 대화에서 돌아오면 읽은 수가 바뀌었으니 목록을 다시 읽는다.
    if (next.kind === 'list') void list.reload();
  };

  if (mode.kind === 'thread') {
    return <Thread key={mode.id} id={mode.id} onBack={() => go({ kind: 'list' })} />;
  }
  if (mode.kind === 'new') {
    return (
      <Compose
        error={list.error}
        onCancel={() => go({ kind: 'list' })}
        onSend={async (body) => {
          const created = await list.create(body);
          if (created) setMode({ kind: 'thread', id: created.id });
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
    <div className="unfold space-y-4">
      <PageHeader
        title={t('inquiries.title')}
        backHref="/settings"
        action={
          <button
            type="button"
            onClick={onNew}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            {t('inquiries.new')}
          </button>
        }
      />
      <p className="text-sm text-gray-600">{t('inquiries.hint')}</p>

      {list.error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{list.error}</p> : null}
      {list.isLoading && list.inquiries.length === 0 ? (
        <p className="text-sm text-gray-500">{t('inquiries.loading')}</p>
      ) : null}
      {!list.isLoading && !list.error && list.inquiries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          {t('inquiries.empty')}
        </p>
      ) : null}

      <div className="space-y-3">
        {list.inquiries.map((inquiry) => (
          <button
            /*
              마지막 글의 시각을 열쇠에 넣는다. 답이 와서 그 줄이 바뀌면 새로 서며 `unfold` 로
              떠오르므로, 몇 초마다 새로 받는 목록에서 어느 줄이 바뀌었는지 눈에 띈다.
            */
            key={`${inquiry.id}:${inquiry.lastMessageAt}`}
            type="button"
            onClick={() => onOpen(inquiry.id)}
            className="unfold block w-full space-y-2 rounded-lg bg-white p-4 text-left shadow transition hover:shadow-md"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <StatusChip status={inquiry.status} />
                <CountBadge count={inquiry.unreadCount} inline />
              </span>
              <span className="text-xs text-gray-500">{formatDateTime(inquiry.lastMessageAt, timeZone)}</span>
            </div>
            <p className="line-clamp-2 break-words text-gray-900">{inquiry.preview}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: InquiryDto.Summary['status'] }) {
  const { t } = useTranslation();
  const answered = status === 'answered';
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        answered ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
      }`}
    >
      {t(answered ? 'inquiries.status.answered' : 'inquiries.status.waiting')}
    </span>
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
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        maxLength={INQUIRY_BODY_MAX}
        rows={6}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">
          {body.length}/{INQUIRY_BODY_MAX}
        </span>
        <button
          type="submit"
          disabled={!canSend}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {t(isSending ? 'inquiries.sending' : 'inquiries.send')}
        </button>
      </div>
    </form>
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
    <div className="unfold space-y-4">
      <PageHeader title={t('inquiries.new')} onBack={onCancel} />
      <p className="text-sm text-gray-600">{t('inquiries.hint')}</p>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      <Composer placeholder={t('inquiries.placeholder')} onSend={onSend} autoFocus />
    </div>
  );
}

function Thread({ id, onBack }: { id: string; onBack: () => void }) {
  const { t } = useTranslation();
  const timeZone = useProjectTimeZone();
  const isVisible = useIsTabVisible();
  // 새 답은 그 글의 `unfold` 가 떠오르게 한다. 따로 걸 움직임이 없다.
  const { thread, isLoading, error, send } = useInquiryThread(id, { active: isVisible });

  return (
    <div className="unfold space-y-4">
      <PageHeader title={t('inquiries.title')} onBack={onBack} />
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {isLoading && !thread ? <p className="text-sm text-gray-500">{t('inquiries.loading')}</p> : null}

      {thread ? (
        <>
          <StatusChip status={thread.status} />
          <div className="flex flex-col gap-3">
            {thread.messages.map((message) => {
              const mine = message.author === 'user';
              return (
                <div key={message.id} className={`unfold max-w-[85%] space-y-1 ${mine ? 'self-end' : 'self-start'}`}>
                  <p className={`text-xs text-gray-500 ${mine ? 'text-right' : ''}`}>
                    {t(mine ? 'inquiries.author.user' : 'inquiries.author.admin')} ·{' '}
                    {formatDateTime(message.createdAt, timeZone)}
                  </p>
                  <p
                    className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-3 ${
                      mine ? 'bg-blue-600 text-white' : 'bg-white text-gray-900 shadow'
                    }`}
                  >
                    {message.body}
                  </p>
                </div>
              );
            })}
          </div>
          <Composer placeholder={t('inquiries.followUpPlaceholder')} onSend={send} />
        </>
      ) : null}
    </div>
  );
}

/**
 * 이 탭이 보이는가. 다른 탭으로 가거나 창을 내리면 false 다.
 *
 * 보이지 않는 동안 답을 물으면 서버가 보고 있는 것으로 읽어 푸시를 보내지 않는다.
 */
function useIsTabVisible(): boolean {
  const [isVisible, setIsVisible] = useState(true);
  useEffect(() => {
    const update = () => setIsVisible(document.visibilityState === 'visible');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return isVisible;
}
