'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EntryFilterQuery } from '@money/types';

import { useEntryFeed } from '@money/core/hooks/useEntryFeed';
import { useTranslation } from '@money/core/lib/i18n';
import TransactionListView from '@/components/TransactionListView';
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

/** 다음 쪽을 부르기까지 바닥에서 더 당겨야 하는 거리(px) */
const PULL_THRESHOLD = 72;

/** 당김 표시가 늘어나는 최대 거리. 이보다 더 당겨도 표시는 여기서 멈춘다. */
const PULL_MAX = 96;

/** 당기던 손을 멈추면 표시를 되감기까지 기다리는 시간(ms) */
const PULL_RESET_DELAY = 350;

/**
 * 거래를 끊어서 받아 오는 목록.
 *
 * 서버가 날짜 내림차순으로 주므로 앞날에 걸어 둔 거래(예약·미래 날짜)가 맨 위에
 * 온다. 홈은 "무슨 일이 있었나"가 아니라 "무엇이 다가오나"를 먼저 보는 자리다.
 *
 * 한 번에 다 받지 않는다. 거래는 해가 갈수록 쌓이므로 전부 받으면 홈이 열리는
 * 속도가 계속 느려진다.
 *
 * 다음 쪽은 바닥에 닿기만 해서는 오지 않는다. 바닥에서 한 번 더 당겨야 온다.
 * 닿자마자 이어 붙이면 목록이 끝나는 자리를 못 만나 스크롤이 끝나지 않고,
 * 사용자가 부른 적 없는 요청이 계속 나간다. 당긴 만큼 바닥이 밀렸다가
 * 제자리로 튕겨 돌아오면서 "여기가 끝, 더 볼 수 있음"이 손끝으로 전해진다.
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

  /** 바닥에서 더 당긴 거리. 표시를 밀어내는 값이자 다음 쪽을 부르는 방아쇠다. */
  const [pull, setPull] = useState(0);
  const pullRef = useRef(0);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
   * 첫 쪽이 화면을 다 못 채우면 스크롤이 없어 당길 수도 없다.
   * 스크롤이 생길 때까지만 스스로 잇는다.
   */
  useEffect(() => {
    if (!hasMore || isLoading || entries.length === 0) return;
    if (document.documentElement.scrollHeight <= window.innerHeight + 8) {
      loadNext();
    }
  }, [entries.length, hasMore, isLoading, loadNext]);

  /*
   * 바닥에서의 당김.
   *
   * 휠과 손가락을 함께 받는다. 맥의 고무줄 스크롤에만 기대면 그 동작이 없는
   * 브라우저에서는 더 볼 방법이 사라진다.
   */
  useEffect(() => {
    if (!hasMore) return;

    const atBottom = () =>
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;

    const settle = () => {
      pullRef.current = 0;
      setPull(0);
    };

    const scheduleSettle = () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(settle, PULL_RESET_DELAY);
    };

    /** 아래로 민 거리를 더한다. 문턱을 넘으면 다음 쪽을 부르고 표시를 되감는다. */
    const addPull = (delta: number) => {
      if (isLoading || delta <= 0 || !atBottom()) {
        if (delta < 0) settle();
        return;
      }
      pullRef.current += delta;
      setPull(Math.min(pullRef.current, PULL_MAX));
      if (pullRef.current >= PULL_THRESHOLD) {
        settle();
        loadNext();
        return;
      }
      scheduleSettle();
    };

    const onWheel = (event: WheelEvent) => addPull(event.deltaY);

    let touchY: number | null = null;
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY;
      if (y === undefined || touchY === null) return;
      // 손가락을 위로 끌면 목록은 아래로 간다. 그 방향만 당김으로 센다.
      addPull(touchY - y);
      touchY = y;
    };
    const onTouchEnd = () => {
      touchY = null;
      settle();
    };

    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, [hasMore, isLoading, loadNext]);

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

      {/*
        바닥. 당긴 만큼 아래로 밀렸다가 손을 떼면 제자리로 튕겨 돌아온다.
        되돌아올 때만 애니메이션을 걸어야 당기는 동안 손끝을 따라온다.
      */}
      <div
        className="py-2 text-center text-sm text-gray-500"
        style={{
          transform: `translateY(${pull * 0.5}px)`,
          transition: pull === 0 ? 'transform 320ms cubic-bezier(.2,1.4,.4,1)' : 'none',
        }}
      >
        {isLoading
          ? t('feed.loadingMore')
          : !hasMore
            ? entries.length > 0
              ? t('feed.end')
              : ''
            : pull > 0
              ? t('feed.pullMore')
              : t('feed.pullHint')}
      </div>
    </div>
  );
}
