import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountDto } from '@money/types';

import { homeDataPort } from '../data/home-port';

/**
 * 한 번에 받아 오는 줄 수. 홈의 거래 목록과 같다 (`useEntryFeed` 의 pageSize).
 *
 * 100 줄씩 받던 것을 줄였다. 화면은 스무 줄이면 이미 한 화면을 넘기고, 나머지는
 * 내려오는 동안 이어 붙인다 -- 첫 화면이 그만큼 빨리 뜬다.
 */
const PAGE_SIZE = 20;

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
 * **창구를 거친다.** 웹은 서버에서, 앱은 기기 사본에서 받는다. 카드 상세의 다른 칸도
 * 같은 창구를 쓰므로 한 화면의 숫자가 늘 같은 시점을 가리킨다 -- 오프라인에서도 그렇다.
 */
export function useAccountLedger(
  accountId: string | null,
  reloadToken = 0,
  /**
   * 이 구간의 줄만. 카드 상세에서 청구 주기 하나를 골랐을 때 준다.
   *
   * 줄에 붙는 잔액은 구간과 상관없이 맨 앞부터 쌓은 값이다 -- 구간만큼만 세면 그 줄의
   * 잔액이 통장의 실제 잔액과 달라진다. 자르는 것은 보여 줄 줄뿐이다.
   */
  range?: { startDate: string; endDate: string } | null,
) {
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

  // 구간은 문자열 둘이라 그대로 두면 그릴 때마다 새 객체다. 아래 효과가 끝없이 돈다.
  const rangeKey = range ? `${range.startDate}|${range.endDate}` : '';

  const load = useCallback(
    async (id: string, after: string | null, run: number) => {
      try {
        setIsLoading(true);
        setHasError(false);

        const [startDate, endDate] = rangeKey ? rangeKey.split('|') : [];
        const page = await homeDataPort().getAccountPostings(id, {
          limit: PAGE_SIZE,
          ...(after ? { cursor: after } : {}),
          ...(rangeKey ? { startDate, endDate } : {}),
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
    [rangeKey],
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
