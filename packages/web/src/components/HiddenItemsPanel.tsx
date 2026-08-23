'use client';

import { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { apiClient } from '@/lib/api-client';

interface HiddenItem {
  id: string;
  name: string;
  kind: 'person' | 'account' | 'card';
}

const KIND_LABEL: Record<HiddenItem['kind'], string> = {
  person: '구성원',
  account: '통장',
  card: '카드',
};

interface Props {
  projectId: string | null;
  /** 다시 표시한 뒤 목록을 새로고침하도록 부모에게 알린다. */
  onRestored: () => void;
  /** 부모가 항목을 숨긴 뒤 값을 올리면 이 패널도 다시 읽는다. */
  reloadToken?: number;
}

/**
 * 숨긴 통장·카드·구성원을 모아 보여 주고 되돌린다.
 *
 * 숨기기는 하드 삭제가 아니라 `isActive`를 내리는 동작인데, 되돌릴 화면이 없어서
 * 실수로 숨기면 방법이 없었다. 평소에는 접혀 있다가 펼칠 때만 조회한다.
 * 숨긴 것이 하나도 없으면 아무것도 그리지 않는다.
 */
export default function HiddenItemsPanel({ projectId, onRestored, reloadToken }: Props) {
  const [items, setItems] = useState<HiddenItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setIsLoading(true);
      setError('');
      const [people, accounts, cards] = await Promise.all([
        apiClient.getPeople(projectId, { includeInactive: true }),
        apiClient.getAccountsV2(projectId, { includeInactive: true }),
        apiClient.getCards(projectId, { includeInactive: true }),
      ]);

      setItems([
        ...(people ?? [])
          .filter((p) => !p.isActive)
          .map((p) => ({ id: p.id, name: p.name, kind: 'person' as const })),
        ...(accounts ?? [])
          .filter((a) => !a.isActive)
          .map((a) => ({ id: a.id, name: a.name, kind: 'account' as const })),
        ...(cards ?? [])
          .filter((c) => !c.isActive)
          .map((c) => ({ id: c.id, name: c.name, kind: 'card' as const })),
      ]);
    } catch {
      setError('숨긴 항목을 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  // 숨긴 것이 있는지는 접혀 있을 때도 알아야 버튼을 보여 줄지 정할 수 있다.
  useEffect(() => {
    load();
  }, [load, reloadToken]);

  const restore = async (item: HiddenItem) => {
    try {
      setRestoringId(item.id);
      setError('');
      if (item.kind === 'person') {
        await apiClient.updatePerson(item.id, { isActive: true });
      } else if (item.kind === 'account') {
        await apiClient.updateAccountV2(item.id, { isActive: true });
      } else {
        await apiClient.updateCard(item.id, { isActive: true });
      }
      await load();
      onRestored();
    } catch {
      setError('다시 표시하지 못했습니다.');
    } finally {
      setRestoringId(null);
    }
  };

  if (items.length === 0 && !error) return null;

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <EyeOff className="w-4 h-4 text-gray-400" />
          숨긴 항목 {items.length}개
        </span>
        <span className="text-xs text-gray-400">{isOpen ? '접기' : '펼치기'}</span>
      </button>

      {isOpen && (
        <div className="mt-4 space-y-2">
          {isLoading && <p className="text-sm text-gray-500">불러오는 중...</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}

          {items.map((item) => (
            <div
              key={`${item.kind}:${item.id}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2"
            >
              <span className="min-w-0 truncate text-sm text-gray-700">
                <span className="mr-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                  {KIND_LABEL[item.kind]}
                </span>
                {item.name}
              </span>
              <button
                type="button"
                onClick={() => restore(item)}
                disabled={restoringId === item.id}
                className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
              >
                <Eye className="w-3.5 h-3.5" />
                {restoringId === item.id ? '처리 중' : '다시 표시'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
