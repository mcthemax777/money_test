/**
 * 수수료를 아직 적지 않은 유이자 할부 회차.
 *
 * 유이자 할부는 회차마다 수수료가 붙는데, 카드사와 남은 원금에 따라 금액이 조금씩 달라
 * 계산으로는 명세서와 맞출 수 없다. 그래서 그 회차의 주기가 마감되면 여기 떠오르고,
 * 사용자가 명세서를 보고 적으면 그 금액으로 수수료 전표가 하나 생긴다.
 *
 * 화면은 둘(웹·앱)인데 규칙은 하나다 -- 무엇을 보낼지, 어떤 분류를 기본으로 삼을지,
 * 빈 칸을 어떻게 가릴지가 여기 있고 화면은 그리기만 한다. 외화 청구액 확정과 같은
 * 짜임이다 (`pending-rates`).
 *
 * 서버에 직접 묻는다. 사본으로는 답할 수 없는 값이라(명세서를 보고 적는 일이다)
 * 오프라인에서는 이 칸이 뜨지 않는다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CardDto, Category } from '@money/types';

import { apiClient } from '../lib/api-client';
import { groupPendingFeesByEntry, type PendingFeeGroup } from '../lib/pending-fees';
import { homeDataPort } from '../data/home-port';
import { toAmountString, toNumber } from '../lib/money';

/** 분류 고르개 한 줄. 소분류는 "대분류 > 소분류"로 적는다. */
export interface FeeCategoryOption {
  id: string;
  name: string;
}

export interface CardPendingFees {
  items: CardDto.PendingFeeItem[];
  /** 거래별로 묶은 회차. 화면은 이 차례로 그린다. */
  groups: PendingFeeGroup[];
  currency: string;
  /** 회차 열쇠 -> 적어 넣은 수수료. 빈 칸은 아직 명세서를 못 본 회차다. */
  amounts: Record<string, string>;
  setAmount: (key: string, value: string) => void;
  categoryId: string;
  setCategoryId: (id: string) => void;
  categories: FeeCategoryOption[];
  /** 적어 넣은 회차. 이것만 보낸다. */
  filled: CardDto.PendingFeeItem[];
  save: (personId: string) => Promise<void>;
  isSaving: boolean;
  error: string;
  reload: () => Promise<void>;
}

/** 회차 하나를 가리키는 열쇠. 계획 하나에 회차가 여럿이라 id 만으로는 모자란다. */
export function pendingFeeKey(item: CardDto.PendingFeeItem): string {
  return `${item.planId}:${item.sequence}`;
}

export function useCardPendingFees(
  cardId: string | null,
  projectId: string | null,
  /** 적고 난 뒤. 남은 대금과 사용액을 부모가 다시 읽는다. */
  onSettled?: () => void,
): CardPendingFees {
  const [data, setData] = useState<CardDto.PendingFeesResponse | null>(null);
  const [categoryRows, setCategoryRows] = useState<Category[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [categoryId, setCategoryId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (!cardId) {
      setData(null);
      return;
    }
    try {
      setError('');
      const next = await apiClient.getCardPendingFees(cardId);
      setData(next);
      // 지난번에 쓴 분류를 기본으로 삼는다. 사용자가 고른 것이 있으면 그것을 둔다.
      setCategoryId((prev) => prev || next.suggestedCategoryId || '');
    } catch {
      // 오프라인이거나 체크카드다. 칸을 그리지 않는 것으로 답한다.
      setData(null);
    }
  }, [cardId]);

  useEffect(() => {
    setAmounts({});
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!projectId) return;
    void (async () => {
      try {
        setCategoryRows(((await homeDataPort().getCategories(projectId)) ?? []) as Category[]);
      } catch {
        setCategoryRows([]);
      }
    })();
  }, [projectId]);

  /*
   * 지출 분류만, 그리고 **끝 분류만** 고르게 한다.
   *
   * 아래에 소분류가 달린 대분류는 목록에서 뺀다. 거래를 적는 화면이 소분류까지 고르게
   * 하므로, 여기서만 대분류에 붙이면 같은 수수료가 분류 합계에서 다른 자리에 선다.
   */
  const categories = useMemo<FeeCategoryOption[]>(() => {
    const expense = categoryRows.filter((row) => row.type === 'expense');
    const parents = new Map(expense.filter((row) => !row.parentId).map((row) => [row.id, row.name]));
    const hasChild = new Set(expense.map((row) => row.parentId).filter(Boolean) as string[]);

    return expense
      .filter((row) => row.parentId || !hasChild.has(row.id))
      .map((row) => ({
        id: row.id,
        name: row.parentId ? `${parents.get(row.parentId) ?? ''} > ${row.name}`.trim() : row.name,
      }));
  }, [categoryRows]);

  const items = data?.items ?? [];
  // 묶는 규칙은 core 가 갖는다 (웹과 앱이 같은 차례로 그린다).
  const groups = useMemo(() => groupPendingFeesByEntry(items), [items]);
  const filled = items.filter((item) => toNumber(amounts[pendingFeeKey(item)] ?? '') > 0);

  const setAmount = useCallback((key: string, value: string) => {
    setAmounts((prev) => ({ ...prev, [key]: value }));
  }, []);

  const save = useCallback(
    async (personId: string) => {
      if (!cardId || filled.length === 0 || !categoryId) return;
      try {
        setIsSaving(true);
        setError('');
        await apiClient.settleCardFees(cardId, {
          personId,
          categoryId,
          items: filled.map((item) => ({
            planId: item.planId,
            sequence: item.sequence,
            amount: toAmountString(amounts[pendingFeeKey(item)]),
          })),
        });
        setAmounts({});
        await reload();
        onSettled?.();
      } catch (err) {
        const message = (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message;
        setError(message || 'FEE_SETTLE_FAILED');
      } finally {
        setIsSaving(false);
      }
    },
    [amounts, cardId, categoryId, filled, onSettled, reload],
  );

  return {
    items,
    groups,
    currency: data?.currency ?? 'KRW',
    amounts,
    setAmount,
    categoryId,
    setCategoryId,
    categories,
    filled,
    save,
    isSaving,
    error,
    reload,
  };
}
