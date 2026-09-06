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
import { fallbackRate } from '@money/types';
import type {
  AccountDto,
  CardDto,
  CategoryDto,
  TagDto,
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
  type EntryFormSplit,
  type EntryFormValues,
  type EntryFormViolation,
} from '../data/entry-form';
import { entryWritePort } from '../data/entry-write-port';
import { homeDataPort } from '../data/home-port';
import { useProjectLedgerCurrency } from '../store/project';
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
  tags: TagDto.Response[];
}

const EMPTY_LISTS: EntryFormLists = {
  people: [],
  accounts: [],
  cards: [],
  categories: [],
  tags: [],
};

/**
 * 결제수단 목록에서 빼는 계정.
 *
 * 카드 부채 계정은 카드로 고르는 것이고, 자본 계정은 기초잔액의 상대편이다. 둘 다 사용자가
 * "통장"으로 인식하지 않는다 (payment-methods 의 HIDDEN_ACCOUNT_TYPES 와 같은 뜻이다).
 */
const HIDDEN_TYPES = ['credit_card', 'opening_balance'];

/** 빈 분할 줄. */
const blankSplit = (): EntryFormSplit => ({ categoryId: '', amount: '', extraAmount: '' });

/**
 * 적힌 금액들의 합. 숫자가 아닌 칸은 0으로 본다.
 *
 * 화면이 "남은 금액"을 보여 주는 데만 쓴다. 저장을 막는 판단은 `checkEntryForm` 이 하고,
 * 그쪽은 숫자가 아닌 값을 오류로 다룬다.
 */
function sumAmounts(values: readonly string[]): number {
  return values.reduce((total, value) => {
    const parsed = Number(value);
    return total + (Number.isFinite(parsed) ? parsed : 0);
  }, 0);
}

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
  /** 장부 통화. 이 통화로 적으면 환산할 것이 없다. */
  const ledgerCurrency = useProjectLedgerCurrency();

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
        const [people, accounts, cards, categories, tags] = await Promise.all([
          port.getPeople(projectId),
          port.getAccountsV2(projectId),
          port.getCards(projectId),
          port.getCategories(projectId),
          port.getTags(projectId),
        ]);
        if (!cancelled) setLists({ people, accounts, cards, categories, tags });
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
   * 이 폼이 다루지 못하는 거래면 false 를 돌려주고, 부르는 쪽이 팝업을 열지 않고
   * 안내한다. 둘이다 -- 잔액 맞추기가 만든 조정, 그리고 줄이 여럿인데 그 줄들이 실려
   * 오지 않은 분할(옛 서버). 뒤엣것을 대표 분류 하나로 열면 나머지가 조용히 사라진다.
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
          const hasCategory = next.kind === 'expense' || next.kind === 'income';
          return {
            ...next,
            categoryId: hasCategory ? next.categoryId : '',
            // 카드는 지출에서만 결제수단이다. 카드사 대금 이동의 카드는 따로 든다.
            method: next.kind !== 'expense' && isCard ? '' : next.method,
            toAccountId: next.kind === 'transfer' ? next.toAccountId : '',
            installmentMonths: next.kind === 'expense' ? next.installmentMonths : '',
            transferFee: next.kind === 'transfer' ? next.transferFee : '',
            transferFeeCategoryId: next.kind === 'transfer' ? next.transferFeeCategoryId : '',
            // 분할은 분류를 갖는 갈래에만 뜻이 있다.
            splits: hasCategory ? next.splits : [],
            cardId: next.kind === 'card_payment' ? next.cardId : '',
          };
        }

        /*
         * 통화를 바꾸면 환율을 그 통화의 값으로 채운다.
         *
         * 기준통화로 되돌리면 비운다 -- 환산할 것이 없는데 값이 남아 있으면 다음에 다른
         * 통화를 골랐을 때 엉뚱한 환율이 그대로 실린다.
         */
        if (field === 'currency') {
          if (!next.currency) return { ...next, exchangeRate: '' };
          return { ...next, exchangeRate: fallbackRate(next.currency, ledgerCurrency) ?? '' };
        }

        // 결제수단을 통장으로 바꾸면 할부는 뜻이 없다.
        if (field === 'method' && !parseMethod(next.method).cardId) {
          return { ...next, installmentMonths: '' };
        }
        return next;
      });
      setViolation(null);
    },
    [ledgerCurrency],
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

  /**
   * 카드사 대금 이동에서 고를 카드. 신용카드만이다.
   *
   * 체크카드는 결제하는 자리에서 통장에서 빠지므로 나중에 갚을 대금이 없다.
   */
  const cardChoices = useMemo(
    () => lists.cards.filter((card) => card.isActive && card.cardType === 'credit'),
    [lists.cards],
  );

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

  /**
   * 분할 줄을 더한다.
   *
   * 첫 줄에는 **지금까지 적은 금액과 대표 분류**를 옮겨 담는다. 빈 줄 둘로 시작하면
   * 사용자가 이미 적어 둔 것을 다시 적어야 한다.
   */
  const addSplit = useCallback(() => {
    setValues((previous) => {
      if (previous.splits.length > 0) {
        return { ...previous, splits: [...previous.splits, blankSplit()] };
      }
      return {
        ...previous,
        splits: [
          {
            categoryId: previous.categoryId,
            amount: previous.amount,
            extraAmount: previous.extraAmount,
          },
          blankSplit(),
        ],
      };
    });
    setViolation(null);
  }, []);

  /**
   * 분할 줄을 뺀다. 하나만 남으면 분할을 그만둔다.
   *
   * 줄 하나짜리 분할은 분류 하나짜리 거래와 같은 전표가 되므로, 그때는 원래 칸으로
   * 되돌려 화면을 단순하게 둔다.
   */
  const removeSplit = useCallback((index: number) => {
    setValues((previous) => {
      const rest = previous.splits.filter((_, at) => at !== index);
      if (rest.length > 1) return { ...previous, splits: rest };

      const only = rest[0];
      return {
        ...previous,
        splits: [],
        ...(only
          ? { categoryId: only.categoryId, amount: only.amount, extraAmount: only.extraAmount }
          : {}),
      };
    });
    setViolation(null);
  }, []);

  /** 분할 줄 하나의 칸을 고친다. */
  const setSplit = useCallback(
    <K extends keyof EntryFormSplit>(index: number, field: K, value: EntryFormSplit[K]) => {
      setValues((previous) => ({
        ...previous,
        splits: previous.splits.map((split, at) =>
          at === index ? { ...split, [field]: value } : split,
        ),
      }));
      setViolation(null);
    },
    [],
  );

  return {
    values,
    setField,
    lists,
    methodChoices,
    toAccountChoices,
    categoryChoices,
    cardChoices,
    isCreditCard,
    ledgerCurrency,
    /** 분할 줄의 합. 화면이 "얼마 남았다"를 보여 줄 때 쓴다. */
    splitTotal: useMemo(
      () => sumAmounts(values.splits.map((split) => split.amount)),
      [values.splits],
    ),
    addSplit,
    removeSplit,
    setSplit,
    /**
     * 태그 하나를 붙이거나 뗀다.
     *
     * 여러 개를 고르는 칸이라 `setField` 로 배열을 통째로 넘기게 두면 화면마다 그
     * 뒤집기를 다시 적게 된다.
     */
    toggleTag: useCallback((tagId: string) => {
      setValues((previous) => ({
        ...previous,
        tagIds: previous.tagIds.includes(tagId)
          ? previous.tagIds.filter((id) => id !== tagId)
          : [...previous.tagIds, tagId],
      }));
    }, []),
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
