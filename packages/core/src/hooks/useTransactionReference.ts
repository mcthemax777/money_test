/**
 * 거래 화면의 기준 목록 -- 검색이 고를 것과 제목의 이름.
 *
 * 구성원·분류·통장·카드·태그를 가계부마다 한 번 받는다. 검색 조건이 바뀔 때마다 다시 받지
 * 않는다. 고를 수 있는 분류와 자산은 검색 결과와 무관하고, 결과에 따라 목록이 줄어들면 방금
 * 켠 조건을 되돌릴 수 없게 된다. `useTransactions` 에서 떼어 냈다 (2026-10-26).
 */
import { useEffect, useRef, useState } from 'react';
import type { AccountDto, CardDto, CategoryDto, PersonDto, TagDto } from '@money/types';
import { HIDDEN_ACCOUNT_TYPES } from '@money/types';

import { homeDataPort } from '../data/home-port';
import { readScreenCache, writeScreenCache } from '../lib/screen-cache';

const REFERENCE_SLOT = 'transactions.reference';

/** 화면이 다시 설 때 쓸 기준 목록 (lib/screen-cache). 열쇠는 가계부다. */
interface TxReference {
  people: PersonDto.Response[];
  categories: CategoryDto.Response[];
  accounts: AccountDto.Response[];
  cards: CardDto.Response[];
  tags: TagDto.Response[];
}

export function useTransactionReference(
  projectId: string | null,
  /** 동기화가 사본을 채우면 올라간다. 바뀌면 다시 받는다. */
  mirrorVersion: number,
  fail: (error: unknown) => void,
) {
  /** 화면이 다시 설 때 그릴 기준 목록. 같은 가계부로 받아 둔 것이 있으면 곧바로 쓴다 (lib/screen-cache). */
  const [cachedReference] = useState(() =>
    projectId ? readScreenCache<TxReference>(REFERENCE_SLOT, projectId) : undefined,
  );
  const [people, setPeople] = useState<PersonDto.Response[]>(cachedReference?.people ?? []);
  /*
   * 검색이 고를 목록. 프로젝트가 바뀔 때 한 번만 받는다.
   *
   * 검색 조건이 바뀔 때마다 다시 받지 않는다. 고를 수 있는 분류와 자산은 검색 결과와
   * 무관하고, 결과에 따라 목록이 줄어들면 방금 켠 조건을 되돌릴 수 없게 된다.
   */
  const [pickerCategories, setPickerCategories] = useState<CategoryDto.Response[]>(
    cachedReference?.categories ?? [],
  );
  const [pickerAccounts, setPickerAccounts] = useState<AccountDto.Response[]>(
    cachedReference?.accounts ?? [],
  );
  const [pickerCards, setPickerCards] = useState<CardDto.Response[]>(cachedReference?.cards ?? []);
  const [pickerTags, setPickerTags] = useState<TagDto.Response[]>(cachedReference?.tags ?? []);

  /** 지금 들고 있는 기준 목록이 어느 가계부의 것인가. */
  const referenceProjectRef = useRef(projectId);
  useEffect(() => {
    const applyReference = (reference: TxReference | undefined) => {
      setPeople(reference?.people ?? []);
      setPickerCategories(reference?.categories ?? []);
      setPickerAccounts(reference?.accounts ?? []);
      setPickerCards(reference?.cards ?? []);
      setPickerTags(reference?.tags ?? []);
    };
    /*
     * 가계부가 바뀌면 받기 전에 앞 가계부의 목록부터 내린다 (2026-10-16). 받기가 실패하면(끊김) 앞 가계부의
     * 분류·계좌·사람이 검색 창과 알약 이름에 그대로 남았다. 받아 둔 것이 있으면 그것으로, 없으면 비운다.
     */
    if (referenceProjectRef.current !== projectId) {
      referenceProjectRef.current = projectId;
      applyReference(projectId ? readScreenCache<TxReference>(REFERENCE_SLOT, projectId) : undefined);
    }
    if (!projectId) {
      applyReference(undefined);
      return;
    }

    let alive = true;
    const port = homeDataPort();

    Promise.all([
      port.getPeople(projectId),
      port.getCategories(projectId),
      port.getAccountsV2(projectId),
      port.getCards(projectId),
      port.getTags(projectId),
    ])
      .then(([personRows, categoryRows, accountRows, cardRows, tagRows]) => {
        if (!alive) return;
        const reference: TxReference = {
          people: personRows,
          categories: categoryRows,
          /*
           * 고를 수 없는 계좌를 목록에서 뺀다.
           *
           * 신용카드의 부채 계정과 기초잔액 계정은 사용자가 "결제수단"으로 인식하는
           * 것이 아니다. 카드로 쓴 것은 카드 줄에서 고르고, 기초잔액은 결제가 아니다.
           */
          accounts: accountRows.filter(
            (row) => row.isActive && !HIDDEN_ACCOUNT_TYPES.includes(row.type),
          ),
          cards: cardRows.filter((row) => row.isActive),
          tags: tagRows,
        };
        applyReference(reference);
        writeScreenCache(REFERENCE_SLOT, projectId, reference);
      })
      .catch(fail);

    return () => {
      alive = false;
    };
  }, [projectId, mirrorVersion, fail]);

  return { people, pickerCategories, pickerAccounts, pickerCards, pickerTags };
}
