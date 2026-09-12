import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountDto } from '@money/types';

import { apiClient } from '../lib/api-client';

/** 한 번에 받아 오는 줄 수. 통장 상세가 쓰던 값을 그대로 둔다. */
const PAGE_SIZE = 100;

/**
 * 한 계좌의 원장 줄. 줄마다 그 거래 직후의 잔액이 함께 온다.
 *
 * 통장만 쓰는 것이 아니다. **신용카드의 사용과 대금 결제는 그 카드의 부채 계정에
 * 쌓이므로**, 카드 상세도 그 계정 id 를 넘겨 같은 줄을 받는다 -- 카드에서 보면 쓸
 * 때마다 늘고 결제하면 줄어드는 "남은 대금"이 곧 그 잔액이다. 두 화면이 같은 값을
 * 같은 규칙으로 보여 주려면 받아 오는 자리도 하나여야 한다.
 *
 * 부호는 계정 관점 그대로 둔다. 부채 계정은 빚이 늘면 음수라 카드 상세가 뒤집어
 * 읽는다. 여기서 뒤집으면 통장과 규칙이 갈려 어느 쪽이 기준인지 알 수 없게 된다.
 *
 * 서버에서만 받는다. 카드 상세의 다른 칸(실적·주기별 사용액)도 그러하므로 오프라인
 * 에서는 함께 비어 있게 둔다 -- 여기만 사본에서 읽으면 같은 화면의 숫자가 서로 다른
 * 시점을 가리킨다.
 */
export function useAccountLedger(accountId: string | null, reloadToken = 0) {
  const [rows, setRows] = useState<AccountDto.LedgerRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  /*
   * 지금 유효한 조회인지 가리는 표.
   *
   * 상세를 빠르게 옮겨 다니면 앞서 보낸 요청의 응답이 뒤늦게 돌아와 다른 계좌의 줄을
   * 붙인다. 조회를 시작할 때 표를 올리고, 응답을 받을 때 같은 표인지 본다.
   */
  const runRef = useRef(0);

  const load = useCallback(
    async (id: string, after: string | null, run: number) => {
      try {
        setIsLoading(true);
        setHasError(false);

        const page = await apiClient.getAccountPostings(id, {
          limit: PAGE_SIZE,
          ...(after ? { cursor: after } : {}),
        });
        if (runRef.current !== run) return;

        setRows((prev) => (after ? [...prev, ...(page?.data ?? [])] : page?.data ?? []));
        setCursor(page?.nextCursor ?? null);
      } catch {
        if (runRef.current !== run) return;
        setHasError(true);
        // 첫 쪽이 실패했으면 비운다. 다음 쪽이 실패한 것이면 받아 둔 줄은 그대로 둔다.
        if (!after) {
          setRows([]);
          setCursor(null);
        }
      } finally {
        if (runRef.current === run) setIsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const run = runRef.current + 1;
    runRef.current = run;

    if (!accountId) {
      setRows([]);
      setCursor(null);
      setHasError(false);
      return;
    }

    void load(accountId, null, run);
  }, [accountId, reloadToken, load]);

  /** 다음 쪽. 더 없거나 받는 중이면 아무 일도 하지 않는다. */
  const loadMore = useCallback(() => {
    if (!accountId || !cursor || isLoading) return;
    void load(accountId, cursor, runRef.current);
  }, [accountId, cursor, isLoading, load]);

  return { rows, hasMore: cursor !== null, isLoading, hasError, loadMore };
}
