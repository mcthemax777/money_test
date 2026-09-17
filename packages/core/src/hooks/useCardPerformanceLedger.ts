/**
 * 카드 실적 원장. 주기마다 0에서 다시 쌓는 줄들.
 *
 * 받아 오는 모양은 계좌 원장(`useAccountLedger`)과 같다 -- 같은 수만큼 끊어 받고 커서로
 * 잇는다. 다른 것은 줄에 붙는 값이다. 남은 대금 자리에 **그 주기에 지금까지 쌓인 실적**이
 * 든다.
 *
 * 누적을 화면에서 세지 않는다. 올라온 줄만으로 더하면 아직 받지 않은 앞부분이 빠진 값이
 * 나온다 -- 창구가 주기를 통째로 세어 줄마다 붙여 준다(웹은 서버가, 앱은 기기 사본이).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CardDto } from '@money/types';

import { homeDataPort } from '../data/home-port';

/** 한 번에 받아 오는 줄 수. 통장·카드 원장이 쓰는 값과 같다. */
const PAGE_SIZE = 20;

export function useCardPerformanceLedger(cardId: string | null, reloadToken = 0) {
  const [rows, setRows] = useState<CardDto.PerformanceLedgerRow[]>([]);
  /** 줄의 머리글이 되는 주기. 같은 주기가 두 쪽에 걸쳐 오므로 시작 시각으로 합친다. */
  const [periods, setPeriods] = useState<Record<string, CardDto.PerformanceLedgerPeriod>>({});
  const [meta, setMeta] = useState<{
    currency: string | null;
    target: string | null;
    basis: 'statement' | 'month' | null;
  }>({ currency: null, target: null, basis: null });
  const [cursor, setCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  /*
   * 지금 유효한 조회인지 가리는 표.
   *
   * 상세를 빠르게 옮겨 다니면 앞서 보낸 요청의 응답이 뒤늦게 돌아와 다른 카드의 줄을
   * 붙인다 (useAccountLedger 와 같은 규칙이다).
   */
  const runRef = useRef(0);

  const load = useCallback(async (id: string, after: string | null, run: number) => {
    try {
      setIsLoading(true);
      setHasError(false);

      const page = await homeDataPort().getCardPerformanceLedger(id, {
        limit: PAGE_SIZE,
        ...(after ? { cursor: after } : {}),
      });
      if (runRef.current !== run) return;

      setRows((prev) => (after ? [...prev, ...page.rows] : page.rows));
      setPeriods((prev) => {
        const next = after ? { ...prev } : {};
        for (const period of page.periods) next[period.periodStart] = period;
        return next;
      });
      setMeta({ currency: page.currency, target: page.target, basis: page.basis });
      setCursor(page.nextCursor);
    } catch {
      if (runRef.current !== run) return;
      setHasError(true);
      // 첫 쪽이 실패했으면 비운다. 다음 쪽이 실패한 것이면 받아 둔 줄은 그대로 둔다.
      if (!after) {
        setRows([]);
        setPeriods({});
        setCursor(null);
      }
    } finally {
      if (runRef.current === run) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const run = runRef.current + 1;
    runRef.current = run;

    if (!cardId) {
      setRows([]);
      setPeriods({});
      setCursor(null);
      setHasError(false);
      return;
    }

    void load(cardId, null, run);
  }, [cardId, reloadToken, load]);

  /** 다음 쪽. 더 없거나 받는 중이면 아무 일도 하지 않는다. */
  const loadMore = useCallback(() => {
    if (!cardId || !cursor || isLoading) return;
    void load(cardId, cursor, runRef.current);
  }, [cardId, cursor, isLoading, load]);

  return {
    rows,
    periods,
    currency: meta.currency,
    target: meta.target,
    basis: meta.basis,
    hasMore: cursor !== null,
    isLoading,
    hasError,
    loadMore,
  };
}
