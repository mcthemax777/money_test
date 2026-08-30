import { Pressable, Text, View } from 'react-native';
import type { EntryFilterQuery, EntryListItem } from '@money/types';

import { useEntryFeed } from '@money/core/hooks/useEntryFeed';
import { useTranslation } from '@money/core/lib/i18n';

import { useNearBottom } from '../shell/scroll';
import TransactionItem from './TransactionItem';

/**
 * 거래 목록. 웹의 EntryFeed 와 같은 값을 같은 차례로 보여 준다.
 *
 * 받아 오는 일은 core 가 맡고 여기서는 언제 다음 쪽을 부를지만 정한다. 앱에서는 화면
 * 전체가 하나의 스크롤이라, 그 바닥에 닿으면 껍데기가 알려 준다(shell/scroll).
 * 웹은 같은 일을 window 스크롤로 한다.
 */
export default function EntryFeed({
  projectId,
  filter,
  startDate,
  endDate,
  onEntryClick,
  reloadToken = 0,
}: {
  projectId: string | null;
  filter: EntryFilterQuery;
  startDate?: string;
  endDate?: string;
  onEntryClick?: (entry: EntryListItem) => void;
  reloadToken?: number;
}) {
  const { t } = useTranslation();
  const { entries, hasMore, isLoading, hasError, loadNext, setHasMore } = useEntryFeed({
    projectId,
    filter,
    startDate,
    endDate,
    reloadToken,
  });

  /* 바닥까지 내려오면 다음 쪽을 잇는다. 이미 받는 중이거나 더 없으면 아무 일도 없다. */
  useNearBottom(() => {
    if (hasMore && !isLoading) loadNext();
  });

  if (!isLoading && entries.length === 0 && !hasError) {
    return <Text className="text-sm text-gray-600">{t('feed.empty')}</Text>;
  }

  return (
    <View className="gap-3">
      <View className="overflow-hidden rounded-lg bg-white shadow-sm">
        {entries.map((entry) => (
          <TransactionItem key={entry.id} entry={entry} onPress={() => onEntryClick?.(entry)} />
        ))}
      </View>

      {hasError ? (
        <View className="items-center gap-2 py-3">
          <Text className="text-sm text-red-600">{t('feed.loadFailed')}</Text>
          <Pressable
            onPress={() => {
              setHasMore(true);
              loadNext();
            }}
            className="rounded border border-gray-300 px-3 py-1 active:bg-gray-100"
          >
            <Text className="text-sm text-gray-700">{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : null}

      {/* 바닥. 더 볼 것이 있으면 눌러서 잇는다. */}
      <View className="items-center py-2">
        {isLoading ? (
          <Text className="text-sm text-gray-500">{t('feed.loadingMore')}</Text>
        ) : hasMore ? (
          /* 내려오다 멈춘 사람을 위해 눌러서도 이을 수 있게 둔다. */
          <Pressable onPress={loadNext} className="px-3 py-1">
            <Text className="text-sm text-gray-500">{t('feed.pullHint')}</Text>
          </Pressable>
        ) : entries.length > 0 ? (
          <Text className="text-sm text-gray-500">{t('feed.end')}</Text>
        ) : null}
      </View>
    </View>
  );
}
