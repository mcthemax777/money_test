import { useCallback, useState } from 'react';
import type { CurrencyCode } from '@money/types';

import { apiClient } from '../lib/api-client';
import { useApiError } from '../lib/api-error';
import { translate, type MessageKey } from '../lib/i18n';
import { useLocaleStore } from '../store/locale';
import { useProject, type Project } from '../store/project';

/** 손질의 결과. 실패하면 화면에 그대로 적을 문장이 함께 온다. */
export type ProjectResult = { ok: true } | { ok: false; message: string };

/**
 * 프로젝트를 만들고 고치고 떠나는 일.
 *
 * 목록 자체는 스토어(useProject)가 들고 있다. 여기서는 서버에 반영하고 그 목록을
 * 다시 받아 맞춘다. 웹의 프로젝트 관리 화면과 앱이 같은 규칙을 쓰게 하는 자리다.
 */
export function useProjectAdmin(): {
  projects: Project[];
  selectedProjectId: string | null;
  select: (projectId?: string | null) => void;
  isLoading: boolean;
  isSubmitting: boolean;
  reload: () => Promise<ProjectResult>;
  create: (name: string, description?: string) => Promise<ProjectResult>;
  update: (
    projectId: string,
    body: { name?: string; description?: string | null; timezone?: string; displayCurrency?: CurrencyCode },
  ) => Promise<ProjectResult>;
  removeOrLeave: (projectId: string, action: 'delete' | 'leave') => Promise<ProjectResult>;
} {
  const { messageOf } = useApiError();
  const locale = useLocaleStore((state) => state.locale);
  const say = useCallback((key: MessageKey) => translate(locale, key), [locale]);

  const projects = useProject((state) => state.projects);
  const selectedProjectId = useProject((state) => state.selectedProjectId);
  const setProjects = useProject((state) => state.setProjects);
  const setSelectedProjectId = useProject((state) => state.setSelectedProjectId);

  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const reload = useCallback(async (): Promise<ProjectResult> => {
    try {
      setIsLoading(true);
      setProjects((await apiClient.getMyProjects()) ?? []);
      return { ok: true };
    } catch (error) {
      console.error('프로젝트 목록 조회 실패:', error);
      return { ok: false, message: say('projects.loadFailed') };
    } finally {
      setIsLoading(false);
    }
  }, [say, setProjects]);

  /**
   * 새 프로젝트.
   *
   * 고른 프로젝트가 없던 상태(첫 프로젝트이거나 전부 지운 뒤)라면 방금 만든 것을 바로
   * 고른다. 그러지 않으면 메뉴가 계속 "프로젝트 없음"으로 남는다.
   */
  const create = useCallback(
    async (name: string, description?: string): Promise<ProjectResult> => {
      if (!name.trim()) return { ok: false, message: say('projects.nameRequired') };

      try {
        setIsSubmitting(true);
        const created = await apiClient.createProject(name, description);
        if (!selectedProjectId && created?.id) setSelectedProjectId(created.id);
        await reload();
        return { ok: true };
      } catch (error) {
        return { ok: false, message: messageOf(error, 'projects.createFailed') };
      } finally {
        setIsSubmitting(false);
      }
    },
    [messageOf, reload, say, selectedProjectId, setSelectedProjectId],
  );

  /** 이름·설명·타임존·표시 통화. 소유자만 고칠 수 있고 서버도 같은 규칙으로 막는다. */
  const update = useCallback(
    async (
      projectId: string,
      body: { name?: string; description?: string | null; timezone?: string; displayCurrency?: CurrencyCode },
    ): Promise<ProjectResult> => {
      try {
        setIsSubmitting(true);
        await apiClient.updateProject(projectId, body);
        await reload();
        return { ok: true };
      } catch (error) {
        return { ok: false, message: messageOf(error, 'projects.updateFailed') };
      } finally {
        setIsSubmitting(false);
      }
    },
    [messageOf, reload],
  );

  /**
   * 프로젝트에서 나가거나(구성원) 지운다(소유자).
   *
   * 보고 있던 프로젝트가 사라졌으면 고른 것을 비운다. 없는 프로젝트 id 로 조회가
   * 나가면 화면이 통째로 빈다.
   */
  const removeOrLeave = useCallback(
    async (projectId: string, action: 'delete' | 'leave'): Promise<ProjectResult> => {
      try {
        setIsSubmitting(true);
        if (action === 'delete') await apiClient.deleteProject(projectId);
        else await apiClient.leaveProject(projectId);

        if (selectedProjectId === projectId) setSelectedProjectId(null);
        await reload();
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          message: messageOf(
            error,
            action === 'delete' ? 'projects.deleteFailed' : 'projects.leaveFailed',
          ),
        };
      } finally {
        setIsSubmitting(false);
      }
    },
    [messageOf, reload, selectedProjectId, setSelectedProjectId],
  );

  return {
    projects,
    selectedProjectId,
    select: setSelectedProjectId,
    isLoading,
    isSubmitting,
    reload,
    create,
    update,
    removeOrLeave,
  };
}
