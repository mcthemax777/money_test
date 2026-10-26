/*
 * 자산 화면 계좌 상세의 원장. 첫 쪽을 받고, 다음 쪽을 이어 붙이고, 계좌를 바꾸면 새로 받는다.
 *
 * 웹 전용이고 서버에서 100줄씩 받는다. core 의 `useAccountLedger` 는 기기 사본도 읽는 카드 상세용이라
 * 받는 창구와 쪽 크기가 달라 따로 둔다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@money/core/lib/api-client';
import type { Account } from '@money/core/lib/types';
import type { AccountDto } from '@money/types';

/**
 * 계좌 원장 조회.
 *
 * 예전에는 거래 목록에서 accountId/toAccountId를 조합하고 credit_usage를 빼야 했다.
 * 원장 구조에서는 이 계좌의 posting만 시간순으로 오고 잔액 추이까지 함께 온다.
 */
const LEDGER_PAGE_SIZE = 100;

/**
 * @param account 펼쳐 둔 계좌. 계좌 상세가 아니면 null 이다 (목록을 비운다).
 * @param reloadKeys 바뀌면 첫 쪽을 다시 받는 값들 (거래를 고친 횟수, 다른 기기의 변경).
 */
export function useAssetPageLedger(account: Account | null, reloadKeys: { entryVersion: number; mirrorVersion: unknown }) {
  const [accountTransactions, setAccountTransactions] = useState<AccountDto.LedgerRow[]>([]);
  /** 원장의 다음 페이지 커서. null이면 끝까지 봤다는 뜻이다. */
  const [ledgerCursor, setLedgerCursor] = useState<string | null>(null);
  const [isLoadingLedger, setIsLoadingLedger] = useState(false);

  /**
   * 원장 받기의 번호. 첫 쪽을 새로 받을 때마다 오른다. 계좌를 빨리 바꾸면 앞 계좌의 답이 늦게 와
   * 뒤 계좌 아래에 서거나, 나가 있던 다음 쪽이 새 목록 뒤에 붙었다 (2026-10-16). 번호가 바뀐 답은 버린다.
   */
  const ledgerRequest = useRef(0);

  const loadAccountTransactions = useCallback(async (accountId: string) => {
    const requestId = ++ledgerRequest.current;
    try {
      setIsLoadingLedger(true);
      const response = await apiClient.getAccountPostings(accountId, { limit: LEDGER_PAGE_SIZE });
      if (requestId !== ledgerRequest.current) return;
      setAccountTransactions(response?.data ?? []);
      setLedgerCursor(response?.nextCursor ?? null);
    } catch (err) {
      console.error('거래 내역 조회 실패:', err);
      if (requestId !== ledgerRequest.current) return;
      setAccountTransactions([]);
      setLedgerCursor(null);
    } finally {
      if (requestId === ledgerRequest.current) setIsLoadingLedger(false);
    }
  }, []);

  /**
   * 원장 다음 페이지.
   *
   * 예전에는 100건만 받고 커서를 버려서, 그보다 오래된 거래를 볼 방법이 없었다.
   * 서버는 페이지마다 그 구간의 잔액 추이를 맞춰서 준다.
   */
  const loadMoreAccountTransactions = useCallback(async () => {
    if (!account || !ledgerCursor) return;
    // 이 다음 쪽은 지금 목록의 것이다. 그 사이 첫 쪽을 새로 받았으면(계좌를 바꿈·동기화) 버린다.
    const requestId = ledgerRequest.current;
    try {
      setIsLoadingLedger(true);
      const response = await apiClient.getAccountPostings(account.id, {
        limit: LEDGER_PAGE_SIZE,
        cursor: ledgerCursor,
      });
      if (requestId !== ledgerRequest.current) return;
      setAccountTransactions((prev) => [...prev, ...(response?.data ?? [])]);
      setLedgerCursor(response?.nextCursor ?? null);
    } catch (err) {
      console.error('거래 내역 조회 실패:', err);
    } finally {
      if (requestId === ledgerRequest.current) setIsLoadingLedger(false);
    }
  }, [account, ledgerCursor]);

  const { entryVersion, mirrorVersion } = reloadKeys;
  // 계좌 선택 시 거래 내역 로드
  useEffect(() => {
    if (account) {
      loadAccountTransactions(account.id);
    } else {
      setAccountTransactions([]);
      setLedgerCursor(null);
    }
  }, [account, loadAccountTransactions, entryVersion, mirrorVersion]);

  return {
    rows: accountTransactions,
    hasMore: Boolean(ledgerCursor),
    isLoading: isLoadingLedger,
    loadMore: loadMoreAccountTransactions,
  };
}
