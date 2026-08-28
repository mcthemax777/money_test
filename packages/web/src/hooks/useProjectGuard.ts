'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/store/auth';
import { useProject } from '@/store/project';

/**
 * 화면이 프로젝트 하나를 고른 상태로 시작하게 만든다.
 *
 *   - 참여 중인 프로젝트가 없으면 생성 화면으로 보낸다. 그러지 않으면 아무것도
 *     불러올 수 없는 채로 로딩 상태에 갇힌다.
 *   - 저장된 선택이 지워졌거나 탈퇴한 프로젝트를 가리키면 첫 프로젝트로 되돌린다.
 *
 * 홈과 가계가 각자 들고 있던 코드다. 로그인 직후 처음 열리는 화면이 둘 중 무엇이든
 * 같은 판단을 해야 해서 한 곳으로 모은다.
 */
export function useProjectGuard(): string | null {
  const router = useRouter();
  const { loadUser } = useAuth();
  const { selectedProjectId } = useProject();

  useEffect(() => {
    const initializeProject = async () => {
      await loadUser();

      try {
        const projects = await apiClient.getMyProjects();
        const { setSelectedProjectId } = useProject.getState();

        if (!projects || projects.length === 0) {
          setSelectedProjectId(null);
          router.push('/settings/projects');
          return;
        }

        const isSelectionValid =
          selectedProjectId && projects.some((p: { id: string }) => p.id === selectedProjectId);

        if (!isSelectionValid) {
          setSelectedProjectId(projects[0].id);
        }
      } catch (err) {
        console.error('프로젝트 로드 실패:', err);
      }
    };

    initializeProject();
  }, [loadUser, selectedProjectId, router]);

  return selectedProjectId;
}
