import { useCallback, useEffect, useRef, useState } from 'react';
import type { EntryDto, EntryFilterQuery, EntryListItem } from '@money/types';

import { homeDataPort } from '../data/home-port';

/**
 * 거래를 끊어서 받아 오는 목록.
 *
 * 서버가 날짜 내림차순으로 주므로 앞날에 걸어 둔 거래(예약·미래 날짜)가 맨 위에
 * 온다. 한 번에 다 받지 않는다. 거래는 해가 갈수록 쌓이므로 전부 받으면 화면이
 * 열리는 속도가 계속 느려진다.
 *
 * 다음 쪽을 언제 부를지는 여기서 정하지 않는다. 웹은 바닥에서 한 번 더 당겨야
 * 부르고 앱은 목록 끝에 닿으면 부른다. 그 손짓은 화면마다 다르다.
 */
export function useEntryFeed({
  projectId,
  filter,
  startDate,
  endDate,
  pageSize = 20,
  reloadToken = 0,
}: {
  projectId: string | null;
  /** 가계·홈이 함께 쓰는 자산주인 필터 */
  filter: EntryFilterQuery;
  /** 볼 구간. 넘기지 않으면 전체 기간이다. */
  startDate?: string;
  endDate?: string;
  pageSize?: number;
  /** 값이 바뀌면 처음부터 다시 받는다. 거래를 고친 뒤 화면이 올린다. */
  reloadToken?: number;
}) {
  const [entries, setEntries] = useState<EntryListItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  /*
   * 지금 유효한 조회인지 가리는 표.
   *
   * 필터가 바뀌면 앞서 보낸 요청의 응답이 뒤늦게 돌아와 새 목록 뒤에 옛 거래를
   * 붙일 수 있다. 조회를 시작할 때 표를 올리고, 응답을 받을 때 같은 표인지 본다.
   */
  const runRef = useRef(0);

  /*
   * 지금 부를 다음 커서와, 조회가 나가 있는지.
   *
   * 둘 다 state 만으로는 모자란다. state 는 다시 그려져야 바뀌는데 스크롤 사건은
   * 그 사이에도 계속 들어온다. 그러면 같은 커서로 두 번 불러 같은 거래가 목록에
   * 두 번 붙는다.
   */
  const cursorRef = useRef<string | null>(null);
  const loadingRef = useRef(false);

  const filterKey = JSON.stringify([filter, startDate, endDate]);

  const loadPage = useCallback(
    async (after: string | null, run: number) => {
      if (!projectId || loadingRef.current) return;
      loadingRef.current = true;

      try {
        setIsLoading(true);
        setHasError(false);

        const page: EntryDto.ListResponse = await homeDataPort().getEntries(
          {
            ...filter,
            ...(startDate ? { startDate } : {}),
            ...(endDate ? { endDate } : {}),
            limit: pageSize,
            cursor: after ?? undefined,
          },
          projectId,
        );
        if (runRef.current !== run) return;

        const rows = (page?.data ?? []) as EntryListItem[];
        setEntries((prev) => (after === null ? rows : [...prev, ...rows]));
        cursorRef.current = page?.nextCursor ?? null;
        setHasMore(Boolean(page?.nextCursor));
      } catch (error) {
        if (runRef.current !== run) return;
        console.error('거래 조회 실패:', error);
        setHasError(true);
        // 다음 쪽을 계속 조르지 않는다. 사용자가 다시 시도한다.
        setHasMore(false);
      } finally {
        // 지난 조회의 뒤늦은 끝맺음이 지금 나가 있는 조회의 표를 내리면 안 된다.
        if (runRef.current === run) {
          loadingRef.current = false;
          setIsLoading(false);
        }
      }
    },
    // filterKey 로 의존성을 굳힌다. filter 는 렌더마다 새 객체이고 구간도 함께 담는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, filterKey, pageSize, reloadToken],
  );

  /** 처음부터 다시. 프로젝트나 필터가 바뀔 때와 다시 시도할 때 쓴다. */
  const reload = useCallback(() => {
    const run = runRef.current + 1;
    runRef.current = run;
    setEntries([]);
    cursorRef.current = null;
    setHasMore(true);
    // 앞선 조회는 이제 버려진다. 그것이 끝나기를 기다리지 않는다.
    loadingRef.current = false;
    loadPage(null, run);
  }, [loadPage]);

  useEffect(() => {
    reload();
  }, [reload]);

  /** 다음 쪽. 커서는 항상 표에서 읽어 같은 쪽을 두 번 붙이지 않는다. */
  const loadNext = useCallback(() => {
    loadPage(cursorRef.current, runRef.current);
  }, [loadPage]);

  return { entries, hasMore, isLoading, hasError, loadNext, reload, setHasMore };
}
