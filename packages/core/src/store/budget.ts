import { create } from 'zustand';
import type { BudgetDto, EntryFilterQuery } from '@money/types';
import { apiClient } from '../lib/api-client';
import { settingsWritePort } from '../data/settings-write-port';
import { toNumber } from '../lib/money';

/**
 * 서버는 금액을 문자열로 준다 (Decimal 직렬화).
 * 예산 화면은 비교와 나눗셈을 하므로 스토어에 들어올 때 숫자로 바꾼다.
 *
 * 문자열 그대로 두면 `"3000" > "10000"` 이 true가 되어(첫 글자 비교)
 * 진행률이 101%로 나오는 식의 조용한 오류가 난다.
 * 예산은 계획 금액이라 KRW 범위에서 double 정밀도로 충분하다.
 */
function normalizeBudget<
  T extends { monthlyAmount?: unknown; ruleAmount?: unknown; usedAmount?: unknown },
>(row: T) {
  return {
    ...row,
    monthlyAmount: toNumber(row.monthlyAmount as string),
    ...(row.ruleAmount !== undefined ? { ruleAmount: toNumber(row.ruleAmount as string) } : {}),
    ...(row.usedAmount !== undefined ? { usedAmount: toNumber(row.usedAmount as string) } : {}),
  };
}

interface Budget {
  id: string;
  projectId: string;
  categoryId?: string;
  monthlyAmount: number;
  effectiveFrom?: string;
  effectiveTo?: string;
}

interface MonthlyBudget {
  budgetId: string;
  categoryId?: string;
  categoryName?: string;
  categoryType?: 'income' | 'expense';
  parentCategoryId?: string;
  monthlyAmount: number;
  /** 조정을 걷어냈을 때 돌아갈 규칙 금액. 조정이 없으면 monthlyAmount와 같다. */
  ruleAmount?: number;
  usedAmount?: number;
  isOverridden: boolean;
  /** 이 달만 조정한 값의 id. 조정을 해제할 때 쓴다. */
  overrideId?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  hasChildren: boolean;
  isVirtualBudget?: boolean;
  type?: 'income' | 'expense';
}

interface BudgetStore {
  budgets: Budget[];
  monthlyBudgets: MonthlyBudget[];
  isLoading: boolean;

  setBudgets: (budgets: Budget[]) => void;
  setMonthlyBudgets: (budgets: MonthlyBudget[]) => void;

  fetchBudgets: (projectId: string) => Promise<void>;
  fetchMonthlyBudgets: (
    year: number,
    month: number,
    projectId: string,
    /** 가계 화면의 자산주인/고정 필터. 사용금액에 같은 조건을 건다. */
    filter?: EntryFilterQuery,
  ) => Promise<void>;
  createBudget: (data: BudgetDto.CreateRequest & { projectId: string }) => Promise<void>;
  updateBudget: (id: string, data: BudgetDto.UpdateRequest) => Promise<void>;
  /** fromMonth를 주면 그 달부터만 없앤다 (이전 달은 그대로). */
  deleteBudget: (id: string, fromMonth?: string) => Promise<void>;
  /** 프로젝트의 예산을 모두 지운다. 지운 개수를 돌려준다. */
  resetBudgets: (projectId: string) => Promise<number>;
}

export const useBudget = create<BudgetStore>((set) => ({
  budgets: [],
  monthlyBudgets: [],
  isLoading: false,

  setBudgets: (budgets) => set({ budgets }),
  setMonthlyBudgets: (monthlyBudgets) => set({ monthlyBudgets }),

  fetchBudgets: async (projectId) => {
    set({ isLoading: true });
    try {
      const budgets = await apiClient.getBudgets(projectId);
      set({ budgets: (budgets ?? []).map(normalizeBudget) });
    } catch (error) {
      console.error('Failed to fetch budgets:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  fetchMonthlyBudgets: async (year, month, projectId, filter) => {
    set({ isLoading: true });
    try {
      const monthlyBudgets = await apiClient.getBudgetForMonth(year, month, projectId, filter);
      set({ monthlyBudgets: (monthlyBudgets ?? []).map(normalizeBudget) });
    } catch (error) {
      console.error('Failed to fetch monthly budgets:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  /*
   * 아래 넷 중 **둘만 창구를 거친다.**
   *
   * 예산 한 줄을 정하는 일(만들기, 금액 바꾸기, 그 달만 조정하기)은 행 하나를 고치는
   * 조작이라 명령으로 실어 보낼 수 있다. 반대로 구간 편집('고른 달부터')과 초기화는
   * 범위를 질의해 여러 행을 다시 쓰므로, 며칠 뒤에 재생하면 그 사이 달라진 규칙들 위에서
   * 다른 결과가 나온다. 그런 것은 서버를 곧바로 부른다 (설계 문서의 D12).
   */
  createBudget: async (data) => {
    set({ isLoading: true });
    try {
      await settingsWritePort().setBudget({
        categoryId: data.categoryId ?? null,
        type: data.type ?? null,
        monthlyAmount: data.monthlyAmount,
        // 보고 있는 달. 구간으로 나뉜 규칙 중 어느 것을 고칠지 이 값이 정한다.
        yearMonth: data.yearMonth,
        // 빠뜨리면 서버가 그 사용자의 기본 프로젝트에 예산을 만든다.
        projectId: data.projectId,
      });
      // 목록 새로고침
      await useBudget.getState().fetchBudgets(data.projectId);
    } catch (error) {
      console.error('Failed to create budget:', error);
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  updateBudget: async (id, data) => {
    set({ isLoading: true });
    try {
      /*
       * 구간 편집은 창구에 없다. 여러 행을 다시 쓰는 조작이라 온라인에서만 한다 (D12).
       *
       * 금액이 없는 요청도 그쪽으로 보낸다. 창구는 "이 금액으로 정한다"는 뜻이라
       * 금액이 반드시 있어야 하고, 없는 것을 빈 문자열로 채우면 0원으로 적힌다.
       */
      if (data.applyMode === 'from' || data.monthlyAmount === undefined) {
        await apiClient.updateBudget(id, data);
      } else {
        await settingsWritePort().setBudget({ id, monthlyAmount: data.monthlyAmount });
      }
    } catch (error) {
      console.error('Failed to update budget:', error);
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  deleteBudget: async (id, fromMonth) => {
    set({ isLoading: true });
    try {
      await apiClient.deleteBudget(id, fromMonth);
    } catch (error) {
      console.error('Failed to delete budget:', error);
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  resetBudgets: async (projectId) => {
    set({ isLoading: true });
    try {
      const { deleted } = await apiClient.resetBudgets(projectId);
      set({ budgets: [], monthlyBudgets: [] });
      return deleted;
    } catch (error) {
      console.error('Failed to reset budgets:', error);
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },
}));
