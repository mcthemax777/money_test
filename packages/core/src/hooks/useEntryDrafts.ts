/**
 * 보관함. 아직 거래가 아닌 후보의 목록과 그 처리.
 *
 * 두 탭이 같은 훅을 쓴다(알림 등록용 / 캡처 인식용). 목록을 나누는 것은 `source`
 * 하나뿐이고 처리는 똑같으므로, 탭마다 훅을 두면 같은 코드가 두 벌이 된다.
 *
 * 값은 창구(`draft-port`)에서 온다. 웹은 서버에서, 앱은 기기 사본에서 읽고 처리는
 * 대기 큐를 지난다. 이 훅은 어느 쪽인지 모른다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EntryDraftDto, EntryDraftSource } from '@money/types';

import { useApiError } from '../lib/api-error';
import { draftPort, type DraftAction } from '../data/draft-port';
import { refreshInboxCount, useInboxCountStore } from '../store/inbox-count';
import { useLoadedKey } from './useLoadedKey';
import { useMirrorVersion } from './useMirrorVersion';

export interface UseEntryDraftsResult {
  /** 대기 중인 후보. 탭이 고른 출처의 것만 담긴다. */
  drafts: EntryDraftDto.Response[];
  isLoading: boolean;
  /** 읽거나 처리하다 난 오류. 빈 글자면 아무 일도 없었다. */
  error: string;
  /** 출처별 대기 건수. 탭의 배지와 거래 화면의 아이콘이 함께 쓴다. */
  counts: Record<EntryDraftSource, number>;
  reload: () => Promise<void>;
  /** 등록 표시. 거래를 만든 **뒤에** 부른다. */
  markRegistered: (draftId: string, entryId: string | null) => Promise<boolean>;
  /** 무시. 목록에서 사라지지만 같은 알림이 다시 담기지 않게 표시는 남는다. */
  dismiss: (draftId: string) => Promise<boolean>;
  /** 지우기. 표시까지 없앤다 (같은 알림이 다시 오면 후보가 다시 생긴다). */
  remove: (draftId: string) => Promise<boolean>;
}

/**
 * @param source 볼 탭. 바꾸면 그 출처의 목록을 다시 읽는다.
 */
export function useEntryDrafts(
  projectId: string | null,
  source: EntryDraftSource,
): UseEntryDraftsResult {
  const { messageOf } = useApiError();
  const [all, setAll] = useState<EntryDraftDto.Response[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  /*
   * 사본이 채워질 때마다 올라간다. 앱은 이 값으로 목록을 다시 읽는다.
   *
   * 알림으로 담은 후보는 동기화가 사본에 넣어 주므로, 이것을 보지 않으면 화면을
   * 다시 열 때까지 새 후보가 보이지 않는다. 웹에서는 0에 머문다.
   */
  const mirrorVersion = useMirrorVersion();

  /**
   * 두 출처를 함께 읽는다.
   *
   * 탭마다 따로 읽으면 다른 탭의 배지 숫자를 알 수 없다. 보관함의 크기는 한 가정
   * 규모라 통째로 읽는 편이 요청 수와 코드 둘 다 적다.
   */
  // 같은 가계부를 다시 읽을 때는 목록을 가리지 않는다 (useLoadedKey 주석).
  const loaded = useLoadedKey();

  const reload = useCallback(async () => {
    if (!projectId) {
      loaded.mark(null);
      setAll([]);
      setIsLoading(false);
      return;
    }

    const isRefresh = loaded.has(projectId);
    try {
      if (!isRefresh) setIsLoading(true);
      const rows = await draftPort().list(projectId, { status: 'pending' });
      setAll(rows);
      setError('');
      loaded.mark(projectId);
    } catch (caught) {
      if (isRefresh) {
        // 그려 둔 목록은 여전히 이 가계부의 것이다. 다음 신호에 다시 읽는다.
        console.error('보관함 다시 읽기 실패:', caught);
        return;
      }
      setAll([]);
      setError(messageOf(caught, 'inbox.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [projectId, messageOf, loaded]);

  useEffect(() => {
    void reload();
  }, [reload, mirrorVersion]);

  /*
   * 읽은 목록의 수를 탭 배지에 적는다. 후보를 처리해 목록에서 뺄 때도 여기로 와서, 탭의 수가
   * 다시 세지 않고 곧바로 준다. 받는 중이거나 못 읽었을 때는 적지 않는다(빈 목록을 0 으로 적으면
   * 오프라인에서 배지가 사라진다).
   */
  useEffect(() => {
    if (!projectId || isLoading || error) return;
    useInboxCountStore.getState().set(projectId, all.length);
  }, [projectId, all, isLoading, error]);

  const act = useCallback(
    async (draftId: string, action: DraftAction, entryId?: string | null): Promise<boolean> => {
      if (!projectId) return false;
      try {
        await draftPort().mark(projectId, draftId, action, entryId ?? null);
        /*
         * 목록에서 곧바로 뺀다.
         *
         * 다시 읽어 오면 서버가 답할 때까지 처리한 줄이 남아 있어, 사용자가 같은 줄을
         * 두 번 누른다. 그 두 번째 누름은 거래를 한 건 더 만든다.
         */
        setAll((previous) => previous.filter((row) => row.id !== draftId));
        setError('');
        return true;
      } catch (caught) {
        setError(messageOf(caught, 'inbox.actionFailed'));
        return false;
      }
    },
    [projectId, messageOf],
  );

  const counts = useMemo(() => {
    const result: Record<EntryDraftSource, number> = {
      notification: 0,
      capture: 0,
      recurring: 0,
    };
    for (const draft of all) result[draft.source] += 1;
    return result;
  }, [all]);

  const drafts = useMemo(() => all.filter((draft) => draft.source === source), [all, source]);

  return {
    drafts,
    isLoading,
    error,
    counts,
    reload,
    markRegistered: (draftId, entryId) => act(draftId, 'registered', entryId),
    dismiss: (draftId) => act(draftId, 'dismissed'),
    remove: (draftId) => act(draftId, 'deleted'),
  };
}

/**
 * 보관함 대기 건수를 센다(`store/inbox-count`). 껍데기에 한 번만 둔다.
 *
 * 가계부를 바꿀 때와 사본이 바뀔 때(앱에서 알림 후보가 동기화로 들어올 때) 다시 센다. 웹은
 * 사본이 없어 뒤엣것이 오지 않으므로, 창으로 돌아올 때 `refreshInboxCount` 를 따로 부른다.
 */
export function useInboxCountSync(projectId: string | null): void {
  const mirrorVersion = useMirrorVersion();
  useEffect(() => {
    void refreshInboxCount(projectId);
  }, [projectId, mirrorVersion]);
}
