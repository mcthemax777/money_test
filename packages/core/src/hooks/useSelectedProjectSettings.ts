import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_TIME_ZONE, isCurrencyCode, type CurrencyCode } from '@money/types';

import { homeDataPort } from '../data/home-port';
import { apiClient } from '../lib/api-client';
import { useApiError } from '../lib/api-error';
import { useProject, type Project } from '../store/project';
import { useMirrorVersion } from './useMirrorVersion';
import { useProjectAdmin, type ProjectResult } from './useProjectAdmin';

/** 고르기에 쓰는 구성원 한 사람. */
export interface PersonChoice {
  id: string;
  name: string;
}

/**
 * 설정 탭에 꺼내 둔 **지금 보는 가계부**의 값들 (2026-10-10 사용자 요청으로 프로젝트 관리에서 옮김).
 *
 * 기준 타임존·표시 통화는 가계부의 값이라 소유자만 바꾼다(서버도 같은 규칙으로 막는다).
 * 이용권은 가계부에 붙고 결제는 팝업이 맡는다. 구성원 중 나는 내 멤버십의 값이라 누구나 바꾼다.
 *
 * 웹과 앱의 설정 화면이 함께 쓴다. 고르는 모양(선택 상자, 팝업)만 각자 그린다.
 */
export function useSelectedProjectSettings(): {
  /** 지금 보는 가계부. 없으면(시작 화면 전) null 이고, 화면은 이 칸들을 그리지 않는다. */
  project: Project | null;
  isOwner: boolean;
  timezone: string;
  /** 모르는 통화 글자가 오면 null. 고른 것이 없는 것으로 그린다. */
  displayCurrency: CurrencyCode | null;
  ledgerCurrency: string;
  people: PersonChoice[];
  isSubmitting: boolean;
  setTimezone: (timezone: string) => Promise<ProjectResult>;
  setDisplayCurrency: (code: CurrencyCode) => Promise<ProjectResult>;
  /** 빈 값이 "지정 안 함"이다. */
  setMyPerson: (personId: string) => Promise<ProjectResult>;
  /** 프로젝트 목록을 다시 받는다. 이용권 결제가 반영됐는지 볼 때 쓴다. */
  reloadProjects: () => Promise<ProjectResult>;
} {
  const { messageOf } = useApiError();
  const admin = useProjectAdmin();
  const mirrorVersion = useMirrorVersion();
  const project = useProject(
    (state) => state.projects.find((item) => item.id === state.selectedProjectId) ?? null,
  );
  const projectId = project?.id ?? null;

  const [people, setPeople] = useState<PersonChoice[]>([]);
  const [isSavingPerson, setIsSavingPerson] = useState(false);

  /*
   * 구성원 목록. 거래 화면과 같은 창구로 받아 앱에서는 끊겨 있어도 사본에서 읽는다.
   * 다른 가계부로 바꾸는 사이 늦게 온 답이 새 가계부의 목록을 덮지 않게 막는다.
   */
  useEffect(() => {
    if (!projectId) {
      setPeople([]);
      return;
    }
    let cancelled = false;
    homeDataPort()
      .getPeople(projectId)
      .then((rows) => {
        if (!cancelled) setPeople((rows ?? []).map((row) => ({ id: row.id, name: row.name })));
      })
      .catch(() => {
        // 못 받으면 "지정 안 함"만 남는다. 지금 고른 사람의 이름은 아래 값 표시가 비워 둔다.
        if (!cancelled) setPeople([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, mirrorVersion]);

  const { update, reload } = admin;

  const setTimezone = useCallback(
    (timezone: string): Promise<ProjectResult> =>
      projectId
        ? update(projectId, { timezone }, 'projects.timezoneFailed')
        : Promise.resolve({ ok: true }),
    [projectId, update],
  );

  const setDisplayCurrency = useCallback(
    (code: CurrencyCode): Promise<ProjectResult> =>
      projectId
        ? update(projectId, { displayCurrency: code }, 'projects.currencyFailed')
        : Promise.resolve({ ok: true }),
    [projectId, update],
  );

  /** "나"는 프로젝트 목록에 붙어 오는 값이라, 바꾼 뒤 목록을 다시 받아야 화면이 따라온다. */
  const setMyPerson = useCallback(
    async (personId: string): Promise<ProjectResult> => {
      if (!projectId) return { ok: true };
      try {
        setIsSavingPerson(true);
        await apiClient.setMyPerson(projectId, personId || null);
        await reload();
        return { ok: true };
      } catch (error) {
        return { ok: false, message: messageOf(error, 'projects.meFailed', 'online.onlyOnline') };
      } finally {
        setIsSavingPerson(false);
      }
    },
    [projectId, reload, messageOf],
  );

  const rawCurrency = project?.displayCurrency ?? project?.ledgerCurrency;

  return {
    project,
    isOwner: project?.role === 'owner',
    timezone: project?.timezone ?? DEFAULT_TIME_ZONE,
    displayCurrency: isCurrencyCode(rawCurrency) ? rawCurrency : null,
    ledgerCurrency: project?.ledgerCurrency ?? 'KRW',
    people,
    isSubmitting: admin.isSubmitting || isSavingPerson,
    setTimezone,
    setDisplayCurrency,
    setMyPerson,
    reloadProjects: reload,
  };
}
