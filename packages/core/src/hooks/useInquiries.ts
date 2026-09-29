/**
 * 문의하기 화면의 목록과 한 줄기 대화. 웹과 앱이 같은 훅을 쓴다.
 *
 * **서버에서 곧바로 읽고 쓴다.** 연결이 없으면 보내지 못하고 그 이유를 오류로 적는다.
 * 문의 하나를 열면 서버가 읽은 것으로 적으므로, 그 뒤에 배지 수를 다시 센다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { INQUIRY_POLL_MS, type InquiryDto } from '@money/types';

import { apiClient } from '../lib/api-client';
import { useApiError } from '../lib/api-error';
import { refreshInquiryUnread } from '../store/inquiry-unread';

/**
 * 문의하기 화면이 새 답을 기다리는 방법. 목록과 대화가 같은 값을 받는다.
 */
export interface InquiryWatchOptions {
  /**
   * 그 화면이 사람 눈앞에 있는가(앱은 앞에 떠 있고 그 모양일 때, 웹은 탭이 보일 때).
   *
   * 켜져 있는 동안만 `INQUIRY_POLL_MS` 마다 묻는다. 뒤로 가 있는데도 물으면 서버가 "보고
   * 있다"로 읽어 답장 푸시를 보내지 않는다 -- 보지 않는 사람이 답을 놓친다.
   */
  active: boolean;
  /** 물어서 바뀐 것이 왔을 때, 화면에 그리기 직전에 부른다. 앱이 움직임을 거는 자리다. */
  onArrive?: () => void;
}

/**
 * 눈앞에 있는 동안 `INQUIRY_POLL_MS` 마다 `poll` 을 부른다.
 *
 * 조용히 묻는다. "불러오는 중"을 띄우지 않고, 실패해도 오류를 적지 않는다 -- 3초마다
 * 깜빡이거나, 잠깐 끊긴 망 때문에 읽던 화면 위에 빨간 줄이 서면 안 된다. 다음 조회가 다시
 * 해 본다. 다시 눈앞에 오면(앱을 켜거나 탭으로 돌아오면) 기다리지 않고 곧바로 묻는다 --
 * 처음 열 때는 화면의 첫 읽기가 이미 묻고 있어(`loaded` 가 false) 한 번 더 묻지 않는다.
 *
 * `poll` 은 받은 것을 화면에 넣기 전에 `isCancelled()` 를 본다. 화면을 떠난 뒤에 도착한
 * 응답이 다른 문의의 화면에 들어가면 안 된다.
 */
function useWatchPoll(
  enabled: boolean,
  loaded: boolean,
  poll: (isCancelled: () => boolean) => Promise<void>,
) {
  const latestPoll = useRef(poll);
  latestPoll.current = poll;
  const latestLoaded = useRef(loaded);
  latestLoaded.current = loaded;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const tick = () =>
      void latestPoll.current(() => cancelled).catch(() => {
        // 다음 조회가 다시 해 본다.
      });

    if (latestLoaded.current) tick();
    const timer = setInterval(tick, INQUIRY_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled]);
}

/** 목록이 바뀌었는가. 줄의 차례·마지막 글·읽지 않은 수·상태만 본다. */
function listSignature(inquiries: InquiryDto.Summary[]): string {
  return inquiries
    .map((inquiry) => `${inquiry.id}:${inquiry.lastMessageAt}:${inquiry.unreadCount}:${inquiry.status}`)
    .join('|');
}

export interface UseInquiriesResult {
  inquiries: InquiryDto.Summary[];
  isLoading: boolean;
  /** 읽거나 보내다 난 오류. 빈 글자면 아무 일도 없었다. */
  error: string;
  reload: () => Promise<void>;
  /** 새 문의. 보낸 문의를 돌려주고, 못 보내면 null. */
  create: (body: string) => Promise<InquiryDto.Detail | null>;
}

