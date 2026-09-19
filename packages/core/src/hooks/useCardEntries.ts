/**
 * 체크카드의 결제 내역.
 *
 * 신용카드는 그 카드의 **부채 계정**에 사용과 대금이 쌓이므로 원장을 그대로 읽으면
 * 되지만(useAccountLedger), 체크카드는 쓰는 즉시 결제 통장에서 빠져 카드 쪽에 쌓이는
 * 계정이 없다 -- 통장 원장에서는 다른 수단으로 쓴 것과 뒤섞여 있어 그 카드의 결제만
 * 골라낼 수 없다. 그래서 전표를 카드로 걸러 받고, 원장과 같은 모양의 줄로 옮긴다.
 *
 * 옮기는 일을 여기서 하는 것이 요점이다. 화면은 신용카드든 체크카드든 같은 줄을
 * 그리면 되고, 두 카드의 결제 내역이 서로 다르게 보이는 일이 없다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { homeDataPort } from '../data/home-port';
import { dayRangeQuery } from '../lib/datetime';
import { useProjectTimeZone } from '../store/project';
import type { EntryListItem, LedgerLikeRow } from '../lib/types';

/** 한 번에 받아 오는 줄 수. 통장·신용카드 원장이 쓰는 값과 같다. */
const PAGE_SIZE = 20;

/**
 * 전표 한 줄을 카드 관점의 원장 줄로 옮긴다.
 *
 * **부호는 신용카드의 부채 계정과 같은 규칙이다** -- 쓰면 음수, 되돌려 받으면 양수다.
 * 그래야 화면이 두 카드를 가르지 않고 한 가지로 그린다 (쓴 돈이 빨강, 환불이 초록).
 *
 * 잔액은 비운다. 체크카드에는 쌓이는 것이 없어 "이 거래 직후의 남은 대금"이 없다.
 */
function toLedgerRow(entry: EntryListItem): LedgerLikeRow {
  // 돈이 돌아온 쪽은 양수다. 카드 부채 계정의 부호 규칙과 같다.
  const signed = entry.kind === 'income' ? entry.amount : `-${entry.amount}`;

  return {
    // 한 전표에 그 카드의 다리는 하나뿐이라 전표 id 로 줄을 가른다.
    postingId: entry.id,
    entryId: entry.id,
    date: entry.date,
    description: entry.description,
    merchant: entry.merchant,
    amount: signed,
    balanceAfter: null,
    cardId: entry.cardId,
    cardName: entry.cardName,
    categoryName: entry.categoryName,
    parentCategoryName: entry.parentCategoryName,
    countsPerformance: entry.countsPerformance,
  };
}

export function useCardEntries(
  cardId: string | null,
  projectId?: string | null,
  reloadToken = 0,
  /**
   * 이 구간의 줄만. 카드 상세에서 주기 하나를 골랐을 때 준다.
   *
   * **달력 날짜다** (양끝 포함). 카드 청구 주기가 주는 UTC 자정 표시자
   * ("2026-07-01T00:00:00.000Z")도 그대로 받는다 -- 읽는 일은 `dayRangeQuery` 가 안다.
   *
   * 목록 창구는 인스턴트를 받으므로 여기서 바꿔 보낸다. 그냥 넘기면 UTC 자정으로 읽혀
   * 한국 기준으로 시작일은 오전 아홉 시부터가 되고 종료일은 오전 아홉 시에 잘린다 --
   * 7월 주기를 골랐을 때 7월 31일 오후의 결제가 목록에서 사라지던 자리다.
   */
  range?: { startDate: string; endDate: string } | null,
) {
  const [rows, setRows] = useState<LedgerLikeRow[]>([]);
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

  // 구간은 문자열 둘이라 그대로 두면 그릴 때마다 새 객체다. 아래 효과가 끝없이 돈다.
  const timeZone = useProjectTimeZone();
  const rangeKey = range
    ? (() => {
        const query = dayRangeQuery(range.startDate, range.endDate, timeZone);
        return `${query.startDate}|${query.endDate}`;
      })()
    : '';

  const load = useCallback(
    async (id: string, after: string | null, run: number) => {
      try {
        setIsLoading(true);
        setHasError(false);

        const [startDate, endDate] = rangeKey ? rangeKey.split('|') : [];
        const page = await homeDataPort().getEntries(
          {
            cardId: id,
            limit: PAGE_SIZE,
            ...(after ? { cursor: after } : {}),
            ...(rangeKey ? { startDate, endDate } : {}),
          },
          projectId,
        );
        if (runRef.current !== run) return;

        const next = (page?.data ?? []).map(toLedgerRow);
        setRows((prev) => (after ? [...prev, ...next] : next));
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
    [projectId, rangeKey],
  );

  useEffect(() => {
    const run = runRef.current + 1;
    runRef.current = run;

    if (!cardId) {
      setRows([]);
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

  return { rows, hasMore: cursor !== null, isLoading, hasError, loadMore };
}
