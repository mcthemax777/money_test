import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { persistStorage } from '../lib/persist-storage';
import { apiClient } from '../lib/api-client';
import { clearAuthTokens, getAccessToken, getRefreshToken, saveAuthTokens } from '../lib/auth-tokens';
import { isOfflineError } from '../lib/offline-error';
import { clearLocalMirror } from '../data/mirror-teardown';

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
    (set, get) => ({
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

      const previousUserId = get().user?.id;
      const response = await apiClient.signInWithGoogle(idToken);
      saveAuthTokens(response.accessToken, response.refreshToken);

      /*
       * 앞 사람의 기기 사본을 지운다.
       *
       * 로그아웃을 거쳐 들어오면 아래 logout 이 이미 지웠다. 여기서 다시 보는 것은
       * 토큰이 만료되어(401) 세션만 끊긴 뒤 다른 계정으로 들어오는 길이 있기 때문이다.
       * 그 길에서는 사본을 일부러 남겨 두므로(D10), 주인이 바뀌는 이 자리가 마지막 문이다.
       */
      if (previousUserId && previousUserId !== response.user?.id) {
        await clearLocalMirror();
      }
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
      const { invalidateInstitutions } = await import('../lib/institutions');
      invalidateInstitutions();

      /*
       * 기기 사본도 버린다. 스토어만 비우면 화면에서 사라질 뿐 파일 안에는 이 사람의
       * 거래가 그대로 남는다. 다음에 앱을 여는 사람이 그것을 읽는다.
       */
      await clearLocalMirror();
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
    } catch (error) {
      /*
       * 서버에 닿지 못한 것은 로그아웃이 아니다.
       *
       * 저장해 둔 사용자로 그대로 들어간다. 기기 사본이 있으면 화면도 그려진다.
       * 여기서 토큰까지 지우면 비행기 모드로 앱을 열 때마다 로그인 화면이 뜨고,
       * 다시 접속해도 리프레시 토큰이 없어 처음부터 로그인해야 한다.
       *
       * 서버가 거절한 경우(401)는 그대로 정리한다. 그때는 정말로 세션이 끝났다.
       */
      if (isOfflineError(error)) {
        set({ isInitializing: false });
        return;
      }

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
      storage: createJSONStorage(() => persistStorage),
      partialize: (state) => ({
        user: state.user,
        defaultProjectData: state.defaultProjectData,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
