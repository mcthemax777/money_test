'use client';

import { useEffect } from 'react';

import { notifyMirrorChanged } from '@money/core/data/mirror-events';
import { openSyncEvents, type StreamingFetch } from '@money/core/data/sync-events';
import { apiClient } from '@money/core/lib/api-client';
import { getAccessToken } from '@money/core/lib/auth-tokens';
import { useAuth } from '@money/core/store/auth';
import { useProject } from '@money/core/store/project';

/**
 * 다른 사람이 고친 것을 이 화면에 바로 들여온다.
 *
 * 서버는 "이 프로젝트가 몇 번이 되었다"만 보낸다. 그 신호를 받으면 화면이 다시 읽게
 * 알릴 뿐, 값은 지금까지처럼 각 훅이 서버에서 받아 온다. 그래서 알림이 끊겨 있어도
 * 화면이 틀리지 않는다 -- 다음에 화면을 열 때까지 늦어질 뿐이다.
 *
 * 지금 따라 도는 화면은 홈·가계·거래다(useMirrorVersion 을 의존성에 둔 훅들). 계좌·예산
 * 같은 설정 화면은 아직 각자 읽으므로 신호를 받아도 그대로다. 다시 열면 최신이다.
 */
export function LiveSync() {
  const isAuthenticated = useAuth((state) => state.isAuthenticated);
  const projectId = useProject((state) => state.selectedProjectId);

  useEffect(() => {
    if (!isAuthenticated || !projectId) return;

    return openSyncEvents({
      baseUrl: apiClient.baseUrl,
      projectId,
      // 붙을 때마다 부른다. 만료된 토큰으로 붙으면 401 로 끊기고 다시 붙기를 되풀이한다.
      getToken: async () => {
        await apiClient.ensureFreshToken();
        return getAccessToken();
      },
      /*
       * 브라우저의 fetch 는 스트리밍을 지원한다. EventSource 를 쓰지 않는 이유는
       * 헤더를 붙일 수 없어 토큰을 주소에 실어야 하기 때문이다(접근 로그에 남는다).
       */
      fetchFn: fetch as unknown as StreamingFetch,
      onVersion: () => notifyMirrorChanged(),
    });
  }, [isAuthenticated, projectId]);

  return null;
}
