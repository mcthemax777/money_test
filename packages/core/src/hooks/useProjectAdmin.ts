import { useCallback, useState } from 'react';
import type { CurrencyCode } from '@money/types';

import { settingsWritePort } from '../data/settings-write-port';
import { apiClient } from '../lib/api-client';
import { track } from '../lib/analytics';
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
    fallbackKey?: MessageKey,
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
        track({ name: 'project_create' });
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

  /**
   * 이름·설명·타임존·표시 통화. 소유자만 고칠 수 있고 서버도 같은 규칙으로 막는다.
   *
   * `fallbackKey` 는 서버가 이유를 주지 않았을 때 적을 문장이다. 무엇을 고치다 실패했는지
   * 화면이 알고 있으므로("타임존 변경에 실패했습니다") 그 문장을 넘겨받는다.
   */
  const update = useCallback(
    async (
      projectId: string,
      body: { name?: string; description?: string | null; timezone?: string; displayCurrency?: CurrencyCode },
      fallbackKey: MessageKey = 'projects.updateFailed',
    ): Promise<ProjectResult> => {
      try {
        setIsSubmitting(true);
        /*
         * 창구를 거친다. 앱은 고른 가계부의 이름·설명·표시 통화를 명령으로 쌓아 끊겨 있어도
         * 된다 (타임존은 서버로 곧바로). 쌓였으면 목록(온라인 전용)을 다시 받지 않고 들고
         * 있는 줄을 고친다 -- 받으려 들면 끊긴 동안 실패로 보인다.
         */
        const { queued } = await settingsWritePort().updateProject(projectId, body);
        if (queued) {
          setProjects(
            useProject
              .getState()
              .projects.map((project) =>
                project.id === projectId
                  ? {
                      ...project,
                      ...(body.name !== undefined ? { name: body.name } : {}),
                      // 목록의 설명은 "없음"을 비워서 적는다 (null 이 아니라).
                      ...(body.description !== undefined
                        ? { description: body.description ?? undefined }
                        : {}),
                      ...(body.displayCurrency !== undefined
                        ? { displayCurrency: body.displayCurrency }
                        : {}),
                    }
                  : project,
              ),
          );
        } else {
          await reload();
        }
        return { ok: true };
      } catch (error) {
        return { ok: false, message: messageOf(error, fallbackKey) };
      } finally {
        setIsSubmitting(false);
      }
    },
    [messageOf, reload, setProjects],
  );

  /**
   * 프로젝트에서 나가거나(구성원) 지운다(소유자).
   *
   * 보고 있던 프로젝트가 사라졌으면 남은 프로젝트 중 첫 번째를 고른다 (2026-10-09 사용자
   * 요청). 없는 프로젝트 id 로 조회가 나가면 화면이 통째로 비고, 비워만 두면 메뉴가 계속
   * "프로젝트 없음"으로 남는다. 남은 것이 없을 때만 비운다.
   */
  const removeOrLeave = useCallback(
    async (projectId: string, action: 'delete' | 'leave'): Promise<ProjectResult> => {
      try {
        setIsSubmitting(true);
        if (action === 'delete') await apiClient.deleteProject(projectId);
        else await apiClient.leaveProject(projectId);

        if (selectedProjectId === projectId) setSelectedProjectId(null);
        const reloaded = await reload();
        if (selectedProjectId === projectId) {
          // 다시 받은 목록에서 고른다. 다시 받지 못했으면 들고 있던 목록에서 지운 것만 뺀다.
          const remaining = reloaded.ok
            ? useProject.getState().projects
            : projects.filter((project) => project.id !== projectId);
          setSelectedProjectId(remaining.find((project) => project.id !== projectId)?.id ?? null);
        }
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
    [messageOf, projects, reload, selectedProjectId, setSelectedProjectId],
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
