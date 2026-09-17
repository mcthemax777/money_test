/**
 * 카드 실적 원장. 주기마다 0에서 다시 쌓는 줄들.
 *
 * 계좌 원장(`useAccountLedger`)과 나눈 까닭은 페이지를 끊는 단위가 다르기 때문이다.
 * 쌓인 실적은 주기 시작을 기준으로만 뜻이 있어, 줄 단위로 끊으면 한 주기의 앞부분을
 * 아직 받지 못한 채 합계를 그리게 된다. 그래서 **더 보기가 주기를 늘린다.**
 *
 * 누적을 기기에서 세지 않는 것도 같은 까닭이다. 화면에 올라온 줄만으로 더하면 아직
 * 받지 않은 앞부분이 빠진 값이 나온다 (서버가 주기 시작부터 세어 줄마다 붙여 준다).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CardDto } from '@money/types';

import { apiClient } from '../lib/api-client';

/** 처음에 받아 오는 주기 수. 진행 중인 주기와 그 앞 둘이다. */
const FIRST_PERIODS = 3;
/** "더 보기"가 한 번에 늘리는 주기 수 */
const MORE_PERIODS = 3;

export function useCardPerformanceLedger(cardId: string | null, reloadToken = 0) {
  const [data, setData] = useState<CardDto.PerformanceLedgerResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  /*
   * 지금 보고 있는 카드와 판, 그리고 받아 올 주기 수를 한 덩어리로 든다.
   *
   * 카드를 옮기거나 거래가 바뀌면 주기 수를 처음으로 되돌려야 하는데, 그것을 따로
   * 두면 "되돌리는 렌더"와 "다시 받는 렌더"가 갈려 조회가 두 번 나간다.
   */
  const key = `${cardId ?? ''}:${reloadToken}`;
  const [view, setView] = useState({ key, periods: FIRST_PERIODS });
  if (view.key !== key) setView({ key, periods: FIRST_PERIODS });

  /*
   * 지금 유효한 조회인지 가리는 표.
   *
   * 상세를 빠르게 옮겨 다니면 앞서 보낸 요청의 응답이 뒤늦게 돌아와 다른 카드의 줄을
   * 붙인다 (useAccountLedger 와 같은 규칙이다).
   */
  const runRef = useRef(0);

  useEffect(() => {
    const run = runRef.current + 1;
    runRef.current = run;

    if (!cardId) {
      setData(null);
      setHasError(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setHasError(false);

    apiClient
      .getCardPerformanceLedger(cardId, view.periods)
      .then((page) => {
        if (cancelled || runRef.current !== run) return;
        setData(page);
      })
      .catch(() => {
        if (cancelled || runRef.current !== run) return;
        setHasError(true);
        setData(null);
      })
      .finally(() => {
        if (cancelled || runRef.current !== run) return;
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // view.key 에 cardId 와 판이 들어 있다. cardId 를 따로 넣으면 같은 조회가 두 번 난다.
  }, [cardId, view.key, view.periods]);

  const loadMore = useCallback(() => {
    setView((prev) => ({ ...prev, periods: prev.periods + MORE_PERIODS }));
  }, []);

  return {
    periods: data?.periods ?? [],
    currency: data?.currency ?? null,
    target: data?.target ?? null,
    basis: data?.basis ?? null,
    hasMore: data?.hasMore ?? false,
    isLoading,
    hasError,
    loadMore,
  };
}
