import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiClient } from '@/lib/api-client';
import { clearAuthTokens, getAccessToken, getRefreshToken, saveAuthTokens } from '@/lib/auth-tokens';

interface User {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  defaultProjectId?: string;
  /** 화면 언어. 서버가 주는 값이고, 실제로 화면에 쓰는 것은 useLocaleStore다. */
  locale?: string;
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

/**
 * 서버가 준 언어를 화면에 반영한다.
 *
 * 스토어를 정적으로 import하지 않는 것은 다른 스토어들과 같은 이유다. 로그인
 * 스토어가 화면 스토어를 붙들면 서로를 부르는 고리가 생기기 쉽다.
 */
async function applyUserLocale(locale: unknown) {
  const { useLocaleStore } = await import('./locale');
  useLocaleStore.getState().applyServerLocale(locale);
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
      saveAuthTokens(response.accessToken, response.refreshToken);
      // 이 계정이 고른 말로 화면을 맞춘다. 앞 사용자가 남긴 언어가 이어지면 안 된다.
      applyUserLocale(response.user?.locale);
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
      const refreshToken = getRefreshToken();
      await apiClient.logout(refreshToken);
    } finally {
      clearAuthTokens();
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

      // 기관 목록 캐시도 비운다. 로그아웃은 페이지를 새로 읽지 않아
      // 모듈 캐시가 그대로 남고, selectedProjectId가 null로 돌아가면
      // 다음 사용자가 같은 캐시 키를 써서 이전 사용자의 기관 이름을 보게 된다.
      const { invalidateInstitutions } = await import('@/hooks/useInstitutions');
      invalidateInstitutions();
    }
  },

  loadUser: async () => {
    try {
      const token = getAccessToken();
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
      applyUserLocale(user?.locale);
      set({ user, isAuthenticated: true, isInitializing: false });
    } catch {
      clearAuthTokens();
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
