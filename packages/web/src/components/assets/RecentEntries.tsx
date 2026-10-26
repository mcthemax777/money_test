'use client';

/*
 * 구성원·묶음 상세의 "최근 거래" 칸. 두 상세가 같은 모양이라 한곳에 둔다.
 */
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import TransactionListView from '@/components/TransactionListView';
import type { EntryListItem } from '@/components/TransactionItem';

export default function RecentEntries({
  entries,
  limit,
  noteKey,
  onEntryClick,
}: {
  entries: EntryListItem[];
  /** 받아 온 최대 건수. 그만큼 찼으면 더 보는 길을 알린다. */
  limit: number;
  /** 다 찼을 때의 안내 문구. 구성원과 묶음이 다르다. */
  noteKey: MessageKey;
  onEntryClick: (entry: EntryListItem) => void;
}) {
  const { t } = useTranslation();

  return (
    <div>
      <h3 className="text-sm font-medium text-gray-700 mb-2">{t('assets.recentEntries')}</h3>
      {entries.length === 0 ? (
        <p className="text-gray-600 text-center py-8">{t('assets.noEntries')}</p>
      ) : (
        <>
          <TransactionListView entries={entries} onEntryClick={onEntryClick} />
          {entries.length >= limit && (
            <p className="mt-2 text-xs text-gray-500">{t(noteKey, { count: limit })}</p>
          )}
        </>
      )}
    </div>
  );
}
