'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { apiClient } from '@money/core/lib/api-client';
import { useAuth } from '@money/core/store/auth';
import { useProject } from '@money/core/store/project';

/**
 * 화면이 프로젝트 하나를 고른 상태로 시작하게 만든다.
 *
 *   - 참여 중인 가계부가 없으면 시작 화면(`/start`)으로 보낸다. 그러지 않으면 아무것도
 *     불러올 수 없는 채로 로딩 상태에 갇힌다. 첫 로그인 때 서버가 가계부를 만들어 주지
 *     않으므로(`auth.service`) 가입한 사람은 모두 한 번 그 화면을 지난다.
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
          router.push('/start');
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
