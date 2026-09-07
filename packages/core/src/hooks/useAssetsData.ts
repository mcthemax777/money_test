import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  rankForMove, rankForStep,
  type AccountDto,
  type CardDto,
  type PersonDto,
  type ReportDto,
} from '@money/types';

import { apiClient } from '../lib/api-client';
import {
  settingsWritePort,
  type AccountPatch,
  type CardPatch,
  type PersonPatch,
} from '../data/settings-write-port';
import { homeDataPort } from '../data/home-port';
import { isOfflineError } from '../lib/offline-error';
import { useMirrorVersion } from './useMirrorVersion';
import { apiErrorCode, useApiError } from '../lib/api-error';
import type { MessageKey } from '../lib/i18n';
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

  /**
   * 사본이 채워질 때마다 올라간다.
   *
   * 동기화가 뒤에서 사본을 채우므로, 이 값을 의존성에 두지 않으면 처음 열었을 때 빈
   * 사본을 읽은 화면이 그대로 멈춘다. 웹에서는 0에 머문다 (useHomeData 와 같다).
   */
  const mirrorVersion = useMirrorVersion();

  const reload = useCallback(async () => {
    if (!projectId) return;

    try {
      setIsLoading(true);
      setHasError(false);

      /*
       * 읽기도 창구를 거친다. 앱에서는 사본이 답하므로 오프라인에서도 자산 화면이 그려진다.
       *
       * 계좌별 누적 수익만 서버에서 온다. 누적합이라 사본에 옮기지 않았고(설계 문서의
       * 이식 목록), 없으면 그 줄만 비운다 -- 나머지를 못 그릴 이유가 없다.
       */
      const port = homeDataPort();
      const [peopleData, accountsData, cardsData, netWorthData, profitData] = await Promise.all([
        port.getPeople(projectId),
        port.getAccountsV2(projectId),
        port.getCards(projectId),
        port.getNetWorth(projectId),
        apiClient.getAccountProfit(projectId).catch((error) => {
          if (isOfflineError(error)) return [];
          throw error;
        }),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, mirrorVersion]);

  useEffect(() => {
    reload();
  }, [reload]);

  usePersonFilterSync(projectId, people);

  /**
   * 만드는 중. 버튼을 잠그는 데 쓴다.
   *
   * 셋(구성원·계좌·카드)이 한 값을 나눠 쓴다. 한 번에 한 창만 열리는 화면이라
   * 따로 둘 이유가 없다.
   */
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { messageOf } = useApiError();

  /**
   * 만들고 나서 목록을 다시 읽는다.
   *
   * 화면이 직접 apiClient 를 부르지 않게 여기 둔다. 만들자마자 총자산과 소계가 함께
   * 바뀌므로(계좌 하나가 여러 숫자를 움직인다) 부분 갱신 대신 통째로 다시 받는다.
   *
   * 실패를 던지지 않고 돌려준다. 폼은 창을 닫지 않고 그 자리에 이유를 적어야 한다.
   */
  const submit = useCallback(
    async (run: () => Promise<unknown>, fallbackKey: MessageKey): Promise<AssetSaveResult> => {
      try {
        setIsSubmitting(true);
        await run();
        await reload();
        return { ok: true };
      } catch (error) {
        // 코드도 함께 준다. 화면이 "삭제는 안 되지만 숨기기는 된다"를 가려야 한다.
        return { ok: false, message: messageOf(error, fallbackKey), code: apiErrorCode(error) };
      } finally {
        setIsSubmitting(false);
      }
    },
    [reload, messageOf],
  );

  /*
   * 만들기는 창구를 거친다 (`data/settings-write-port`).
   *
   * 웹은 서버로 곧바로 가고, 앱은 사본에 먼저 커밋한 뒤 명령을 아웃박스에 쌓는다. 화면은
   * 어느 쪽인지 모른다 -- 거래 입력과 같은 규칙이다 (설계 문서의 D3).
   */
  const addPerson = useCallback(
    (input: PersonDto.CreateRequest) =>
      submit(async () => {
        const created = await settingsWritePort().addPerson({
          ...input,
          ...(projectId ? { projectId } : {}),
        });

        /*
         * 방금 만든 구성원은 고른 것으로 둔다.
         *
         * 자산주인 거르개를 한 번이라도 건드린 사용자에게는 새 구성원이 자동으로 켜지지
         * 않는다(`usePersonFilterSync` 는 사라진 사람만 걷어낸다). 그러면 방금 만든
         * 사람이 목록에 나타나지 않아 "추가가 안 됐다"로 보인다.
         */
        const filter = useUserFilter.getState();
        if (!filter.selectedPersonIds.includes(created.id)) {
          filter.setSelectedPersonIds([...filter.selectedPersonIds, created.id]);
        }
        return created;
      }, 'person.addFailed'),
    [submit, projectId],
  );

  const addAccount = useCallback(
    (input: Omit<AccountDto.CreateRequest, 'projectId'>) =>
      submit(
        () => settingsWritePort().addAccount({ ...input, ...(projectId ? { projectId } : {}) }),
        'account.addFailed',
      ),
    [submit, projectId],
  );

  const addCard = useCallback(
    (input: Omit<CardDto.CreateRequest, 'projectId'>) =>
      submit(
        () => settingsWritePort().addCard({ ...input, ...(projectId ? { projectId } : {}) }),
        'card.addFailed',
      ),
    [submit, projectId],
  );

  /**
   * 고치기. 만들기와 같은 창구를 쓴다.
   *
   * 담긴 필드만 바뀐다 (필드별 병합). 그래서 이름만 고칠 때 색이나 순서를 함께 보내지
   * 않는다 -- 보내면 그 필드의 시계까지 올라가 남의 편집을 이유 없이 덮는다.
   */
  const updatePerson = useCallback(
    (id: string, patch: PersonPatch) =>
      submit(() => settingsWritePort().updatePerson(id, patch), 'person.addFailed'),
    [submit],
  );

  const updateAccount = useCallback(
    (id: string, patch: AccountPatch) =>
      submit(() => settingsWritePort().updateAccount(id, patch), 'account.addFailed'),
    [submit],
  );

  /**
   * 구성원·통장·카드 삭제. 거래내역이 있으면 서버가 거절하고, 그때는 화면이 숨기기를 묻는다.
   *
   * 숨기기는 `updateAccount(id, { isActive: false })` 쪽이다. 갈라 두는 이유는
   * settings-write-port 에 적어 두었다 -- 삭제만 연결이 필요하다.
   */
  const removePerson = useCallback(
    (id: string): Promise<AssetSaveResult> =>
      submit(() => settingsWritePort().removePerson(id), 'assets.removeFailed'),
    [submit],
  );
  const removeAccount = useCallback(
    (id: string): Promise<AssetSaveResult> =>
      submit(() => settingsWritePort().removeAccount(id), 'assets.removeFailed'),
    [submit],
  );
  const removeCard = useCallback(
    (id: string): Promise<AssetSaveResult> =>
      submit(() => settingsWritePort().removeCard(id), 'assets.removeFailed'),
    [submit],
  );

  const updateCard = useCallback(
    (id: string, patch: CardPatch) =>
      submit(() => settingsWritePort().updateCard(id, patch), 'card.addFailed'),
    [submit],
  );

  /**
   * 목록에서 한 칸 옮긴다.
   *
   * 옮긴 자리의 값 하나만 보낸다 (분수 색인). 목록 전체를 다시 쓰면 그 사이 남이 옮긴
   * 것이 통째로 지워진다 (설계 문서의 D5).
   *
   * 통장은 주인별로, 카드는 결제 통장별로 목록이 나뉜다. 그 묶음 안에서만 자리가 뜻을
   * 가지므로 이웃도 그 안에서 고른다.
   */
  const moveWithin = useCallback(
    <T extends { id: string; sortRank?: string | null }>(
      rows: readonly T[],
      id: string,
      /** 한 칸 옮기기(step)이거나, 끌어다 놓은 자리(index)다. */
      to: { step: 1 | -1 } | { index: number },
      apply: (id: string, patch: { sortRank: string }) => Promise<AssetSaveResult>,
    ): Promise<AssetSaveResult> => {
      const rank =
        'step' in to ? rankForStep(rows, id, to.step) : rankForMove(rows, id, to.index);
      if (!rank) return Promise.resolve({ ok: true });

      return apply(id, { sortRank: rank });
    },
    [],
  );

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

    /* 만들기·고치기. 성공하면 목록을 다시 읽는다. */
    isSubmitting,
    addPerson,
    addAccount,
    addCard,
    updatePerson,
    updateAccount,
    updateCard,
    removePerson,
    removeAccount,
    removeCard,

    /** 한 칸 위로(-1) 또는 아래로(+1). 같은 묶음 안에서만 움직인다. */
    movePerson: (id: string, step: 1 | -1) => moveWithin(people, id, { step }, updatePerson),
    moveAccount: (id: string, ownerId: string | null, step: 1 | -1) =>
      moveWithin(
        accounts.filter((account) => account.ownerId === ownerId),
        id,
        { step },
        updateAccount,
      ),
    /*
     * 끌어다 놓은 자리로. `index` 는 그 묶음 안에서 놓은 뒤의 자리다.
     *
     * 옮긴 줄의 값 하나만 보내는 것은 한 칸 옮기기와 같다 -- 목록 전체를 다시 쓰면 그
     * 사이 남이 옮긴 것이 통째로 지워진다 (D5).
     */
    movePersonTo: (id: string, index: number) => moveWithin(people, id, { index }, updatePerson),
    moveAccountTo: (id: string, ownerId: string | null, index: number) =>
      moveWithin(
        accounts.filter((account) => account.ownerId === ownerId),
        id,
        { index },
        updateAccount,
      ),
    moveCardTo: (id: string, paymentAccountId: string, index: number) =>
      moveWithin(
        cards.filter((card) => card.paymentAccountId === paymentAccountId),
        id,
        { index },
        updateCard,
      ),
    moveCard: (id: string, paymentAccountId: string, step: 1 | -1) =>
      moveWithin(
        cards.filter((card) => card.paymentAccountId === paymentAccountId),
        id,
        { step },
        updateCard,
      ),
  };
}

/** 만들기의 결과. 실패는 던지지 않고 폼이 적을 문구로 돌려준다. */
export interface AssetSaveResult {
  ok: boolean;
  message?: string;
  /** 서버가 붙인 오류 코드. 문구를 뒤지지 않고 이것으로 가른다. */
  code?: string;
}
