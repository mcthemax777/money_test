import { create } from 'zustand';
import { apiClient } from '@/lib/api-client';

export interface Category {
  id: string;
  name: string;
  type: 'income' | 'expense';
  level: number;
  parentId?: string | null;
  icon?: string;
  isDefault?: boolean;
  isActive?: boolean;
}

interface CategoryStore {
  categories: Category[];
  isLoading: boolean;

  setCategories: (categories: Category[]) => void;
  fetchCategories: (projectId: string, type?: 'income' | 'expense') => Promise<void>;
}

export const useCategory = create<CategoryStore>((set) => ({
  categories: [],
  isLoading: false,

  setCategories: (categories) => set({ categories }),

  fetchCategories: async (projectId, type) => {
    set({ isLoading: true });
    try {
      const categories = await apiClient.getCategories(projectId, type);
      set({ categories });
    } catch (error) {
      console.error('Failed to fetch categories:', error);
    } finally {
      set({ isLoading: false });
    }
  },
}));
