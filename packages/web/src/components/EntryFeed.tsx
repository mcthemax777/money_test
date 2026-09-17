'use client';

import type { EntryFilterQuery } from '@money/types';

import { useEntryFeed } from '@money/core/hooks/useEntryFeed';
import { useTranslation } from '@money/core/lib/i18n';
import TransactionListView from '@/components/TransactionListView';
import PullFooter from '@/components/PullFooter';
import { useBottomPull } from '@/hooks/useBottomPull';
import type { EntryListItem } from '@/components/TransactionItem';

interface EntryFeedProps {
  projectId: string | null;
  /** 가계·홈이 함께 쓰는 자산주인 필터 */
  filter: EntryFilterQuery;
  /** 볼 구간. 넘기지 않으면 전체 기간이다. */
  startDate?: string;
  endDate?: string;
  /** 한 번에 받아올 건수 */
  pageSize?: number;
  /** 거래를 누르면 호출한다. 넘기지 않으면 읽기 전용 목록이다. */
  onEntryClick?: (entry: EntryListItem) => void;
  /** 값이 바뀌면 처음부터 다시 받는다. 거래를 고친 뒤 부모가 올린다. */
  reloadToken?: number;
}

/**
 * 거래를 끊어서 받아 오는 목록.
 *
 * 서버가 날짜 내림차순으로 주므로 앞날에 걸어 둔 거래(예약·미래 날짜)가 맨 위에
 * 온다. 홈은 "무슨 일이 있었나"가 아니라 "무엇이 다가오나"를 먼저 보는 자리다.
 *
 * 한 번에 다 받지 않는다. 거래는 해가 갈수록 쌓이므로 전부 받으면 홈이 열리는
 * 속도가 계속 느려진다.
 *
 * 다음 쪽은 바닥에 닿기만 해서는 오지 않는다. 바닥에서 한 번 더 당겨야 온다
 * (`useBottomPull`). 자산 상세의 원장 목록도 같은 손짓을 쓴다.
 */
export default function EntryFeed({
  projectId,
  filter,
  startDate,
  endDate,
  pageSize = 20,
  onEntryClick,
  reloadToken = 0,
}: EntryFeedProps) {
  const { t } = useTranslation();
  /* 받아 오는 일은 core 가 맡는다. 여기는 언제 다음 쪽을 부를지(당김)만 다룬다. */
  const { entries, hasMore, isLoading, hasError, loadNext, reload, setHasMore } = useEntryFeed({
    projectId,
    filter,
    startDate,
    endDate,
    pageSize,
    reloadToken,
  });

  /* 바닥에서 한 번 더 당기면 다음 쪽이 온다. 그 손짓은 원장 목록과 함께 쓴다. */
  const pull = useBottomPull({
    hasMore,
    isLoading,
    count: entries.length,
    loadMore: loadNext,
  });

  if (!isLoading && entries.length === 0 && !hasError) {
    return <p className="text-sm text-gray-600">{t('feed.empty')}</p>;
  }

  return (
    <div className="space-y-3">
      <TransactionListView entries={entries} onEntryClick={onEntryClick} />

      {hasError && (
        <div className="flex flex-col items-center gap-2 py-3">
          <p className="text-sm text-red-600">{t('feed.loadFailed')}</p>
          <button
            type="button"
            onClick={() => {
              setHasMore(true);
              loadNext();
            }}
            className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-100"
          >
            {t('common.retry')}
          </button>
        </div>
      )}

      <PullFooter
        pull={pull}
        isLoading={isLoading}
        hasMore={hasMore}
        isEmpty={entries.length === 0}
      />
    </div>
  );
}
