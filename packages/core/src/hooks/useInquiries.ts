/**
 * 문의하기 화면의 목록과 한 줄기 대화. 웹과 앱이 같은 훅을 쓴다.
 *
 * **서버에서 곧바로 읽고 쓴다.** 연결이 없으면 보내지 못하고 그 이유를 오류로 적는다.
 * 문의 하나를 열면 서버가 읽은 것으로 적으므로, 그 뒤에 배지 수를 다시 센다.
 */
import { useCallback, useEffect, useState } from 'react';
import type { InquiryDto } from '@money/types';

import { apiClient } from '../lib/api-client';
import { useApiError } from '../lib/api-error';
import { refreshInquiryUnread } from '../store/inquiry-unread';

export interface UseInquiriesResult {
  inquiries: InquiryDto.Summary[];
  isLoading: boolean;
  /** 읽거나 보내다 난 오류. 빈 글자면 아무 일도 없었다. */
  error: string;
  reload: () => Promise<void>;
  /** 새 문의. 보낸 문의를 돌려주고, 못 보내면 null. */
  create: (body: string) => Promise<InquiryDto.Detail | null>;
}

export function useInquiries(): UseInquiriesResult {
  const { messageOf } = useApiError();
  const [inquiries, setInquiries] = useState<InquiryDto.Summary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      setIsLoading(true);
      setInquiries(await apiClient.getInquiries());
      setError('');
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

export function useInquiryThread(id: string | null): UseInquiryThreadResult {
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
