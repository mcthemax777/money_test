import { useEffect } from 'react';

import { apiClient } from '../lib/api-client';
import { useAuth } from '../store/auth';
import { useProject } from '../store/project';

/**
 * 화면이 프로젝트 하나를 고른 상태로 시작하게 만든다.
 *
 * 목록을 받아 스토어에 넣고, 고른 것이 없거나 없어진 프로젝트를 가리키면 첫 번째로
 * 되돌린다. 웹의 AppShell 과 useProjectGuard 가 각자 하던 일이고, 앱도 같은 판단이
 * 필요해 한 곳으로 모았다.
 *
 * 프로젝트가 하나도 없을 때 어디로 보낼지는 여기서 정하지 않는다. 웹은 주소를 옮기고
 * 앱은 화면을 갈아 끼우므로, `hasNoProject` 만 알려 주고 판단은 부르는 쪽에 맡긴다.
 */
export function useProjectBootstrap(): {
  selectedProjectId: string | null;
  /** 목록을 받아 봤는데 참여 중인 프로젝트가 없다. 만들라고 안내할 자리다. */
  hasNoProject: boolean;
  /** 아직 목록을 못 받았다. 이때의 hasNoProject 는 "없다"가 아니라 "모른다"다. */
  isLoading: boolean;
} {
  const isAuthenticated = useAuth((state) => state.isAuthenticated);
  const projects = useProject((state) => state.projects);
  const selectedProjectId = useProject((state) => state.selectedProjectId);
  const setProjects = useProject((state) => state.setProjects);
  const setSelectedProjectId = useProject((state) => state.setSelectedProjectId);

  useEffect(() => {
    if (!isAuthenticated) return;

    let cancelled = false;

    const load = async () => {
      try {
        const rows = (await apiClient.getMyProjects()) ?? [];
        if (cancelled) return;

        setProjects(rows);

        /*
         * 고른 것이 그 목록에 없으면 첫 프로젝트를 본다.
         *
         * 저장된 선택이 탈퇴했거나 지워진 프로젝트를 가리킬 수 있다. 그대로 두면
         * 모든 조회가 남의 프로젝트 id 로 나가 화면이 통째로 빈다.
         */
        const current = useProject.getState().selectedProjectId;
        const isValid = current && rows.some((row: { id: string }) => row.id === current);
        if (!isValid) setSelectedProjectId(rows[0]?.id ?? null);
      } catch (error) {
        // 목록을 못 받아도 화면은 떠야 한다. 저장해 둔 선택으로 그린다.
        console.error('프로젝트 목록 조회 실패:', error);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
    // 목록은 로그인 상태가 바뀔 때만 받는다. 화면을 옮길 때마다 받으면 요청이 겹친다.
  }, [isAuthenticated, setProjects, setSelectedProjectId]);

  return {
    selectedProjectId,
    hasNoProject: isAuthenticated && projects.length === 0,
    isLoading: isAuthenticated && projects.length === 0 && selectedProjectId === null,
  };
}
