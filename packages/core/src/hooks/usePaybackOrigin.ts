/**
 * 페이백이 가리키는 원거래 (PAYBACK_DESIGN.md 7단계 보강).
 *
 * 페이백 상세가 "무엇의 페이백인가"를 그린다 -- 원거래의 설명·날짜·금액·줄의 분류. 웹은
 * 서버에서, 앱은 사본에서 읽는다(`getEntry`). 원거래가 지워졌거나(링크가 비었다) 읽지
 * 못했으면 null 이다.
 */
import { useEffect, useState } from 'react';
import type { EntryLine, EntryListItem } from '@money/types';
import { homeDataPort } from '../data/home-port';
import { useLoadedKey } from './useLoadedKey';
import { useMirrorVersion } from './useMirrorVersion';

export interface PaybackOrigin {
  original: EntryListItem | null;
  /** 페이백을 받은 그 줄. 분할이 아니면 하나뿐인 줄이다. 원거래를 고치다 줄이 사라졌으면 null. */
  line: EntryLine | null;
  isLoading: boolean;
  /** 읽지 못했다. "지워진 원거래"와 가른다. */
  failed: boolean;
}

export function usePaybackOrigin(
  payback: EntryListItem | null,
  projectId: string | null | undefined,
): PaybackOrigin {
  const [original, setOriginal] = useState<EntryListItem | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const mirrorVersion = useMirrorVersion();
  const loaded = useLoadedKey();

  const originId = payback?.kind === 'payback' ? payback.paybackOfEntryId : null;

  useEffect(() => {
    setFailed(false);
    if (!originId) {
      loaded.mark(null);
      setOriginal(null);
      return;
    }
    let cancelled = false;
    // 같은 원거래를 다시 받을 때는 가리지 않는다 (useLoadedKey 주석).
    const queryKey = `${originId}|${projectId ?? ''}`;
    const isRefresh = loaded.has(queryKey);
    if (!isRefresh) setIsLoading(true);
    homeDataPort()
      .getEntry(originId, projectId)
      .then((row) => {
        if (cancelled) return;
        setOriginal(row);
        loaded.mark(queryKey);
      })
      .catch((error) => {
        console.error('원거래를 불러오지 못했습니다:', error);
        // 다시 받다 실패했다면 그려 둔 원거래는 여전히 이 페이백의 것이다.
        if (cancelled || isRefresh) return;
        setOriginal(null);
        setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [originId, projectId, mirrorVersion, loaded]);

  const line = original?.lines.find((row) => row.lineKey === payback?.paybackOfLineKey) ?? null;
  return { original, line, isLoading, failed };
}
