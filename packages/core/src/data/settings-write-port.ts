/**
 * 설정 엔티티(구성원·통장·카드·분류·태그)를 만들고 고치는 창구.
 *
 * 거래 창구(`entry-write-port`)와 같은 자리다. 화면은 `settingsWritePort()` 만 부르고 그
 * 뒤에 서버가 있는지 기기 사본이 있는지 모른다. 웹은 서버 창구를, 앱은 사본 창구를 꽂는다.
 *
 * 범위를 질의해 여러 행을 고치는 조작(잔액 맞추기·통합·"고른 달부터" 예산)은 행의 필드가
 * 아니라 **뜻**으로 쌓는다 -- 목표 잔액, 옮길 대상, 대상과 달. 며칠 뒤에 재생해도 서버가
 * 그때의 행 위에서 같은 뜻을 이룬다 (설계 문서의 D12 를 푼 방식). 온라인에서만 하는 것은
 * 가계부 만들기·지우기·나가기, 멤버·초대, 기준 타임존이다.
 */

import type {
  AccountDto,
  AccountType,
  CardDto,
  CategoryDto,
  PersonDto,
  RecurringRuleDto,
  TagDto,
} from '@money/types';

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
  /** 유형. 자산 탭의 묶음이 이것으로 정해진다. */
  type?: AccountType;
  /**
   * 현재 잔액을 이 값으로 맞춘다. **이 필드만 아웃박스를 거치지 않는다** (D12).
   *
   * `useAssetsData` 가 여기서 떼어 `setAccountBalance` 로 보낸다. 사본 창구의
   * `updateAccount` 로 들어오면 명령에 실려 재생 때 다른 값이 나오므로, 담아 보내는
   * 쪽은 반드시 그 훅을 거친다.
   */
  balance?: string;
  ownerId?: string | null;
  institutionId?: string | null;
  accountNumber?: string | null;
  /** 알림·캡처에서 이 수단을 알아보는 말. 한 줄에 하나씩이다. */
  matchText?: string | null;
  isActive?: boolean;
  /** 목록에서의 자리 (분수 색인). */
  sortRank?: string;
}

export interface CardPatch {
  name?: string;
  issuerId?: string;
  paymentAccountId?: string;
  cardNumber?: string | null;
  /** 만료 월의 말일 (ISO). null 이면 지운다. */
  expiryDate?: string | null;
  creditLimit?: string | null;
  performanceAmount?: string | null;
  statementClosingDay?: number | null;
  paymentDueDay?: number | null;
  color?: string | null;
  /** 알림·캡처에서 이 수단을 알아보는 말. 한 줄에 하나씩이다. */
  matchText?: string | null;
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

  /**
   * 현재 잔액을 이 값으로 맞춘다. 사본 창구는 **목표 잔액**을 명령으로 쌓는다
   * (`account.balance`) -- 재생할 때 서버가 그때의 거래 위에서 기초잔액 전표를 다시 셈하므로
   * 끊긴 동안 다른 기기가 적은 거래가 있어도 잔액은 적은 값이 된다.
   */
  setAccountBalance(id: string, balance: string): Promise<void>;

  addCard(input: CardDto.CreateRequest): Promise<{ id: string }>;
  updateCard(id: string, patch: CardPatch): Promise<void>;

  /**
   * 구성원·통장·카드 **삭제**. 거래내역이 있으면 거절한다 (그때는 숨기기만 된다).
   *
   * 사본 창구는 서버와 같은 검사를 사본에서 먼저 하고(같은 오류 코드) 명령으로 쌓는다.
   * 재생할 때 서버가 다시 센다 -- 끊긴 동안 다른 기기가 거래를 붙였으면 그때 거절되어
   * 보류 칸에 남는다. 화면은 삭제를 먼저 시도하고, 거절 코드를 받으면 숨기기로 넘어간다.
   */
  removePerson(id: string): Promise<void>;
  removeAccount(id: string): Promise<void>;
  removeCard(id: string): Promise<void>;

