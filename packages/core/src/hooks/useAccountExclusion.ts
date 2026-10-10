import { useCallback, useMemo } from 'react';
import { EQUITY_ACCOUNT_TYPES, assetGroupOf, type AssetGroupKey, type ReportDto } from '@money/types';

import { toNumber } from '../lib/money';
import { excludedLedgerAccountIds, withoutAccounts } from '../lib/net-worth';
import type { Account, Card } from '../lib/types';
import { useAssetExclusion } from '../store/asset-exclusion';

/** 묶음 안의 계좌가 합계에 든 정도. 유형 칸의 표시가 이것을 그린다. */
export type GroupSelection = 'all' | 'some' | 'none';

const NO_IDS: readonly string[] = [];

/** 화면이 받는 합계 제외 창구. 유형 칸과 목록이 이것만 본다. */
export type AccountExclusion = ReturnType<typeof useAccountExclusion>;

/**
 * 자산 탭의 합계 제외 (2026-10-10 사용자 요청).
 *
 * 유형 칸을 누르면 그 묶음의 계좌 목록이 열리고, 거기서 뺀 계좌는 맨 위 총액·전체 추이·
 * 사용자별/자산유형별 소계에서 빠진다. 목록에는 그대로 서고 "합계 제외"가 붙는다.
 *
 * 웹과 앱이 같은 규칙으로 덜어 내도록 여기 한 곳에 둔다. 덜어 내는 셈은 lib/net-worth 의
 * `withoutAccounts`, 카드 대금까지 함께 빼는 규칙은 `excludedLedgerAccountIds` 다.
 */
export function useAccountExclusion({
  projectId,
  accounts,
  cards,
  netWorth,
}: {
  projectId: string | null;
  accounts: readonly Account[];
  cards: readonly Card[];
  /** 서버(사본)가 준 그대로의 총자산 */
  netWorth: ReportDto.NetWorth | null;
}) {
  const stored = useAssetExclusion((state) =>
    projectId ? state.excludedByProject[projectId] ?? NO_IDS : NO_IDS,
  );
  const setIncludedInStore = useAssetExclusion((state) => state.setIncluded);

  /*
   * 지금 있는 계좌만 남긴다. 지워졌거나 숨긴 계좌의 id 가 남아 있어도 표시와 셈에
   * 끼지 않는다 -- 숨긴 계좌는 애초에 총자산에 들지 않는다.
   */
  const excludedIds = useMemo(() => {
    const live = new Set(accounts.map((account) => account.id));
    return new Set(stored.filter((id) => live.has(id)));
  }, [stored, accounts]);

  /** 실제로 덜어 낼 계정. 뺀 통장에 딸린 카드의 대금 계정이 함께 든다. */
  const ledgerIds = useMemo(
    () => excludedLedgerAccountIds([...excludedIds], cards),
    [excludedIds, cards],
  );

  const adjustedNetWorth = useMemo(
    () => withoutAccounts(netWorth, ledgerIds),
    [netWorth, ledgerIds],
  );

  /**
   * 추이 그래프에 실을 제외 목록. 차례를 굳혀 두어 같은 고르기면 같은 조회가 된다.
   * 하나도 없으면 undefined 라 조회에 키가 실리지 않는다.
   */
  const excludeKey = useMemo(
    () => (ledgerIds.size === 0 ? undefined : [...ledgerIds].sort()),
    [ledgerIds],
  );

  const isExcluded = useCallback((accountId: string) => excludedIds.has(accountId), [excludedIds]);

  /**
   * 카드가 합계에서 빠졌는지. 결제 통장을 빼면 그 카드 대금도 빠진다 (목록에 표시가 선다).
   */
  const isCardExcluded = useCallback(
    (card: Pick<Card, 'paymentAccountId'>) => excludedIds.has(card.paymentAccountId),
    [excludedIds],
  );

  /** 그 계좌들이 합계에 든 정도. 비어 있으면 뺄 것이 없으니 'all' 이다. */
  const selectionOf = useCallback(
    (accountIds: readonly string[]): GroupSelection => {
      const out = accountIds.filter((id) => excludedIds.has(id)).length;
      if (out === 0) return 'all';
      return out === accountIds.length ? 'none' : 'some';
    },
    [excludedIds],
  );

  /**
   * 그 계좌가 총액에 더하는 값 (표시 통화). 딸린 카드의 대금까지 더한 값이라, 빼면 총액이
   * 꼭 이만큼 줄어든다. 목록 줄의 "남은 금액"과 같은 뜻이고 시가·환율이 들어 있다.
   */
  const countedAmountOf = useMemo(() => {
    const amountOf = new Map(
      (netWorth?.byAccount ?? []).map((part) => [part.accountId, toNumber(part.amount)]),
    );
    const sums = new Map<string, number>();
    for (const account of accounts) sums.set(account.id, amountOf.get(account.id) ?? 0);
    for (const card of cards) {
      if (!card.liabilityAccountId || !sums.has(card.paymentAccountId)) continue;
      sums.set(
        card.paymentAccountId,
        (sums.get(card.paymentAccountId) ?? 0) + (amountOf.get(card.liabilityAccountId) ?? 0),
      );
    }
    return (accountId: string) => sums.get(accountId) ?? 0;
  }, [netWorth, accounts, cards]);

  const setIncluded = useCallback(
    (accountIds: readonly string[], included: boolean) => {
      if (projectId) setIncludedInStore(projectId, accountIds, included);
    },
    [projectId, setIncludedInStore],
  );

  return {
    /** 합계 제외를 덜어 낸 총자산. 사람별 소계(byPerson)도 덜어 낸 값이다. */
    netWorth: adjustedNetWorth,
    excludedIds,
    excludeKey,
    isExcluded,
    isCardExcluded,
    selectionOf,
    countedAmountOf,
    setIncluded,
  };
}

/**
 * 유형 칸의 목록에 설 계좌. 고른 자산주인의 것만, 그 묶음의 것만 담는다.
 *
 * 차례는 자산유형별 목록과 같다 -- 사람 차례 → 그 사람 안의 차례 (`groupAccountsOfPeople`).
 * 전원을 고른 때는 주인 없는 계좌도 맨 뒤에 넣는다. 그 계좌도 총액에 들어 있어 뺄 수
 * 있어야 한다. 카드 대금·자본 계정은 계좌 목록에 서지 않으므로 거른다 (카드는 결제 통장을
 * 따른다).
 */
export function accountsOfGroup(
  accounts: readonly Account[],
  group: AssetGroupKey,
  people: readonly { id: string }[],
  includeOwnerless: boolean,
): Account[] {
  const inGroup = accounts.filter(
    (account) =>
      account.isActive !== false &&
      account.type !== 'credit_card' &&
      !EQUITY_ACCOUNT_TYPES.includes(account.type) &&
      assetGroupOf(account.type) === group,
  );
  return [
    ...people.flatMap((person) => inGroup.filter((account) => account.ownerId === person.id)),
    ...(includeOwnerless ? inGroup.filter((account) => account.ownerId === null) : []),
  ];
}
