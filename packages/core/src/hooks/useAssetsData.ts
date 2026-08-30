import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReportDto } from '@money/types';

import { apiClient } from '../lib/api-client';
import { sumNetWorth } from '../lib/net-worth';
import type { Account, Card, Person } from '../lib/types';
import { useProject } from '../store/project';
import { useUserFilter } from '../store/user-filter';
import { usePersonFilterSync } from './usePersonFilterSync';

/**
 * 자산 화면이 보는 값 전부.
 *
 * 구성원과 그들의 계좌·카드, 총자산, 계좌별 누적 수익이다. 총자산과 수익은 같은
 * 거래에서 나오는 값이라 한 번에 받는다.
 */
export function useAssetsData(projectId: string | null) {
  const { selectedPersonIds } = useUserFilter();
  const myPersonId = useProject((state) => {
    const selected = state.projects.find((project) => project.id === state.selectedProjectId);
    return selected?.myPersonId ?? null;
  });

  const [people, setPeople] = useState<Person[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [netWorth, setNetWorth] = useState<ReportDto.NetWorth | null>(null);
  /** 투자·저축 계좌별 누적 수익. 계좌 id -> 금액 */
  const [accountProfit, setAccountProfit] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const reload = useCallback(async () => {
    if (!projectId) return;

    try {
      setIsLoading(true);
      setHasError(false);

      const [peopleData, accountsData, cardsData, netWorthData, profitData] = await Promise.all([
        apiClient.getPeople(projectId),
        apiClient.getAccountsV2(projectId),
        apiClient.getCards(projectId),
        apiClient.getNetWorth(projectId),
        apiClient.getAccountProfit(projectId),
      ]);

      setPeople(peopleData || []);
      setAccounts(accountsData || []);
      setCards(cardsData || []);
      setNetWorth(netWorthData ?? null);
      setAccountProfit(new Map((profitData ?? []).map((row) => [row.accountId, row.profit])));
    } catch (error) {
      console.error('자산 조회 실패:', error);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    reload();
  }, [reload]);

  usePersonFilterSync(projectId, people);

  const allPeopleSelected = people.length > 0 && selectedPersonIds.length === people.length;

  /**
   * 고른 자산주인의 총자산.
   *
   * 전원을 고른 때만 서버의 전체 값을 그대로 쓴다. 주인이 없는 계좌는 사람별 소계에
   * 들어가지 않아, 전체를 보면서 소계를 더하면 그만큼 빠진다.
   */
  const scopedNetWorth = useMemo(() => {
    if (allPeopleSelected) return netWorth;

    const byPerson = new Map((netWorth?.byPerson ?? []).map((row) => [row.personId, row]));
    return sumNetWorth(selectedPersonIds.map((id) => byPerson.get(id)));
  }, [allPeopleSelected, netWorth, selectedPersonIds]);

  return {
    people,
    /** 화면에 그릴 구성원. 고른 사람만 남긴다. */
    visiblePeople: people.filter((person) => selectedPersonIds.includes(person.id)),
    accounts,
    cards,
    myPersonId,
    selectedPersonIds,
    allPeopleSelected,

    netWorth: scopedNetWorth,
    netWorthByPerson: new Map((netWorth?.byPerson ?? []).map((row) => [row.personId, row])),
    accountProfit,
    /** 그 계좌에 딸린 카드. 숨긴 카드는 서버가 이미 빼고 준다. */
    cardsOf: useCallback(
      (accountId: string) => cards.filter((card) => card.paymentAccountId === accountId),
      [cards],
    ),

    isLoading,
    hasError,
    reload,
  };
}