  addCategory(input: CategoryDto.CreateRequest): Promise<{ id: string }>;
  updateCategory(id: string, patch: CategoryPatch): Promise<void>;

  addTag(input: TagDto.CreateRequest): Promise<{ id: string }>;
  updateTag(id: string, patch: TagPatch): Promise<void>;

  /**
   * 예산 한 줄을 정한다. 없으면 만들고 있으면 금액을 바꾼다.
   *
   * 구간 편집("8월부터 20만원")은 `setBudgetFrom`, 초기화는 `resetBudgets` 다 -- 범위를
   * 질의해 여러 행을 고치는 조작이라 뜻(대상과 달, 보이는 규칙 하나하나)으로 쌓는다.
   */
  setBudget(input: {
    id?: string;
    categoryId?: string | null;
    /** 태그 예산이면 그 태그. 이때 type 이 지출·수입을 가른다. */
    tagId?: string | null;
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

  /**
   * 예산 규칙 하나를 지운다 (모든 달에 0원). 달별 조정도 함께 간다.
   * "고른 달부터" 지우기는 `setBudgetFrom({ amount: null })` 이다.
   */
  deleteBudget(id: string): Promise<void>;

  /**
   * 분류 통합 / 태그 통합. 사본 창구는 서버와 같은 검사를 먼저 하고(같은 오류 코드), 사본을
   * 곧바로 고친 뒤 명령으로 쌓는다. 재생할 때 서버가 같은 검사를 다시 한다 -- 끊긴 동안 다른
   * 기기가 옮겨 받을 분류·태그를 지웠으면 그때 거절되어 보류 칸으로 간다.
   */
  mergeCategories(
    moves: CategoryDto.MergeMove[],
    projectId?: string | null,
  ): Promise<{ movedPostings: number }>;
  mergeTags(fromId: string, toId: string, projectId?: string | null): Promise<void>;

  /**
   * 반복 등록 만들기·고치기·지우기. 사본 창구는 서버와 같은 검사(이름·일정·갈래·태그·이체)를
   * 먼저 하고 사본을 곧바로 고친 뒤 명령으로 쌓는다. **밀린 회차 후보는 서버가 만든다** --
   * 끊긴 동안 만든 반복의 후보는 명령이 닿고 다음 pull 에 내려온다.
   */
  createRecurringRule(input: RecurringRuleDto.CreateRequest, projectId?: string | null): Promise<void>;
  updateRecurringRule(id: string, patch: RecurringRuleDto.UpdateRequest): Promise<void>;
  removeRecurringRule(id: string): Promise<void>;

  /**
   * "고른 달부터" 예산 바꾸기(amount)·지우기(null). 대상과 달로 보낸다 (BudgetSetFromPayload).
   * `budgetId` 는 화면이 보고 있던 규칙이다 -- 서버 창구가 지금의 REST 경로로 쓴다.
   */
  setBudgetFrom(input: {
    budgetId: string;
    categoryId?: string | null;
    tagId?: string | null;
    type?: 'income' | 'expense' | null;
    fromMonth: string;
    amount: string | null;
  }): Promise<void>;

  /**
   * 예산을 모두 지운다. 사본 창구는 **지금 사본에 보이는 규칙을 하나씩** 지우는 명령으로 쌓는다
   * -- 끊긴 동안 다른 사람이 새로 만든 예산까지 나중에 지우지 않게. 지운 규칙 수를 돌려준다.
   */
  resetBudgets(projectId: string): Promise<number>;

  /**
   * 가계부 이름·설명·표시 통화 (주인만). 기준 타임존은 늘 서버로 곧바로 간다 -- 온라인 전용으로
   * 남긴 값이다. 사본 창구도 자기 가계부가 아니면 서버로 곧바로 보낸다 (큐가 가계부마다라서).
   * 돌려주는 값은 명령으로 쌓였는지다 -- 쌓였으면 화면이 들고 있는 가계부 목록을 직접 고친다.
   */
  updateProject(
    projectId: string,
    patch: {
      name?: string;
      description?: string | null;
      timezone?: string;
      displayCurrency?: string;
    },
  ): Promise<{ queued: boolean }>;

  /**
   * 환율 한 쌍을 직접 정한다 / 지워 기본값으로 되돌린다. 사본에도 곧바로 적어 폼·환산이
   * 새 값을 쓴다. `projectId` 는 서버 창구가 쓴다 (사본 창구는 만들어질 때 정해진 것을 쓴다).
   */
  setExchangeRate(input: {
    from: string;
    to: string;
    rate: string;
    projectId?: string | null;
  }): Promise<void>;
  clearExchangeRate(input: { from: string; to: string; projectId?: string | null }): Promise<void>;

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
      await apiClient.deletePerson(id, { hide: true });
      return;
    }
    await apiClient.updatePerson(id, patch as PersonDto.UpdateRequest);
  },
  async removePerson(id) {
    await apiClient.deletePerson(id);
  },

