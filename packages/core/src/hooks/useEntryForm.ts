/**
 * 거래 입력 폼을 다루는 훅.
 *
 * 화면이 고를 목록(사람·계좌·카드·분류)을 읽고, 폼 값을 들고, 저장과 삭제를 창구로
 * 흘려보낸다. **읽기는 `homeDataPort`, 쓰기는 `entryWritePort` 다.** 그래서 이 훅은
 * 서버에 닿는지 기기 사본에 적는지 모르고, 앱에서는 그대로 오프라인 입력이 된다.
 *
 * `useCategoryManager` 와 같은 자리에 둔다. 화면이 아닌 것은 core 에 있고, 웹이 나중에
 * 같은 폼을 쓰기로 하면 그때 옮길 것이 없다.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AccountDto,
  CardDto,
  CategoryDto,
  EntryListItem,
  PersonDto,
} from '@money/types';

import {
  accountValue,
  cardValue,
  checkEntryForm,
  emptyEntryForm,
  entryFormFromItem,
  entryFormToRequest,
  parseMethod,
  type EntryFormValues,
  type EntryFormViolation,
} from '../data/entry-form';
import { entryWritePort } from '../data/entry-write-port';
import { homeDataPort } from '../data/home-port';
import { useMirrorVersion } from './useMirrorVersion';

/** 결제수단 한 칸. 화면은 계좌와 카드를 한 목록에서 고른다. */
export interface PaymentChoice {
  value: string;
  name: string;
  /** 신용카드인가. 할부 칸을 열지 정하는 값이다. */
  isCreditCard: boolean;
}

export interface EntryFormLists {
  people: PersonDto.Response[];
  accounts: AccountDto.Response[];
  cards: CardDto.Response[];
  categories: CategoryDto.Response[];
}

const EMPTY_LISTS: EntryFormLists = { people: [], accounts: [], cards: [], categories: [] };

/**
 * 결제수단 목록에서 빼는 계정.
 *
 * 카드 부채 계정은 카드로 고르는 것이고, 자본 계정은 기초잔액의 상대편이다. 둘 다 사용자가
 * "통장"으로 인식하지 않는다 (payment-methods 의 HIDDEN_ACCOUNT_TYPES 와 같은 뜻이다).
 */
const HIDDEN_TYPES = ['credit_card', 'opening_balance'];

export interface UseEntryFormOptions {
  projectId?: string | null;
  timeZone: string;
  /** 기본으로 고를 사람. 보통 내 person 이다. */
  defaultPersonId?: string;
  /** 저장·삭제가 끝난 뒤. 목록을 다시 읽는 자리다. */
  onSaved?: () => void;
}

