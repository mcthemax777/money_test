'use client';

import { useEffect } from 'react';
import { useAuth } from '@money/core/store/auth';
import { apiClient } from '@money/core/lib/api-client';
import { clearLegacyTokens, hasSession, readLegacyRefreshToken } from '@money/core/lib/auth-tokens';

export function AuthInitializer() {
  useEffect(() => {
    const initAuth = async () => {
      // 쿠키 세션 이전에 스크립트 쿠키에 담아 둔 토큰이 있으면 한 번 갱신해 HttpOnly 쿠키로 옮긴다
      // (2026-10-16 -- 배포했다고 모두가 다시 로그인하지 않게). 끝난 토큰이면 로그인 화면으로 간다.
      // 서버에 닿지 못했으면 옛 쿠키를 남겨 다음에 다시 옮긴다.
      const legacy = readLegacyRefreshToken();
      if (legacy) {
        const outcome = hasSession() ? 'migrated' : await apiClient.migrateLegacySession(legacy);
        if (outcome !== 'offline') clearLegacyTokens();
      }

      // 로그인했는지는 서버가 함께 내린 표시 쿠키로 본다(토큰은 스크립트가 읽을 수 없다).
      if (hasSession()) {
        await useAuth.getState().loadUser();
      } else {
        useAuth.setState({
          user: null,
          isAuthenticated: false,
          isInitializing: false,
        });
      }
    };
    initAuth();
  }, []);

  return null;
}
