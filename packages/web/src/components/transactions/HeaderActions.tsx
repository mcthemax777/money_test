'use client';

/*
 * 거래 화면 머리글 오른쪽의 단추들. 보관함 · 목록/달력 바꾸기 · 검색 · 더보기.
 */
import Link from 'next/link';
import { Archive, CalendarDays, List, MoreVertical, Search } from 'lucide-react';
import { useTranslation } from '@money/core/lib/i18n';
import CountBadge from '@/components/CountBadge';

export default function HeaderActions({
  inboxCount,
  isCalendar,
  searchCount,
  onToggleCalendar,
  onSearch,
  onMore,
}: {
  /** 보관함에서 기다리는 후보 수. */
  inboxCount: number;
  isCalendar: boolean;
  /** 걸어 둔 검색 조건 수. */
  searchCount: number;
  onToggleCalendar: () => void;
  onSearch: () => void;
  onMore: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex gap-2">
      {/*
        보관함. 검색 왼쪽에 둔다.

        아직 거래가 아닌 후보가 쌓이는 자리라 거래 화면에서 들어가는 것이
        맞다 -- 그 후보가 되려는 것이 이 화면의 줄이다. 대기 건수는 아이콘
        오른쪽 위에 빨간 배지로 얹는다.
      */}
      <Link
        href="/transactions/inbox"
        aria-label={t('inbox.open')}
        title={t('inbox.title')}
        className="flex items-center px-2 py-2 text-gray-600"
      >
        <span className="relative">
          <Archive className="h-4 w-4" aria-hidden />
          <CountBadge count={inboxCount} />
        </span>
      </Link>
      {/*
        보기를 바꾸는 단추. 지금 무엇을 보고 있는지가 아니라 **누르면 무엇이
        되는지**를 그린다 -- 목록을 보는 중이면 달력, 달력을 보는 중이면 목록이다.
        누를 자리와 그 결과가 한 그림이라 설명이 필요 없다.
      */}
      <button
        type="button"
        onClick={onToggleCalendar}
        aria-label={t(isCalendar ? 'tx.viewList' : 'tx.viewCalendar')}
        title={t(isCalendar ? 'tx.viewList' : 'tx.viewCalendar')}
        className={`flex items-center justify-center p-2 ${isCalendar ? 'text-blue-600' : 'text-gray-600'}`}
      >
        {isCalendar ? <List className="h-4 w-4" aria-hidden /> : <CalendarDays className="h-4 w-4" aria-hidden />}
      </button>
      {/*
        검색. 달력 보기에서도 둔다 -- 걸어 둔 조건이 달력에도 그대로 걸린다.
      */}
      <button
        type="button"
        onClick={onSearch}
        aria-label={t('tx.search')}
        title={t('tx.search')}
        /*
          아이콘만 둔다. 테두리·바탕도, 손을 올렸을 때의 바탕도 없다. 앱과
          같은 모양이다 -- 머리글에서는 상자보다 아이콘이 먼저 보여야 한다.
          검색이 걸려 있다는 신호는 파란 돋보기와 그 옆 숫자가 맡는다.
        */
        className={`flex items-center gap-1.5 px-2 py-2 text-sm font-medium ${
          searchCount > 0 ? 'text-blue-600' : 'text-gray-600'
        }`}
      >
        {/* 돋보기만 둔다. 몇 개를 걸어 두었는지는 옆에 숫자로 붙인다. */}
        <Search className="h-4 w-4" aria-hidden />
        {searchCount > 0 ? <span className="font-semibold">{searchCount}</span> : null}
      </button>
      <button
        type="button"
        onClick={onMore}
        aria-label={t('tx.more')}
        title={t('tx.more')}
        className="flex items-center justify-center p-2 text-gray-600"
      >
        <MoreVertical className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
