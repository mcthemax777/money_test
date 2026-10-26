/*
 * 거래 입력에서 고르는 칸 옆의 "+"로 그 자리에서 구성원·통장·카드·분류·태그를 만드는 일.
 *
 * 거래 입력(EntryEditor)에서 떼어 냈다 (2026-10-26). 어느 창이 열려 있는지와, 만든 뒤 곧바로
 * 고르는 일, 분류를 대분류·소분류로 나눠 만드는 일을 든다. 창은 EntryQuickAddModals 가 그린다.
 */
import { useEffect, useRef, useState } from 'react';

import type { useEntryForm } from '@money/core/hooks/useEntryForm';
import { useQuickAdd, type QuickAddResult } from '@money/core/hooks/useQuickAdd';
import {
  filledSubCategories,
  type CategoryFormValues,
} from '@money/core/hooks/useCategoryManager';
import { parseMethod } from '@money/core/data/entry-form';

/**
 * 지금 열려 있는 만들기 창. null 이면 없다.
 *
 * 'method' 는 통장인지 카드인지를 묻는 갈림길이다 (결제수단 칸이 둘을 한 목록에서
 * 고르게 하므로 무엇을 만들지는 여기서 묻는다 -- 웹과 같다).
 */
export type EntryQuickAddKind = 'method' | 'person' | 'account' | 'card' | 'category' | 'tag';

export function useEntryQuickAdd({
  projectId,
  isOpen,
  form,
}: {
  projectId: string | null;
  /** 거래 입력 팝업이 열려 있는가. 닫히면 그 위의 창도 함께 접는다. */
  isOpen: boolean;
  form: ReturnType<typeof useEntryForm>;
}) {
  const { values } = form;
  const quickAdd = useQuickAdd(projectId);

  /**
   * 지금 열려 있는 만들기 창.
   *
   * 한 번에 하나만 연다 -- 폼 위에 창을 겹쳐 쌓으면 어느 것을 닫는 중인지 알 수 없다.
   */
  const [adding, setAdding] = useState<null | EntryQuickAddKind>(null);

  // 팝업을 닫으면 그 위의 창도 함께 접는다. 다시 열었을 때 남아 있으면 안 된다.
  useEffect(() => {
    if (!isOpen) setAdding(null);
  }, [isOpen]);

  /**
   * 만들고 나서 그 값을 곧바로 고른다.
   *
   * 목록을 다시 읽어야 알약 줄에 나타나고, 만든 id 를 폼에 꽂아야 고르러 한 번 더
   * 누르지 않는다. 실패는 그대로 돌려준다 -- 창이 닫히지 않고 그 자리에 이유를 적는다.
   */
  const addThenPick = async (
    making: Promise<QuickAddResult>,
    pick: (id: string) => void,
  ): Promise<QuickAddResult> => {
    const result = await making;
    if (result.ok && result.id) {
      await form.reloadLists();
      pick(result.id);
    }
    return result;
  };

  /** 새 분류의 유형. 거래의 갈래가 정한다 (form.categoryChoices 와 같은 규칙). */
  const categoryType = values.kind === 'income' ? 'income' : 'expense';

  /**
   * 이 편집기에서 만든 분류 (대분류는 유형|이름, 소분류는 대분류id|이름 -> id). 소분류가 실패해 다시 시도할 때
   * 이미 만든 것을 또 만들지 않는다.
   */
  const madeParents = useRef(new Map<string, string>());

  /**
   * 분류를 만든다. 대분류 하나와, 적어 둔 소분류들.
   *
   * 곧바로 고를 하나의 id 를 함께 돌려준다 -- 소분류를 하나만 적었으면 그것이 적으려던
   * 분류이고, 아니면 대분류다 (여럿을 적었으면 어느 것인지 알 수 없다).
   *
   * 소분류를 만들다 실패해도 대분류는 되돌리지 않는다. 만들어진 것을 지우면 그 사이
   * 남이 쓴 분류를 지우게 될 수 있고, 목록에 남아 있으면 사용자가 이어서 손볼 수 있다.
   */
  const createCategory = async ({
    values,
    parentId,
  }: {
    values: CategoryFormValues;
    parentId?: string;
  }): Promise<QuickAddResult> => {
    /*
     * 붙일 대분류를 골랐으면 그것을 쓰고, 아니면 새로 만든다. 앞 시도에서 이미 만든 대분류가 있으면 그것을 쓴다
     * (2026-10-21) -- 소분류가 실패한 뒤 다시 누르면 대분류를 또 만들려다 이름이 겹쳐 영영 실패했다.
     */
    const parentKey = `${values.type}|${values.name.trim()}`;
    let parent = parentId ?? madeParents.current.get(parentKey);
    if (!parent) {
      const made = await quickAdd.addCategory({ name: values.name, type: values.type });
      if (!made.ok || !made.id) return made;
      parent = made.id;
      madeParents.current.set(parentKey, parent);
    }

    // 이미 있는 소분류(앞 시도에서 만든 것)는 건너뛴다. 같은 이름을 다시 만들면 또 겹친다.
    const existingSubs = new Map(
      form.lists.categories
        .filter((category) => category.parentId === parent)
        .map((category) => [category.name, category.id]),
    );
    const madeSubs: string[] = [];
    for (const row of filledSubCategories(values.subCategories)) {
      const subKey = `${parent}|${row.name.trim()}`;
      // 목록이 아직 따라오지 않았을 수 있어 이 편집기가 만든 것도 함께 본다.
      const already = existingSubs.get(row.name.trim()) ?? madeParents.current.get(subKey);
      if (already) {
        madeSubs.push(already);
        continue;
      }
      const made = await quickAdd.addCategory({
        name: row.name.trim(),
        type: values.type,
        parentId: parent,
      });
      if (!made.ok) return made;
      if (made.id) {
        madeSubs.push(made.id);
        madeParents.current.set(subKey, made.id);
      }
    }

    return { ok: true, id: madeSubs.length === 1 ? madeSubs[0] : parent };
  };

  /** 새 통장의 주인. 폼에서 고른 거래자이고, 아직 없으면 첫 구성원이다. */
  const newAccountOwner =
    form.lists.people.find((person) => person.id === values.personId) ??
    form.lists.people.find((person) => person.isActive) ??
    null;

  /**
   * 새 카드의 결제 통장.
   *
   * 지금 고른 결제수단이 통장이면 그것, 아니면 고를 수 있는 첫 통장이다. 고를 수 있는
   * 것은 결제수단 목록이 이미 가려 두었다 -- 카드 부채 계정과 자본 계정은 빠져 있다.
   */
  const newCardAccount = (() => {
    const ids = form.methodChoices
      .map((choice) => parseMethod(choice.value).accountId)
      .filter((id): id is string => Boolean(id));
    const chosen = parseMethod(values.method).accountId;
    const id = chosen && ids.includes(chosen) ? chosen : ids[0];
    return form.lists.accounts.find((account) => account.id === id) ?? null;
  })();

  return {
    quickAdd,
    adding,
    setAdding,
    addThenPick,
    categoryType,
    createCategory,
    newAccountOwner,
    newCardAccount,
  } as const;
}

export type EntryQuickAdd = ReturnType<typeof useEntryQuickAdd>;
