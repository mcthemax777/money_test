'use client';

import { useEffect } from 'react';
import { useAuth } from '@money/core/store/auth';
import { getAccessToken } from '@money/core/lib/auth-tokens';

export function AuthInitializer() {
  useEffect(() => {
    const initAuth = async () => {
      console.log('[AuthInitializer] Initializing auth...');

      // 쿠키에서 토큰 확인
      const token = getAccessToken();
      console.log('[AuthInitializer] Token from cookie:', token ? 'exists' : 'not found');

      // 토큰이 있으면 사용자 정보 로드
      if (token) {
        const loadUser = useAuth.getState().loadUser;
        await loadUser();
      } else {
        // 토큰이 없으면 로그아웃 상태로 설정
        useAuth.setState({
          user: null,
          isAuthenticated: false,
          isInitializing: false,
        });
      }

      const state = useAuth.getState();
      console.log('[AuthInitializer] Auth state after load:', {
        isAuthenticated: state.isAuthenticated,
        isInitializing: state.isInitializing,
        user: state.user?.email,
      });
    };
    initAuth();
  }, []);

  return null;
}