export function useInquiries({ active, onArrive }: InquiryWatchOptions): UseInquiriesResult {
  const { messageOf } = useApiError();
  const [inquiries, setInquiries] = useState<InquiryDto.Summary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  /** 한 번이라도 받았는가. 받기 전에는 곧바로 묻지 않는다(`useWatchPoll`). */
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      setIsLoading(true);
      setInquiries(await apiClient.getInquiries());
      setError('');
      setLoaded(true);
      void refreshInquiryUnread();
    } catch (caught) {
      setError(messageOf(caught, 'inquiries.loadFailed', 'online.viewOnlyOnline'));
    } finally {
      setIsLoading(false);
    }
  }, [messageOf]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const latestInquiries = useRef(inquiries);
  latestInquiries.current = inquiries;
  const latestArrive = useRef(onArrive);
  latestArrive.current = onArrive;

  /*
   * 목록을 보는 동안 새 답을 묻는다. 관리자가 답하면 그 줄의 상태와 빨간 수가 몇 초 안에
   * 바뀌고 줄이 맨 위로 올라온다. 바뀐 것이 없으면 화면을 건드리지 않는다.
   */
  useWatchPoll(active, loaded, async (isCancelled) => {
    const next = await apiClient.getInquiries();
    if (isCancelled() || listSignature(next) === listSignature(latestInquiries.current)) return;
    latestArrive.current?.();
    setInquiries(next);
    setError('');
    setLoaded(true);
    // 새 답이 왔으니 설정의 배지도 다시 센다. 바뀐 것이 없으면 셀 것도 그대로다.
    void refreshInquiryUnread();
  });

  const create = useCallback(
    async (body: string) => {
      try {
        const created = await apiClient.createInquiry(body);
        setInquiries((previous) => [created, ...previous]);
        setError('');
        return created;
      } catch (caught) {
        setError(messageOf(caught, 'inquiries.sendFailed', 'online.onlyOnline'));
        return null;
      }
    },
    [messageOf],
  );

  return { inquiries, isLoading, error, reload, create };
}

export interface UseInquiryThreadResult {
  thread: InquiryDto.Detail | null;
  isLoading: boolean;
  error: string;
  reload: () => Promise<void>;
  /** 덧붙여 묻기. 보냈으면 true. */
  send: (body: string) => Promise<boolean>;
}

export function useInquiryThread(
  id: string | null,
  { active, onArrive }: InquiryWatchOptions,
): UseInquiryThreadResult {
  const { messageOf } = useApiError();
  const [thread, setThread] = useState<InquiryDto.Detail | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(id));
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (!id) {
      setThread(null);
      setIsLoading(false);
      return;
    }
    try {
      setIsLoading(true);
      setThread(await apiClient.getInquiry(id));
      setError('');
      // 열면 읽은 것이 된다. 배지를 곧바로 줄인다.
      void refreshInquiryUnread();
    } catch (caught) {
      setError(messageOf(caught, 'inquiries.loadFailed', 'online.viewOnlyOnline'));
    } finally {
      setIsLoading(false);
    }
  }, [id, messageOf]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const latestArrive = useRef(onArrive);
  latestArrive.current = onArrive;
  const latestThread = useRef(thread);
  latestThread.current = thread;

  /*
   * 대화를 보는 동안 새 답을 묻는다. 관리자가 답하면 몇 초 안에 화면에 선다.
   * 글 수가 그대로면 화면을 바꾸지 않는다. 새 객체를 넣으면 같은 대화가 3초마다 다시 그려진다.
   */
  useWatchPoll(Boolean(id) && active, thread !== null, async (isCancelled) => {
    if (!id) return;
    const next = await apiClient.getInquiry(id);
    const known = latestThread.current;
    if (isCancelled() || known?.messages.length === next.messages.length) return;
    // 처음 읽기가 실패해 비어 있었으면 이것이 첫 대화다. 움직임 없이 세우고 오류를 걷는다.
    if (known) latestArrive.current?.();
    else setError('');
    setThread(next);
    // 읽은 것으로 적혔으니 배지를 다시 센다. 새 글이 없으면 셀 것도 바뀌지 않았다.
    void refreshInquiryUnread();
  });

  const send = useCallback(
    async (body: string) => {
      if (!id) return false;
      try {
        setThread(await apiClient.addInquiryMessage(id, body));
        setError('');
        return true;
      } catch (caught) {
        setError(messageOf(caught, 'inquiries.sendFailed', 'online.onlyOnline'));
        return false;
      }
    },
    [id, messageOf],
  );

  return { thread, isLoading, error, reload, send };
}
