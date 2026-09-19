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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  defaultCountsPerformance,
  emptyEntryForm,
  entryFormFromDraft,
  entryFormFromItem,
  entryFormToRequest,
  parseMethod,
  type EntryFormSplit,
  newSplitLine,
  type EntryFormValues,
  type EntryFormViolation,
} from '../data/entry-form';
import { entryWritePort } from '../data/entry-write-port';
import { homeDataPort } from '../data/home-port';
import { apiErrorCode, useApiError } from '../lib/api-error';
import { useProjectLedgerCurrency } from '../store/project';
import { useMirrorVersion } from './useMirrorVersion';

/** 결제수단 한 칸. 화면은 계좌와 카드를 한 목록에서 고른다. */
export interface PaymentChoice {
  value: string;
  name: string;
  /** 신용카드인가. 할부 칸을 열지 정하는 값이다. */
  isCreditCard: boolean;
  /**
   * 이체 목록에 낀 카드 부채 계정인가.
   *
   * 한쪽에 카드를 고르면 반대쪽 목록에서 카드를 빼는 데 쓴다. 카드에서 카드로 바로
   * 옮기는 거래는 저장할 수 없어서다.
   */
  isCardLiability?: boolean;
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

/** 빈 분할 줄. 줄 키는 `newSplitLine` 이 붙인다. */
const blankSplit = (): EntryFormSplit => newSplitLine();

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
  /**
   * 저장·삭제가 끝난 뒤. 목록을 다시 읽는 자리다.
   *
   * 만든 거래의 id 를 함께 준다. 보관함이 그 값으로 후보에 등록 표시를 남긴다 --
   * 그러지 않으면 "이 후보가 어느 거래가 되었는지"를 아무도 모른다. 지우기에서는
   * null 이고, 목록만 다시 읽는 쪽은 인자를 받지 않으면 된다.
   */
  onSaved?: (result: { entryId: string | null }) => void;
}

