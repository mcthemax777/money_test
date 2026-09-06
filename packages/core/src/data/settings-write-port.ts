/**
 * 설정 엔티티(구성원·통장·카드·분류·태그)를 만들고 고치는 창구.
 *
 * 거래 창구(`entry-write-port`)와 같은 자리다. 화면은 `settingsWritePort()` 만 부르고 그
 * 뒤에 서버가 있는지 기기 사본이 있는지 모른다. 웹은 서버 창구를, 앱은 사본 창구를 꽂는다.
 *
 * 여기 없는 것이 있다. **잔액 맞추기(setBalanceTo)는 이 창구에 두지 않았다.** 범위를
 * 질의해 여러 행을 고치는 조작이라, 며칠 뒤에 재생하면 그 사이 달라진 거래 위에서 다른
 * 결과가 나온다. 그런 것은 온라인에서만 하고 화면이 이유를 말한다 (설계 문서의 D12).
 */

import type { AccountDto, CardDto, CategoryDto, PersonDto, TagDto } from '@money/types';

import { apiClient } from '../lib/api-client';

/** 고칠 수 있는 값만 담는다. 담기지 않은 필드는 건드리지 않는다(필드별 병합). */
export interface PersonPatch {
  name?: string;
  relationship?: string | null;
  isActive?: boolean;
  /** 목록에서의 자리 (분수 색인). 순서 바꾸기는 이 값 하나로 한다. */
  sortRank?: string;
}

export interface AccountPatch {
  name?: string;
  ownerId?: string | null;
  institutionId?: string | null;
  accountNumber?: string | null;
  isActive?: boolean;
  /** 목록에서의 자리 (분수 색인). */
  sortRank?: string;
}

export interface CardPatch {
  name?: string;
  issuerId?: string;
  paymentAccountId?: string;
  cardNumber?: string | null;
  creditLimit?: string | null;
  performanceAmount?: string | null;
  statementClosingDay?: number | null;
  paymentDueDay?: number | null;
  color?: string | null;
  isActive?: boolean;
  /** 목록에서의 자리 (분수 색인). */
  sortRank?: string;
}

export interface CategoryPatch {
  name?: string;
  icon?: string | null;
  isActive?: boolean;
  /** 목록에서의 자리 (분수 색인). */
  sortRank?: string;
}

export interface TagPatch {
  name?: string;
  color?: string | null;
  isActive?: boolean;
  /** 목록에서의 자리 (분수 색인). */
  sortRank?: string;
}

export interface SettingsWritePort {
  addPerson(input: PersonDto.CreateRequest): Promise<{ id: string }>;
  updatePerson(id: string, patch: PersonPatch): Promise<void>;

  addAccount(input: AccountDto.CreateRequest): Promise<{ id: string }>;
  updateAccount(id: string, patch: AccountPatch): Promise<void>;

  addCard(input: CardDto.CreateRequest): Promise<{ id: string }>;
  updateCard(id: string, patch: CardPatch): Promise<void>;

  addCategory(input: CategoryDto.CreateRequest): Promise<{ id: string }>;
  updateCategory(id: string, patch: CategoryPatch): Promise<void>;

  addTag(input: TagDto.CreateRequest): Promise<{ id: string }>;
  updateTag(id: string, patch: TagPatch): Promise<void>;

  /**
   * 예산 한 줄을 정한다. 없으면 만들고 있으면 금액을 바꾼다.
   *
   * 구간 편집("8월부터 20만원")과 초기화는 여기 없다. 범위를 질의해 여러 행을 고치는
   * 조작이라 재생하면 그 사이 달라진 집합 위에서 다른 결과가 나온다 (D12).
   */
  setBudget(input: {
    id?: string;
    categoryId?: string | null;
    type?: string | null;
    monthlyAmount: string;
    /**
     * 어느 달의 예산인가 ("2026-08"). 없으면 오늘이 속한 달이다.
     *
     * 예산은 구간으로 나뉠 수 있어 한 분류에 규칙이 여럿일 수 있다. 이 값이 그중 어느
     * 규칙을 고칠지를 정한다 -- 8월 화면에서 고친 금액이 9월 규칙에 적히지 않도록.
     */
    yearMonth?: string;
    /**
     * 어느 프로젝트인가. 서버 창구가 쓴다.
     *
     * 사본 창구는 만들어질 때 정해진 프로젝트를 그대로 쓰므로 보지 않는다. 서버 쪽은
     * 이것이 없으면 그 사용자의 기본 프로젝트로 간다 -- 프로젝트를 여럿 둔 사람에게는
     * 남의 가계부에 예산이 생기는 일이다.
     */
    projectId?: string | null;
  }): Promise<{ id: string }>;

