'use client';

import { useState } from 'react';

import { useTranslation } from '@/lib/i18n';
import { useAuth } from '@/store/auth';
import { useProject } from '@/store/project';
import { useUserFilter } from '@/store/user-filter';

/**
 * 보고 있는 프로젝트 바꾸기.
 *
 * 사이드바와 좁은 화면의 위쪽 막대가 함께 쓴다. 프로젝트를 바꾸면 화면에 떠 있는
 * 값이 전부 다른 프로젝트 것이 되므로, 누르자마자 바꾸지 않고 한 번 묻는다.
 */
export function useProjectSwitch() {
  const { t } = useTranslation();
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);
  const [isChanging, setIsChanging] = useState(false);
  const { selectedProjectId, setSelectedProjectId } = useProject();
  const { setDefaultProject } = useAuth();

  /** 바꾸겠느냐고 묻는다. 이미 보고 있는 프로젝트면 아무 일도 하지 않는다. */
  const request = (projectId: string) => {
    if (selectedProjectId === projectId) return;
    setPendingProjectId(projectId);
  };

  const cancel = () => setPendingProjectId(null);

  const confirm = async () => {
    if (!pendingProjectId) return;

    try {
      setIsChanging(true);
      const projectData = await setDefaultProject(pendingProjectId);

      if (projectData) {
        /*
         * 사람 목록은 프로젝트 것이므로 비운다. 가계 화면이 다시 채운다.
         *
         * 선택(selectedPersonIds)은 여기서 건드리지 않는다. 스토어가 filterProjectId로
         * 소속을 들고 있어 가계 화면이 알아서 맞춘다. 예전에는 여기서 빈 배열로
         * 비웠는데 personFilterTouched는 그대로여서, 그 빈 배열이 "사용자가 전부
         * 해제함"으로 읽혀 전환 직후 화면이 통째로 비었다.
         */
        useUserFilter.getState().setPeople([]);
        setSelectedProjectId(pendingProjectId);
      }

      setPendingProjectId(null);
    } catch (err) {
      console.error('프로젝트 변경 실패:', err);
      alert(t('projectSwitch.failed'));
    } finally {
      setIsChanging(false);
    }
  };

  return { isAsking: pendingProjectId !== null, isChanging, request, confirm, cancel };
}