export function useEntryForm({
  projectId,
  timeZone,
  defaultPersonId = '',
  onSaved,
}: UseEntryFormOptions) {
  const [lists, setLists] = useState<EntryFormLists>(EMPTY_LISTS);
  /** 목록 조회의 번호. 뒤늦게 온 답이 새 목록을 덮지 않게 한다. */
  const listsRun = useRef(0);
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
  /** 서버가 코드로 말한 오류를 고른 언어의 문장으로. */
  const { messageOf } = useApiError();

  /**
   * 고를 목록을 다시 읽는다. 읽은 것을 그대로 돌려준다.
   *
   * 돌려주는 것이 요점이다. 폼 안에서 무언가를 만들면(구성원·통장·카드·분류·태그)
   * 그것을 곧바로 골라야 하는데, 상태가 반영되기를 기다릴 수 없으므로 만든 쪽이
   * 이 결과에서 그 줄을 찾아 쓴다.
   */
  const reloadLists = useCallback(async (): Promise<EntryFormLists> => {
    /*
     * 이 조회가 아직 유효한지 가리는 표.
     *
     * 가계부를 바꾸면 앞서 떠난 조회가 뒤늦게 돌아와 남의 가계부 목록을 붙인다.
     * 돌려주는 값은 그대로 둔다 -- 부른 쪽은 자기가 만든 것을 찾는 데 쓰고, 화면에
     * 붙이는 것만 마지막 조회의 몫이다.
     */
    const run = ++listsRun.current;

    if (!projectId) {
      if (listsRun.current === run) setLists(EMPTY_LISTS);
      return EMPTY_LISTS;
    }

    const port = homeDataPort();
    try {
      const [people, accounts, cards, categories, tags] = await Promise.all([
        port.getPeople(projectId),
        port.getAccountsV2(projectId),
        port.getCards(projectId),
        port.getCategories(projectId),
        port.getTags(projectId),
      ]);
      const next = { people, accounts, cards, categories, tags };
      if (listsRun.current === run) setLists(next);
      return next;
    } catch {
      // 목록을 읽지 못해도 폼은 뜬다. 고를 것이 없으면 검증이 막는다.
      if (listsRun.current === run) setLists(EMPTY_LISTS);
      return EMPTY_LISTS;
    }
  }, [projectId]);

  // 고를 목록. 사본이 채워지면(오프라인 동기화) 다시 읽는다.
  useEffect(() => {
    void reloadLists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadLists, mirrorVersion]);

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

  /**
   * 있는 거래의 내용만 베껴 새로 적기.
   *
   * 값을 되돌리는 길은 고치기와 같다(`entryFormFromItem`). 다른 것은 둘뿐이다 --
   * 고칠 거래(`editingId`)와 그 거래를 본 시점의 판(`baseHlc`)을 들지 않는다.
   * 하나라도 남으면 저장이 새 거래를 만드는 대신 베낀 원본을 덮어쓴다.
   *
   * 날짜와 시각도 그대로 둔다. 베끼는 까닭이 대개 "같은 자리에서 또"라, 오늘로
   * 바꿔 두면 되레 고칠 칸이 늘어난다.
   *
   * 못 다루는 거래에서 false 를 돌려주는 규칙도 고치기와 같다.
   */
  const startCopy = useCallback(
    (item: EntryListItem): boolean => {
      const form = entryFormFromItem(item, timeZone);
      if (!form) return false;

      setValues({ ...form, baseHlc: null });
      setEditingId(null);
      setViolation(null);
      setError('');
      return true;
    },
    [timeZone],
  );

  /**
   * 보관함의 후보로 폼을 채운다. 저장하면 새 거래가 된다.
   *
   * 베끼기(`startCopy`)와 하는 일이 같고 값의 출처만 다르다. 후보에는 빈 칸이 있는
   * 것이 정상이라 빈 폼에서 시작해 읽은 것만 덮어쓴다(`entryFormFromDraft`).
   */
  const startDraft = useCallback(
    (draft: Parameters<typeof entryFormFromDraft>[0]) => {
      setValues(
        entryFormFromDraft(draft, {
          personId: defaultPersonId,
          timeZone,
          ledgerCurrency,
        }),
      );
      setEditingId(null);
      setViolation(null);
      setError('');
    },
    [defaultPersonId, timeZone, ledgerCurrency],
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
            /*
             * 이체는 계좌끼리다. 카드를 고른 채 이체로 옮기면 비운다.
             *
             * 이체에서 카드는 **부채 계정**으로 고른다(`transferChoices`). 결제수단으로
             * 고른 카드가 그대로 남으면 화면에 보이지 않는 값으로 저장이 거절된다.
             */
            method: next.kind === 'transfer' && isCard ? '' : next.method,
            toAccountId: next.kind === 'transfer' ? next.toAccountId : '',
            installmentMonths: next.kind === 'expense' ? next.installmentMonths : '',
            transferFee: next.kind === 'transfer' ? next.transferFee : '',
            transferFeeCategoryId: next.kind === 'transfer' ? next.transferFeeCategoryId : '',
            // 분할은 분류를 갖는 갈래에만 뜻이 있다.
            splits: hasCategory ? next.splits : [],
            // 차감은 지출에만 뜻이 있다.
            discountAmount: next.kind === 'expense' ? next.discountAmount : '',
            /*
             * 실적 포함은 갈래마다 기본값이 다르다. 갈래를 바꾸면 되돌린다.
             *
             * 그대로 두면 지출에서 켜 둔 값이 수입으로 따라와, 카드사가 준 캐시백이
             * 실적을 깎는다. 사용자는 켠 적이 없는데도 그렇게 된다.
             */
            countsPerformance: defaultCountsPerformance(next.kind),
            // 차감이 딸려 있는 값이라 함께 되돌린다. 차감 자체도 위에서 비운다.
            discountCountsPerformance: true,
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
          return {
            ...next,
            exchangeRate: fallbackRate(next.currency, ledgerCurrency) ?? '',
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
    [ledgerCurrency],
  );

  /** 화면이 고르는 결제수단. 지출은 통장과 카드, 그 밖은 통장만. */
  /**
   * 이체에서 고를 수 있는 계좌. 신용카드의 부채 계정을 함께 넣는다.
   *
   * **카드대금 결제가 곧 이체이기 때문이다.** 통장에서 돈이 나가고 그만큼 카드 빚이
   * 주는 일이라, 한쪽에 카드를 고르면 그대로 대금 결제가 되고 반대로 고르면 환불
   * 입금이 된다. 갈래를 따로 두지 않는 까닭이 이것이다.
   *
   * 부채 계정은 통장 목록에서 감춰져 있다(`HIDDEN_TYPES`). 지출 결제수단이나 자산
   * 화면에 새어 나가면 안 되므로 목록을 열지 않고, 이미 받아 둔 카드에서 꺼내 여기서만
   * 조립한다. 웹의 `transferAccountOptions` 와 같은 규칙이다.
   */
  const transferChoices = useMemo((): PaymentChoice[] => {
    const accounts = lists.accounts
      .filter((account) => account.isActive && !HIDDEN_TYPES.includes(account.type))
      .map((account) => ({
        value: accountValue(account.id),
        name: account.name,
        isCreditCard: false,
      }));

    const liabilities = lists.cards
      .filter((card) => card.isActive && card.cardType === 'credit' && card.liabilityAccountId)
      .map((card) => ({
        value: accountValue(card.liabilityAccountId!),
        name: card.name,
        // 카드 부채 계정이지 결제수단 카드가 아니다. 할부 칸을 열 자리가 아니다.
        isCreditCard: false,
        isCardLiability: true,
      }));

    return [...accounts, ...liabilities];
  }, [lists.accounts, lists.cards]);

  /**
   * 이체 한쪽에서 고를 수 있는 것. 반대쪽으로 고른 것과 **카드끼리**를 뺀다.
   *
   * 한쪽이 카드면 반대쪽 목록에서 카드가 사라진다. 카드에서 카드로 바로 옮기는 거래는
   * 저장할 수 없는데(`TRANSFER_BOTH_CARDS`), 고를 수 있게 두면 다 적고 나서야 알게 된다.
   */
  const transferOptionsFor = useCallback(
    (otherValue: string): PaymentChoice[] => {
      const otherIsCard = transferChoices.some(
        (choice) => choice.value === otherValue && choice.isCardLiability,
      );
      return transferChoices.filter(
        (choice) => choice.value !== otherValue && !(otherIsCard && choice.isCardLiability),
      );
    },
    [transferChoices],
  );

  const methodChoices = useMemo((): PaymentChoice[] => {
    if (values.kind === 'transfer') return transferOptionsFor(accountValue(values.toAccountId));

    const accounts = lists.accounts
      .filter((account) => account.isActive && !HIDDEN_TYPES.includes(account.type))
      .map((account) => ({
        value: accountValue(account.id),
        name: account.name,
        isCreditCard: false,
      }));

    /*
     * 지출과 수입 모두 카드를 고를 수 있다.
     *
     * 수입에도 여는 것은 카드사가 되돌려 주는 돈이 통장을 거치지 않고 다음 청구에서
     * 빠지는 일이 있어서다. 그때 돈이 들어오는 자리는 통장이 아니라 그 카드의 빚이다.
     */
    const cards = lists.cards
      .filter((card) => card.isActive)
      .map((card) => ({
        value: cardValue(card.id),
        name: card.name,
        isCreditCard: card.cardType === 'credit',
      }));

    return [...accounts, ...cards];
  }, [lists.accounts, lists.cards, transferOptionsFor, values.kind, values.toAccountId]);

  /**
   * 이체에서 받는 쪽. 보내는 쪽으로 고른 것만 뺀다.
   *
   * 받는 쪽은 계좌 id 를 그대로 든다(`toAccountId`). 보내는 쪽만 접두사가 붙는데,
   * 그 칸은 지출에서 카드와 통장을 한 목록에서 고르는 자리를 함께 쓰기 때문이다.
   */
  const toAccountChoices = useMemo(
    () =>
      transferOptionsFor(values.method).map((choice) => ({
        id: parseMethod(choice.value).accountId ?? '',
        name: choice.name,
      })),
    [transferOptionsFor, values.method],
  );

  /** 그 갈래의 분류. 이체는 수수료 자리에만 쓰므로 지출 분류를 준다. */
  const categoryChoices = useMemo(() => {
    const type = values.kind === 'income' ? 'income' : 'expense';
    return lists.categories.filter((category) => category.type === type);
  }, [lists.categories, values.kind]);

  /**
   * 이체 양쪽 가운데 카드 부채 계정인 쪽. 카드가 끼지 않았으면 null.
   *
   *   payment 통장 -> 카드   대금 결제 (빚이 준다)
   *   refund  카드 -> 통장   환불 입금 (카드사가 돌려준다)
   *
   * 화면이 "이 이체는 카드대금으로 기록됩니다"를 미리 알려 주는 데 쓴다. 저장되는
   * 전표에는 방향이 부호로만 남아, 적고 나서야 알게 하면 늦다.
   */
  const transferCardSide = useMemo((): 'payment' | 'refund' | null => {
    if (values.kind !== 'transfer') return null;

    const liabilities = new Set(
      lists.cards
        .filter((card) => card.liabilityAccountId)
        .map((card) => card.liabilityAccountId!),
    );
    const from = parseMethod(values.method).accountId;
    const fromIsCard = Boolean(from && liabilities.has(from));
    const toIsCard = Boolean(values.toAccountId && liabilities.has(values.toAccountId));

    if (fromIsCard && !toIsCard) return 'refund';
    if (toIsCard && !fromIsCard) return 'payment';
    return null;
  }, [lists.cards, values.kind, values.method, values.toAccountId]);

  /** 지금 고른 수단이 신용카드인가. 할부 칸을 열지 정한다. */
  const isCreditCard = useMemo(
    () => methodChoices.find((choice) => choice.value === values.method)?.isCreditCard ?? false,
    [methodChoices, values.method],
  );

  /**
   * 결제수단으로 고른 카드. 통장을 골랐거나 이체면 null 이다.
   *
   * 화면이 카드 종류에 따라 다른 안내를 띄우는 데 쓴다 -- 신용카드로 받은 수입은
   * 갚을 대금에서 빠지고, 체크카드로 받은 수입은 연결 통장으로 들어온다.
   */
  const selectedCard = useMemo(() => {
    const cardId = parseMethod(values.method).cardId;
    return cardId ? lists.cards.find((card) => card.id === cardId) ?? null : null;
  }, [lists.cards, values.method]);

  /** 신용카드 부채 계정의 id 들. 검증이 "양쪽 다 카드인 이체"를 가리는 데 쓴다. */
  const cardLiabilityIds = useMemo(
    () =>
      new Set(
        lists.cards
          .filter((card) => card.liabilityAccountId)
          .map((card) => card.liabilityAccountId!),
      ),
    [lists.cards],
  );

  const save = useCallback(async (): Promise<boolean> => {
    const found = checkEntryForm(values, cardLiabilityIds);
    if (found) {
      setViolation(found);
      return false;
    }

    setIsSubmitting(true);
    setError('');
    try {
      const port = entryWritePort();
      let savedId: string | null = editingId;

      const request = entryFormToRequest(values, timeZone);
      if (editingId) {
        /*
         * 폼을 열 때 본 판을 함께 보낸다. 서버가 그 사이의 편집을 알아채는 근거다.
         *
         * 사본 창구는 이 값을 쓰지 않는다. 그쪽은 사본이 아는 시계를 스스로 읽어
         * 명령의 시계를 그 뒤로 발급받는다 -- 판정을 서버에 맡기지 않고 병합한다.
         */
        await port.updateEntry(editingId, {
          ...request,
          baseHlc: values.baseHlc,
        });
      } else {
        const created = await port.createEntry({
          ...request,
          projectId: projectId ?? undefined,
        });
        savedId = created.id;
      }
      onSaved?.({ entryId: savedId });
      return true;
    } catch (caught) {
      /*
       * 조립이 거절한 이유를 그대로 보여 준다.
       *
       * 오프라인에서는 서버가 없으므로 이 문장이 사용자가 받는 유일한 설명이다.
       * 삼키면 저장 버튼이 아무 일도 하지 않는 것처럼 보인다.
       *
       * 서버가 코드를 붙여 보낸 오류만 화면 말로 바꾼다. 코드가 없는 것은 조립이 던진
       * 것이라 그 문장이 이미 사람이 읽을 말이고, 여기서 덮으면 무엇이 잘못됐는지 잃는다.
       */
      setError(
        apiErrorCode(caught)
          ? messageOf(caught, 'editor.editFailed')
          : caught instanceof Error
            ? caught.message
            : String(caught),
      );
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }, [cardLiabilityIds, editingId, messageOf, onSaved, projectId, timeZone, values]);

  const remove = useCallback(async (): Promise<boolean> => {
    if (!editingId) return false;

    setIsSubmitting(true);
    setError('');
    try {
      await entryWritePort().deleteEntry(editingId);
      // 지운 자리에는 만들어진 거래가 없다.
      onSaved?.({ entryId: null });
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
      /*
       * 첫 줄은 지금까지 적은 값을 그대로 물려받는다. **줄 키도 함께 옮긴다** --
       * 이미 저장된 거래를 분할로 바꾸는 중이면, 그 키에 붙어 있던 태그와 차감이
       * 첫 줄에 그대로 이어져야 한다.
       */
      return {
        ...previous,
        splits: [
          newSplitLine({
            categoryId: previous.categoryId,
            amount: previous.amount,
            lineKey: previous.lineKey,
            discountAmount: previous.discountAmount,
            tagIds: previous.tagIds,
          }),
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
        ...(only ? { categoryId: only.categoryId, amount: only.amount } : {}),
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
    reloadLists,
    methodChoices,
    toAccountChoices,
    categoryChoices,
    isCreditCard,
    selectedCard,
    transferCardSide,
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
    startCopy,
    startDraft,
    save,
    remove,
  };
}
