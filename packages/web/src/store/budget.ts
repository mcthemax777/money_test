import { create } from 'zustand';
import { apiClient } from '@/lib/api-client';

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
  parentCategoryId?: string;
  monthlyAmount: number;
  isOverridden: boolean;
  hasChildren: boolean;
  isVirtualBudget?: boolean;
}

interface BudgetStore {
  budgets: Budget[];
  monthlyBudgets: MonthlyBudget[];
  isLoading: boolean;

  setBudgets: (budgets: Budget[]) => void;
  setMonthlyBudgets: (budgets: MonthlyBudget[]) => void;

  fetchBudgets: (projectId: string) => Promise<void>;
  fetchMonthlyBudgets: (year: number, month: number, projectId: string) => Promise<void>;
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
      set({ budgets });
    } catch (error) {
      console.error('Failed to fetch budgets:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  fetchMonthlyBudgets: async (year, month, projectId) => {
    set({ isLoading: true });
    try {
      const monthlyBudgets = await apiClient.getBudgetForMonth(year, month, projectId);
      set({ monthlyBudgets });
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