export function useEntryForm({
  projectId,
  timeZone,
  defaultPersonId = '',
  onSaved,
}: UseEntryFormOptions) {
  const [lists, setLists] = useState<EntryFormLists>(EMPTY_LISTS);
  const [values, setValues] = useState<EntryFormValues>(() =>
    emptyEntryForm({ personId: defaultPersonId, timeZone }),
  );
  /** 고치고 있는 거래. null 이면 새로 만드는 중이다. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [violation, setViolation] = useState<EntryFormViolation | null>(null);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const mirrorVersion = useMirrorVersion();

  // 고를 목록. 사본이 채워지면(오프라인 동기화) 다시 읽는다.
  useEffect(() => {
    if (!projectId) {
      setLists(EMPTY_LISTS);
      return;
    }

    let cancelled = false;
    void (async () => {
      const port = homeDataPort();
      try {
        const [people, accounts, cards, categories] = await Promise.all([
          port.getPeople(projectId),
          port.getAccountsV2(projectId),
          port.getCards(projectId),
          port.getCategories(projectId),
        ]);
        if (!cancelled) setLists({ people, accounts, cards, categories });
      } catch {
        // 목록을 읽지 못해도 폼은 뜬다. 고를 것이 없으면 검증이 막는다.
        if (!cancelled) setLists(EMPTY_LISTS);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, mirrorVersion]);

  /** 새로 적기. 팝업을 열 때 부른다. */
  const startNew = useCallback(() => {
    setValues(emptyEntryForm({ personId: defaultPersonId, timeZone }));
    setEditingId(null);
    setViolation(null);
    setError('');
  }, [defaultPersonId, timeZone]);

  /**
   * 있는 거래를 고치기.
   *
   * 이 화면이 다루지 않는 갈래(카드사 대금 이동)면 false 를 돌려준다. 부르는 쪽이
   * 팝업을 열지 않고 안내한다.
   */
  const startEdit = useCallback(
    (item: EntryListItem): boolean => {
      const form = entryFormFromItem(item, timeZone);
      if (!form) return false;

      setValues(form);
      setEditingId(item.id);
      setViolation(null);
      setError('');
      return true;
    },
    [timeZone],
  );

  const setField = useCallback(
    <K extends keyof EntryFormValues>(field: K, value: EntryFormValues[K]) => {
      setValues((previous) => {
        const next = { ...previous, [field]: value };

        /*
         * 갈래를 바꾸면 그 갈래에서 뜻이 없는 칸을 비운다.
         *
         * 지출에서 고른 카드가 수입 폼에 남아 있으면, 화면에는 보이지 않는 값으로 저장이
         * 거절된다. 사용자는 무엇이 잘못됐는지 알 수 없다.
         */
        if (field === 'kind') {
          const isCard = Boolean(parseMethod(next.method).cardId);
          return {
            ...next,
            categoryId: next.kind === 'transfer' ? '' : next.categoryId,
            method: next.kind !== 'expense' && isCard ? '' : next.method,
            toAccountId: next.kind === 'transfer' ? next.toAccountId : '',
            installmentMonths: next.kind === 'expense' ? next.installmentMonths : '',
            transferFee: next.kind === 'transfer' ? next.transferFee : '',
            transferFeeCategoryId: next.kind === 'transfer' ? next.transferFeeCategoryId : '',
          };
        }

        // 결제수단을 통장으로 바꾸면 할부는 뜻이 없다.
        if (field === 'method' && !parseMethod(next.method).cardId) {
          return { ...next, installmentMonths: '' };
        }
        return next;
      });
      setViolation(null);
    },
    [],
  );

  /** 화면이 고르는 결제수단. 지출은 통장과 카드, 그 밖은 통장만. */
  const methodChoices = useMemo((): PaymentChoice[] => {
    const accounts = lists.accounts
      .filter((account) => account.isActive && !HIDDEN_TYPES.includes(account.type))
      .map((account) => ({
        value: accountValue(account.id),
        name: account.name,
        isCreditCard: false,
      }));

    if (values.kind !== 'expense') return accounts;

    const cards = lists.cards
      .filter((card) => card.isActive)
      .map((card) => ({
        value: cardValue(card.id),
        name: card.name,
        isCreditCard: card.cardType === 'credit',
      }));

    return [...accounts, ...cards];
  }, [lists.accounts, lists.cards, values.kind]);

  /** 이체에서 받는 계좌. 보내는 계좌는 뺀다. */
  const toAccountChoices = useMemo(
    () =>
      lists.accounts
        .filter((account) => account.isActive && !HIDDEN_TYPES.includes(account.type))
        .filter((account) => account.id !== parseMethod(values.method).accountId),
    [lists.accounts, values.method],
  );

  /** 그 갈래의 분류. 이체는 수수료 자리에만 쓰므로 지출 분류를 준다. */
  const categoryChoices = useMemo(() => {
    const type = values.kind === 'income' ? 'income' : 'expense';
    return lists.categories.filter((category) => category.isActive && category.type === type);
  }, [lists.categories, values.kind]);

  /** 지금 고른 수단이 신용카드인가. 할부 칸을 열지 정한다. */
  const isCreditCard = useMemo(
    () => methodChoices.find((choice) => choice.value === values.method)?.isCreditCard ?? false,
    [methodChoices, values.method],
  );

  const save = useCallback(async (): Promise<boolean> => {
    const found = checkEntryForm(values);
    if (found) {
      setViolation(found);
      return false;
    }

    setIsSubmitting(true);
    setError('');
    try {
      const request = entryFormToRequest(values, timeZone);
      const port = entryWritePort();
      if (editingId) {
        await port.updateEntry(editingId, request);
      } else {
        await port.createEntry({ ...request, projectId: projectId ?? undefined });
      }
      onSaved?.();
      return true;
    } catch (caught) {
      /*
       * 조립이 거절한 이유를 그대로 보여 준다.
       *
       * 오프라인에서는 서버가 없으므로 이 문장이 사용자가 받는 유일한 설명이다.
       * 삼키면 저장 버튼이 아무 일도 하지 않는 것처럼 보인다.
       */
      setError(caught instanceof Error ? caught.message : String(caught));
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }, [editingId, onSaved, projectId, timeZone, values]);

  const remove = useCallback(async (): Promise<boolean> => {
    if (!editingId) return false;

    setIsSubmitting(true);
    setError('');
    try {
      await entryWritePort().deleteEntry(editingId);
      onSaved?.();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }, [editingId, onSaved]);

  return {
    values,
    setField,
    lists,
    methodChoices,
    toAccountChoices,
    categoryChoices,
    isCreditCard,
    isEditing: editingId !== null,
    violation,
    error,
    isSubmitting,
    startNew,
    startEdit,
    save,
    remove,
  };
}
