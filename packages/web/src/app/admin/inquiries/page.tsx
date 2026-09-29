'use client';

/*
 * 문의. 사용자가 설정의 "문의하기"로 보낸 글을 보고 답한다.
 *
 * 답을 기다리는 것(마지막 글이 사용자 것)이 위에 오고, 그 안에서는 오래 기다린 것이 위다.
 * 답하면 서버가 그 사용자의 기기 전부에 푸시를 보내고, 사용자의 설정에 읽지 않은 답의 수가
 * 선다. 푸시가 실패해도 답은 담긴다.
 *
 * 탭이 보이는 동안 `INQUIRY_POLL_MS` 마다 목록과 연 문의를 다시 묻는다. 사용자가 새로 묻거나
 * 덧붙이면 새로고침하지 않아도 몇 초 안에 선다.
 *
 * 사용자가 묻지 않았어도 먼저 보낼 수 있다("새 메시지"). 이름·이메일로 사람을 찾아 보내면 그
 * 사람의 문의하기에 새 대화로 서고, 기기로 푸시가 간다. 그 뒤로는 보통 문의와 같다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { INQUIRY_BODY_MAX, INQUIRY_POLL_MS, type InquiryDto, type InquiryStatus } from '@money/types';

import { useIsTabVisible } from '@/hooks/useIsTabVisible';
import {
  AdminAuthError,
  getInquiry,
  listInquiries,
  replyInquiry,
  searchUsers,
  startInquiry,
} from '@/lib/admin-api';
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
  /** 먼저 보내는 글을 쓰는 중인가. 그동안 오른쪽 칸이 쓰기 칸이 된다. */
  const [isComposing, setIsComposing] = useState(false);

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

  const isVisible = useIsTabVisible();
  const latestSelected = useRef(selected);
  latestSelected.current = selected;

  /*
   * 보이는 동안 몇 초마다 다시 묻는다.
   *
   * 조용히 묻는다. "불러오는 중"을 띄우지 않고, 로그인이 풀린 것 말고는 실패를 적지 않는다 --
   * 잠깐 끊긴 망 때문에 답을 쓰던 자리 위에 빨간 줄이 서면 안 된다. 다음 조회가 다시 해 본다.
   * 적던 답장은 따로 들고 있어 새로 받아도 지워지지 않는다. 연 문의는 글 수가 바뀌었을 때만
   * 갈아 끼운다(같은 대화를 3초마다 다시 그리지 않게).
   */
  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const opened = latestSelected.current;
        const [nextRows, nextSelected] = await Promise.all([
          listInquiries(filter || undefined),
          opened ? getInquiry(opened.id) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setRows(nextRows);
        setSelected((current) =>
          // 묻는 사이에 다른 문의를 열었으면 그것을 덮지 않는다.
          nextSelected && current?.id === nextSelected.id && current.messages.length !== nextSelected.messages.length
            ? nextSelected
            : current,
        );
      } catch (reason) {
        if (reason instanceof AdminAuthError) router.replace('/admin/login');
      }
    };

    const timer = setInterval(() => void poll(), INQUIRY_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isVisible, filter, router]);

  const open = async (id: string) => {
    setIsComposing(false);
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

  /** 먼저 보낸 뒤. 그 대화를 열고, 답변 완료 상태라 "답변 대기" 목록에는 없으므로 전체로 옮긴다. */
  const started = (saved: InquiryDto.AdminDetail) => {
    setIsComposing(false);
    setSelected(saved);
    setReply('');
    setMessage({ kind: 'ok', text: `${saved.userName}님에게 보냈습니다. 기기로 푸시를 보냅니다.` });
    if (filter === 'waiting') setFilter('');
    else void load();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">문의</h1>
          <p className="mt-1 text-sm text-gray-600">
            사용자가 설정의 문의하기로 보낸 글입니다. 답하면 그 사람의 기기로 푸시가 가고, 설정의 문의하기에 읽지
            않은 답의 수가 뜹니다. 묻지 않은 사람에게도 먼저 보낼 수 있습니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setIsComposing(true);
            setSelected(null);
            setMessage(null);
          }}
          className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          새 메시지
        </button>
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
              /*
                마지막 글의 시각을 열쇠에 넣는다. 사용자가 덧붙여 그 줄이 바뀌면 새로 서며
                `unfold` 로 떠오르므로, 몇 초마다 새로 받는 목록에서 무엇이 바뀌었는지 눈에 띈다.
              */
              key={`${row.id}:${row.lastMessageAt}`}
              type="button"
              onClick={() => void open(row.id)}
              className={`unfold block w-full space-y-1 rounded-xl border bg-white p-3 text-left transition-colors hover:bg-gray-50 ${
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

        {isComposing ? (
          <ComposePanel onSent={started} onCancel={() => setIsComposing(false)} onError={fail} />
        ) : selected ? (
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
                  <div key={item.id} className={`unfold max-w-[85%] space-y-1 ${mine ? 'self-end' : 'self-start'}`}>
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

/**
 * 먼저 보내는 칸. 이름이나 이메일로 사람을 찾고, 고른 사람에게 첫 글을 보낸다.
 *
 * 찾기는 치는 동안 잠깐 멈췄을 때 묻는다(`SEARCH_DELAY_MS`). 늦게 온 답이 새 답을 덮지 않도록
 * 물을 때마다 번호를 매겨 마지막 것만 받는다.
 */
const SEARCH_DELAY_MS = 250;

function ComposePanel({
  onSent,
  onCancel,
  onError,
}: {
  onSent: (saved: InquiryDto.AdminDetail) => void;
  onCancel: () => void;
  onError: (reason: unknown) => void;
}) {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<InquiryDto.AdminUser[]>([]);
  const [isSearching, setIsSearching] = useState(true);
  const [target, setTarget] = useState<InquiryDto.AdminUser | null>(null);
  const [body, setBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  const searchRun = useRef(0);

  useEffect(() => {
    if (target) return;
    const run = ++searchRun.current;
    setIsSearching(true);
    const timer = setTimeout(() => {
      searchUsers(query)
        .then((rows) => {
          if (run === searchRun.current) setUsers(rows);
        })
        .catch(onError)
        .finally(() => {
          if (run === searchRun.current) setIsSearching(false);
        });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query, target, onError]);

  const send = async () => {
    if (!target || !body.trim()) return;
    setIsSending(true);
    try {
      onSent(await startInquiry(target.id, body.trim()));
    } catch (reason) {
      onError(reason);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <section className="unfold space-y-4 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-900">새 메시지</h2>
        <button type="button" onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-700">
          그만두기
        </button>
      </div>

      {target ? (
        <div className="unfold flex items-center justify-between gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm">
          <span className="min-w-0 truncate text-gray-900">
            {target.name} <span className="text-gray-500">{target.email}</span>
          </span>
          <button
            type="button"
            onClick={() => setTarget(null)}
            className="shrink-0 text-xs text-blue-700 hover:underline"
          >
            다른 사람
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="이름이나 이메일로 찾기"
            autoFocus
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {!isSearching && users.length === 0 ? (
              <p className="p-3 text-center text-sm text-gray-500">찾는 사람이 없습니다.</p>
            ) : null}
            {users.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => setTarget(user)}
                className="unfold block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-gray-50"
              >
                <span className="text-gray-900">{user.name}</span>{' '}
                <span className="text-gray-500">{user.email}</span>
              </button>
            ))}
          </div>
        </div>
      )}

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
          placeholder="보낼 내용을 적어 주세요"
          maxLength={INQUIRY_BODY_MAX}
          rows={6}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {body.length}/{INQUIRY_BODY_MAX}
          </span>
          <button
            type="submit"
            disabled={!target || !body.trim() || isSending}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {isSending ? '보내는 중…' : '보내기'}
          </button>
        </div>
      </form>
    </section>
  );
}
