import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { persistStorage } from '../lib/persist-storage';
import { DEFAULT_TIME_ZONE, isCurrencyCode, type CurrencyCode } from '@money/types';

export interface Project {
  id: string;
  name: string;
  description?: string;
  projectKey?: string | null; // 다른 사용자가 검색해 가입 요청할 때 쓰는 공유용 키
  role: 'owner' | 'editor' | 'viewer';
  /** 집계 기준 타임존. 날짜 입력과 표시를 이 기준으로 해석한다. */
  timezone?: string;
  /** 저장 통화. 만든 뒤 바뀌지 않는다. 거래 입력의 환율 기준이다. */
  ledgerCurrency?: string;
  /** 표시 통화. 서버가 합계를 이 통화로 환산해 준다. 언제든 바꿀 수 있다. */
  displayCurrency?: string;
  /** 로그인한 사용자가 이 프로젝트에서 "나"로 지정한 구성원 */
  myPersonId?: string | null;
}

interface ProjectStore {
  projects: Project[];
  setProjects: (projects: Project[]) => void;
  selectedProjectId: string | null;
  setSelectedProjectId: (projectId?: string | null) => void;
}

/**
 * 선택한 프로젝트의 집계 기준 타임존.
 *
 * 브라우저 로컬 타임존이 아니라 이 값으로 날짜/시각을 해석해야 서버의 월 합계와
 * 화면의 날짜가 어긋나지 않는다. 아직 목록을 못 받았으면 기본값을 쓴다.
 */
export function useProjectTimeZone(): string {
  return useProject((state) => {
    const selected = state.projects.find((p) => p.id === state.selectedProjectId);
    return selected?.timezone || DEFAULT_TIME_ZONE;
  });
}

/**
 * 선택한 프로젝트의 표시 통화.
 *
 * 서버가 주는 합계(지출, 예산, 순자산)는 전부 이 통화로 환산돼 온다.
 * 계좌 잔액만 그 계좌의 통화 그대로다.
 */
export function useProjectDisplayCurrency(): CurrencyCode {
  return useProject((state) => {
    const selected = state.projects.find((p) => p.id === state.selectedProjectId);
    if (isCurrencyCode(selected?.displayCurrency)) return selected.displayCurrency;
    return isCurrencyCode(selected?.ledgerCurrency) ? selected.ledgerCurrency : 'KRW';
  });
}

/**
 * 선택한 프로젝트의 저장 통화.
 *
 * 거래를 입력할 때 환율의 기준이 되는 통화다. 표시 통화와 달리 바뀌지 않는다.
 */
export function useProjectLedgerCurrency(): CurrencyCode {
  return useProject((state) => {
    const selected = state.projects.find((p) => p.id === state.selectedProjectId);
    return isCurrencyCode(selected?.ledgerCurrency) ? selected.ledgerCurrency : 'KRW';
  });
}

/** 선택한 프로젝트에서 "나"로 지정한 구성원 id. 지정하지 않았으면 null. */
export function useMyPersonId(): string | null {
  return useProject((state) => {
    const selected = state.projects.find((p) => p.id === state.selectedProjectId);
    return selected?.myPersonId ?? null;
  });
}

export const useProject = create<ProjectStore>()(
  persist(
    (set) => ({
      projects: [],
      setProjects: (projects: Project[]) => set({ projects }),
      selectedProjectId: null,
      setSelectedProjectId: (projectId?: string | null) => set({ selectedProjectId: projectId ?? null }),
    }),
    {
      name: 'project-storage',
      storage: createJSONStorage(() => persistStorage),
      partialize: (state) => ({
        selectedProjectId: state.selectedProjectId,
      }),
    }
  )
);
