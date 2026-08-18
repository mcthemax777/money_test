import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import Cookie from 'js-cookie';
import { apiClient } from '@/lib/api-client';

interface User {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  defaultProjectId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface ProjectInitialData {
  project: {
    id: string;
    name: string;
    description?: string;
  };
  cards: any[];
  accounts: any[];
  categories: any[];
  people: any[];
  recentTransactions: any[];
  budgets: any[];
}

interface AuthStore {
  user: User | null;
  defaultProjectData: ProjectInitialData | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isInitializing: boolean;
  signInWithGoogle: (idToken: string) => Promise<void>;
  setDefaultProject: (projectId: string) => Promise<ProjectInitialData | null>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
}

export const useAuth = create<AuthStore>()(
  persist(
    (set) => ({
  user: null,
  defaultProjectData: null,
  isLoading: false,
  isAuthenticated: false,
  isInitializing: true,

  signInWithGoogle: async (idToken) => {
    set({ isLoading: true });
    try {
      // 이전 사용자의 캐시 상태 초기화 (보안)
      const { useProject } = await import('./project');
      const { useUserFilter } = await import('./user-filter');
      useProject.getState().setSelectedProjectId(null);
      useProject.getState().setProjects([]);
      useUserFilter.getState().setSelectedPersonIds([]);
      useUserFilter.getState().setPeople([]);

      const response = await apiClient.signInWithGoogle(idToken);
      Cookie.set('accessToken', response.accessToken, { expires: 7 });
      Cookie.set('refreshToken', response.refreshToken, { expires: 30 });
      set({
        user: response.user,
        defaultProjectData: response.defaultProjectData,
        isAuthenticated: true,
        isInitializing: false,
      });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  setDefaultProject: async (projectId: string) => {
    set({ isLoading: true });
    try {
      const response = await apiClient.setDefaultProject(projectId);
      console.log('[Auth] Set default project response:', response);
      set({
        user: response.user,
        defaultProjectData: response.defaultProjectData,
      });
      return response.defaultProjectData;
    } catch (error) {
      set({ isLoading: false });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  logout: async () => {
    set({ isLoading: true });
    try {
      const refreshToken = Cookie.get('refreshToken');
      await apiClient.logout(refreshToken);
    } finally {
      Cookie.remove('accessToken');
      Cookie.remove('refreshToken');
      set({
        user: null,
        defaultProjectData: null,
        isAuthenticated: false,
        isLoading: false,
      });

      // 모든 다른 스토어 초기화 (보안: 이전 사용자 데이터 제거)
      const { useProject } = await import('./project');
      const { useUserFilter } = await import('./user-filter');
      useProject.getState().setSelectedProjectId(null);
      useProject.getState().setProjects([]);
      useUserFilter.getState().setSelectedPersonIds([]);
      useUserFilter.getState().setPeople([]);
    }
  },

  loadUser: async () => {
    try {
      const token = Cookie.get('accessToken');
      if (!token) {
        set({
          user: null,
          defaultProjectData: null,
          isAuthenticated: false,
          isInitializing: false,
        });
        return;
      }

      const user = await apiClient.getProfile();
      set({ user, isAuthenticated: true, isInitializing: false });
    } catch {
      Cookie.remove('accessToken');
      Cookie.remove('refreshToken');
      set({
        user: null,
        defaultProjectData: null,
        isAuthenticated: false,
        isInitializing: false,
      });
    }
  },
    }),
    {
      name: 'auth-store',
      partialize: (state) => ({
        user: state.user,
        defaultProjectData: state.defaultProjectData,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
