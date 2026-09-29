'use client';

/*
 * 문의. 사용자가 설정의 "문의하기"로 보낸 글을 보고 답한다.
 *
 * 답을 기다리는 것(마지막 글이 사용자 것)이 위에 오고, 그 안에서는 오래 기다린 것이 위다.
 * 답하면 서버가 그 사용자의 기기 전부에 푸시를 보내고, 사용자의 설정에 읽지 않은 답의 수가
 * 선다. 푸시가 실패해도 답은 담긴다.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { INQUIRY_BODY_MAX, type InquiryDto, type InquiryStatus } from '@money/types';

import { AdminAuthError, getInquiry, listInquiries, replyInquiry } from '@/lib/admin-api';
import { errorText } from '../notification-view';

const STATUS_NAME: Record<InquiryStatus, string> = {
  waiting: '답변 대기',
  answered: '답변 완료',
};

export default function AdminInquiriesPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<InquiryStatus | ''>('waiting');
  const [rows, setRows] = useState<InquiryDto.AdminSummary[]>([]);
  const [selected, setSelected] = useState<InquiryDto.AdminDetail | null>(null);
  const [reply, setReply] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const fail = useCallback(
    (reason: unknown) => {
      if (reason instanceof AdminAuthError) router.replace('/admin/login');
      else setMessage({ kind: 'error', text: errorText(reason) });
    },
    [router],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setRows(await listInquiries(filter || undefined));
    } catch (reason) {
      fail(reason);
    } finally {
      setIsLoading(false);
    }
  }, [filter, fail]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async (id: string) => {
    setMessage(null);
    setReply('');
    try {
      setSelected(await getInquiry(id));
    } catch (reason) {
      fail(reason);
    }
  };

  const send = async () => {
    if (!selected || !reply.trim()) return;
    setIsSending(true);
    setMessage(null);
    try {
      const saved = await replyInquiry(selected.id, reply.trim());
      setSelected(saved);
      setReply('');
      setMessage({ kind: 'ok', text: `${saved.userName}님에게 답했습니다. 기기로 푸시를 보냅니다.` });
      void load();
    } catch (reason) {
      fail(reason);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">문의</h1>
        <p className="mt-1 text-sm text-gray-600">
          사용자가 설정의 문의하기로 보낸 글입니다. 답하면 그 사람의 기기로 푸시가 가고, 설정의 문의하기에 읽지
          않은 답의 수가 뜹니다.
        </p>
      </div>

      <div className="flex gap-1">
        {(['waiting', ''] as const).map((value) => (
          <button
            key={value || 'all'}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
              filter === value ? 'bg-blue-50 font-medium text-blue-700' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {value ? STATUS_NAME[value] : '전체'}
          </button>
        ))}
      </div>

      {message ? (
        <div
          className={`unfold rounded-lg p-3 text-sm ${
            message.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
          }`}
        >
          {message.text}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-2">
          {isLoading ? <p className="text-sm text-gray-500">불러오는 중...</p> : null}
          {!isLoading && rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
              {filter === 'waiting' ? '답을 기다리는 문의가 없습니다.' : '문의가 없습니다.'}
            </p>
          ) : null}
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => void open(row.id)}
              className={`block w-full space-y-1 rounded-xl border bg-white p-3 text-left transition-colors hover:bg-gray-50 ${
                selected?.id === row.id ? 'border-blue-400' : 'border-gray-200'
              }`}
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <span
                  className={`rounded-full px-2 py-0.5 font-medium ${
                    row.status === 'waiting' ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'
                  }`}
                >
                  {STATUS_NAME[row.status]}
                </span>
                <span className="text-gray-500">{new Date(row.lastMessageAt).toLocaleString()}</span>
              </div>
              <p className="line-clamp-2 break-words text-sm text-gray-900">{row.preview}</p>
              <p className="text-xs text-gray-500">
                {row.userName} · 글 {row.messageCount}개
              </p>
            </button>
          ))}
        </div>

        {selected ? (
          <section key={selected.id} className="unfold space-y-4 rounded-xl border border-gray-200 bg-white p-4">
            <div className="space-y-1 text-xs text-gray-500">
              <p className="text-sm font-medium text-gray-900">
                {selected.userName} <span className="font-normal text-gray-500">{selected.userEmail}</span>
              </p>
              <p>
                {selected.platform ?? '판 모름'}
                {selected.appVersion ? ` ${selected.appVersion}` : ''} · 처음 보낸 때{' '}
                {new Date(selected.createdAt).toLocaleString()}
              </p>
            </div>

            <div className="flex flex-col gap-3">
              {selected.messages.map((item) => {
                const mine = item.author === 'admin';
                return (
                  <div key={item.id} className={`max-w-[85%] space-y-1 ${mine ? 'self-end' : 'self-start'}`}>
                    <p className={`text-xs text-gray-500 ${mine ? 'text-right' : ''}`}>
                      {mine ? '관리자' : selected.userName} · {new Date(item.createdAt).toLocaleString()}
                    </p>
                    <p
                      className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm ${
                        mine ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'
                      }`}
                    >
                      {item.body}
                    </p>
                  </div>
                );
              })}
            </div>

            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <textarea
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                placeholder="답장을 적어 주세요"
                maxLength={INQUIRY_BODY_MAX}
                rows={5}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">
                  {reply.length}/{INQUIRY_BODY_MAX}
                </span>
                <button
                  type="submit"
                  disabled={!reply.trim() || isSending}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSending ? '보내는 중…' : '답장 보내기'}
                </button>
              </div>
            </form>
          </section>
        ) : (
          <p className="hidden rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 md:block">
            왼쪽에서 문의를 고르세요.
          </p>
        )}
      </div>
    </div>
  );
}
