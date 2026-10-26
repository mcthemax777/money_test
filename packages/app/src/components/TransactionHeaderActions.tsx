/*
 * 거래 화면 머리글 오른쪽의 단추들. 보관함 · 목록/달력 바꾸기 · 검색 · 더보기.
 *
 * 거래 화면(TransactionsScreen)에서 떼어 냈다 (2026-10-26).
 */
import { Pressable, Text, View } from 'react-native';
import { Archive, CalendarDays, List, MoreVertical, Search } from 'lucide-react-native';

import { useTranslation } from '@money/core/lib/i18n';

import CountBadge from './CountBadge';

export default function TransactionHeaderActions({
  inboxCount,
  isCalendar,
  searchCount,
  onOpenInbox,
  onToggleCalendar,
  onOpenSearch,
  onOpenMore,
}: {
  /** 보관함에 기다리는 후보 수. 아이콘 오른쪽 위 배지로 얹는다. */
  inboxCount: number;
  /** 달력으로 보는 중인가. 단추는 누르면 될 쪽을 그린다. */
  isCalendar: boolean;
  /** 걸어 둔 검색 조건 수. */
  searchCount: number;
  onOpenInbox: () => void;
  onToggleCalendar: () => void;
  onOpenSearch: () => void;
  /** 주지 않으면 더보기 단추가 없다. 읽기 전용 구성원이 그렇다. */
  onOpenMore?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <View className="flex-row gap-2">
      {/*
        보관함. 검색 왼쪽에 둔다.

        아직 거래가 아닌 후보가 쌓이는 자리라 거래 화면에서 들어가는 것이
        맞다 -- 그 후보가 되려는 것이 이 화면의 줄이다. 대기 건수는 아이콘
        오른쪽 위에 빨간 배지로 얹는다.
      */}
      <Pressable
        onPress={onOpenInbox}
        accessibilityLabel={t('inbox.open')}
        className="items-center justify-center px-2 py-2"
      >
        <View className="relative">
          <Archive size={18} color="#4b5563" />
          <CountBadge count={inboxCount} />
        </View>
      </Pressable>
      {/*
        보기를 바꾸는 단추. 지금 무엇을 보고 있는지가 아니라 **누르면 무엇이
        되는지**를 그린다 -- 목록을 보는 중이면 달력, 달력을 보는 중이면 목록이다.
        누를 자리와 그 결과가 한 그림이라 설명이 필요 없다.
      */}
      <Pressable
        onPress={onToggleCalendar}
        accessibilityLabel={t(isCalendar ? 'tx.viewList' : 'tx.viewCalendar')}
        className="items-center justify-center p-2"
      >
        {isCalendar ? (
          <List size={18} color="#2563eb" />
        ) : (
          <CalendarDays size={18} color="#4b5563" />
        )}
      </Pressable>
      {/*
        검색. 달력 보기에서도 둔다 -- 걸어 둔 조건이 달력에도 그대로 걸린다.
      */}
      <Pressable
        onPress={onOpenSearch}
        accessibilityLabel={t('tx.search')}
        /*
          아이콘만 둔다. 테두리·바탕도, 누를 때의 바탕도 없다. 머리글에서
          이름 옆에 붙는 자리라 상자를 그리면 아이콘보다 상자가 먼저 보인다.
          걸어 둔 검색이 있다는 신호는 파란 돋보기와 그 옆 숫자가 맡는다.
        */
        className="flex-row items-center gap-1.5 px-2 py-2"
      >
        {/* 돋보기만 둔다. 몇 개를 걸어 두었는지는 옆에 숫자로 붙인다. */}
        <Search size={18} color={searchCount > 0 ? '#2563eb' : '#4b5563'} />
        {searchCount > 0 ? (
          <Text className="text-sm font-semibold text-blue-600">{searchCount}</Text>
        ) : null}
      </Pressable>
      {/*
        더보기에는 쓰는 일만 들어 있다(태그 붙이기·지우기). 읽기 전용
        구성원에게는 열 것이 없으므로 버튼째 감춘다.
      */}
      {onOpenMore ? (
        <Pressable
          onPress={onOpenMore}
          accessibilityLabel={t('tx.more')}
          className="items-center justify-center p-2"
        >
          <MoreVertical size={18} color="#4b5563" />
        </Pressable>
      ) : null}
    </View>
  );
}
