import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import Cookie from 'js-cookie';
import { apiClient } from '@/lib/api-client';

interface User {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface AuthStore {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isInitializing: boolean;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
}

export const useAuth = create<AuthStore>(
  persist(
    (set) => ({
  user: null,
  isLoading: false,
  isAuthenticated: false,
  isInitializing: true,

  signUp: async (email, password, name) => {
    set({ isLoading: true });
    try {
      const response = await apiClient.signUp(email, password, name);
      console.log('[Auth] Sign up response:', response);
      Cookie.set('accessToken', response.accessToken, { expires: 7 });
      Cookie.set('refreshToken', response.refreshToken, { expires: 30 });
      console.log('[Auth] Tokens set:', {
        accessToken: Cookie.get('accessToken') ? 'saved' : 'failed',
        refreshToken: Cookie.get('refreshToken') ? 'saved' : 'failed',
      });
      set({ user: response.user, isAuthenticated: true, isInitializing: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  signIn: async (email, password) => {
    set({ isLoading: true });
    try {
      const response = await apiClient.signIn(email, password);
      console.log('[Auth] Sign in response:', response);
      Cookie.set('accessToken', response.accessToken, { expires: 7 });
      Cookie.set('refreshToken', response.refreshToken, { expires: 30 });
      console.log('[Auth] Tokens set:', {
        accessToken: Cookie.get('accessToken') ? 'saved' : 'failed',
        refreshToken: Cookie.get('refreshToken') ? 'saved' : 'failed',
      });
      set({ user: response.user, isAuthenticated: true, isInitializing: false });
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
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  loadUser: async () => {
    try {
      const token = Cookie.get('accessToken');
      if (!token) {
        set({ user: null, isAuthenticated: false, isInitializing: false });
        return;
      }

      const user = await apiClient.getProfile();
      set({ user, isAuthenticated: true, isInitializing: false });
    } catch {
      Cookie.remove('accessToken');
      Cookie.remove('refreshToken');
      set({ user: null, isAuthenticated: false, isInitializing: false });
    }
  },
    }),
    {
      name: 'auth-store',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