  /** 그 달만 다른 금액으로. 금액을 비우면 그 달의 조정을 지운다. */
  setBudgetOverride(input: {
    id?: string;
    budgetId: string;
    year: number;
    month: number;
    amount?: string | null;
  }): Promise<{ id: string }>;
}

/** 서버에 곧바로 쓰는 창구. 웹은 이것을 쓴다. */
export const httpSettingsWritePort: SettingsWritePort = {
  async addPerson(input) {
    const person = await apiClient.createPerson(input);
    return { id: person.id };
  },
  async updatePerson(id, patch) {
    // 숨기기는 선행조건이 있는 별개의 엔드포인트다. 서버가 그 조건을 본다.
    if (patch.isActive === false) {
      await apiClient.deletePerson(id);
      return;
    }
    await apiClient.updatePerson(id, patch as PersonDto.UpdateRequest);
  },

  async addAccount(input) {
    const account = await apiClient.createAccountV2(input);
    return { id: account.id };
  },
  async updateAccount(id, patch) {
    if (patch.isActive === false) {
      await apiClient.deleteAccountV2(id);
      return;
    }
    await apiClient.updateAccountV2(id, patch as AccountDto.UpdateRequest);
  },

  async addCard(input) {
    const card = await apiClient.createCard(input);
    return { id: card.id };
  },
  async updateCard(id, patch) {
    if (patch.isActive === false) {
      await apiClient.deleteCard(id);
      return;
    }
    await apiClient.updateCard(id, patch as CardDto.UpdateRequest);
  },

  async addCategory(input) {
    const category = await apiClient.createCategory(input);
    return { id: category.id };
  },
  async updateCategory(id, patch) {
    if (patch.isActive === false) {
      await apiClient.deleteCategory(id);
      return;
    }
    await apiClient.updateCategory(id, patch as CategoryDto.UpdateRequest);
  },

  async addTag(input) {
    const tag = await apiClient.createTag(input);
    return { id: tag.id };
  },
  async updateTag(id, patch) {
    if (patch.isActive === false) {
      await apiClient.deleteTag(id);
      return;
    }
    await apiClient.updateTag(id, patch as TagDto.UpdateRequest);
  },

  async setBudget(input) {
    // 서버 창구는 "있으면 고치고 없으면 만든다"를 두 호출로 나눈다. 화면이 알던 그대로다.
    if (input.id) {
      const updated = await apiClient.updateBudget(input.id, {
        monthlyAmount: input.monthlyAmount,
        applyMode: 'all',
      });
      return { id: updated.id };
    }
    const created = await apiClient.createBudget({
      categoryId: input.categoryId ?? undefined,
      type: (input.type ?? undefined) as never,
      monthlyAmount: input.monthlyAmount,
      yearMonth: input.yearMonth,
      projectId: input.projectId ?? undefined,
    });
    return { id: created.id };
  },

  async setBudgetOverride(input) {
    if (input.amount == null) {
      if (input.id) await apiClient.deleteBudgetOverride(input.id);
      return { id: input.id ?? '' };
    }
    const override = await apiClient.createBudgetOverride({
      budgetId: input.budgetId,
      year: input.year,
      month: input.month,
      amount: input.amount,
    });
    return { id: override.id };
  },
};

let current: SettingsWritePort = httpSettingsWritePort;

/** 창구를 갈아 끼운다. null 을 주면 서버 창구로 되돌아간다. */
export function setSettingsWritePort(port: SettingsWritePort | null): void {
  current = port ?? httpSettingsWritePort;
}

export function settingsWritePort(): SettingsWritePort {
  return current;
}
