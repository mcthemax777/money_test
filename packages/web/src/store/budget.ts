import { create } from 'zustand';
import type { EntryFilterQuery } from '@money/types';
import { apiClient } from '@/lib/api-client';
import { toNumber } from '@/lib/money';

/**
 * 서버는 금액을 문자열로 준다 (Decimal 직렬화).
 * 예산 화면은 비교와 나눗셈을 하므로 스토어에 들어올 때 숫자로 바꾼다.
 *
 * 문자열 그대로 두면 `"3000" > "10000"` 이 true가 되어(첫 글자 비교)
 * 진행률이 101%로 나오는 식의 조용한 오류가 난다.
 * 예산은 계획 금액이라 KRW 범위에서 double 정밀도로 충분하다.
 */
function normalizeBudget<T extends { monthlyAmount?: unknown; usedAmount?: unknown }>(row: T) {
  return {
    ...row,
    monthlyAmount: toNumber(row.monthlyAmount as string),
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
  usedAmount?: number;
  isOverridden: boolean;
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
  createBudget: (data: any) => Promise<void>;
  updateBudget: (id: string, data: any) => Promise<void>;
  deleteBudget: (id: string) => Promise<void>;
  createOverride: (data: any) => Promise<void>;
  deleteOverride: (id: string) => Promise<void>;
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

  createBudget: async (data) => {
    set({ isLoading: true });
    try {
      await apiClient.createBudget(data);
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
      await apiClient.updateBudget(id, data);
    } catch (error) {
      console.error('Failed to update budget:', error);
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  deleteBudget: async (id) => {
    set({ isLoading: true });
    try {
      await apiClient.deleteBudget(id);
    } catch (error) {
      console.error('Failed to delete budget:', error);
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  createOverride: async (data) => {
    set({ isLoading: true });
    try {
      await apiClient.createBudgetOverride(data);
    } catch (error) {
      console.error('Failed to create override:', error);
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  deleteOverride: async (id) => {
    set({ isLoading: true });
    try {
      await apiClient.deleteBudgetOverride(id);
    } catch (error) {
      console.error('Failed to delete override:', error);
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },
}));