  async addAccount(input) {
    const account = await apiClient.createAccountV2(input);
    return { id: account.id };
  },
  async updateAccount(id, patch) {
    // 숨기기는 선행조건이 있는 별개의 엔드포인트다. 서버가 그 조건을 본다.
    if (patch.isActive === false) {
      await apiClient.deleteAccountV2(id, { hide: true });
      return;
    }
    await apiClient.updateAccountV2(id, patch as AccountDto.UpdateRequest);
  },
  async setAccountBalance(id, balance) {
    await apiClient.updateAccountV2(id, { balance });
  },
  async removeAccount(id) {
    await apiClient.deleteAccountV2(id);
  },

  async addCard(input) {
    const card = await apiClient.createCard(input);
    return { id: card.id };
  },
  async updateCard(id, patch) {
    if (patch.isActive === false) {
      await apiClient.deleteCard(id, { hide: true });
      return;
    }
    await apiClient.updateCard(id, patch as CardDto.UpdateRequest);
  },
  async removeCard(id) {
    await apiClient.deleteCard(id);
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
      tagId: input.tagId ?? undefined,
      type: (input.type ?? undefined) as never,
      monthlyAmount: input.monthlyAmount,
      yearMonth: input.yearMonth,
      projectId: input.projectId ?? undefined,
    });
    return { id: created.id };
  },

  async deleteBudget(id) {
    await apiClient.deleteBudget(id);
  },

  async mergeCategories(moves, projectId) {
    const result = await apiClient.mergeCategories(moves, projectId);
    return { movedPostings: result.movedPostings };
  },

  async mergeTags(fromId, toId, projectId) {
    await apiClient.mergeTags(fromId, toId, projectId);
  },

  async createRecurringRule(input, projectId) {
    await apiClient.createRecurringRule(input, projectId);
  },

  async updateRecurringRule(id, patch) {
    await apiClient.updateRecurringRule(id, patch);
  },

  async removeRecurringRule(id) {
    await apiClient.deleteRecurringRule(id);
  },

  async setBudgetFrom({ budgetId, fromMonth, amount }) {
    if (amount === null) await apiClient.deleteBudget(budgetId, fromMonth);
    else {
      await apiClient.updateBudget(budgetId, {
        monthlyAmount: amount,
        applyMode: 'from',
        applyFromMonth: fromMonth,
      });
    }
  },

  async resetBudgets(projectId) {
    return (await apiClient.resetBudgets(projectId)).deleted;
  },

  async updateProject(projectId, patch) {
    await apiClient.updateProject(projectId, patch as never);
    return { queued: false };
  },

  async setExchangeRate({ projectId, ...input }) {
    await apiClient.setExchangeRate(input, projectId);
  },

  async clearExchangeRate({ from, to, projectId }) {
    await apiClient.clearExchangeRate(from, to, projectId);
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
