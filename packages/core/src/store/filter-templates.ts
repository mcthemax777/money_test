import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { isEntryPeriodUnit, newId, type EntryPeriodUnit } from '@money/types';

import {
  EMPTY_SEARCH,
  searchPeriodModeOf,
  type TransactionSearch,
} from '../hooks/useTransactions';
import { persistStorage } from '../lib/persist-storage';
import { useProject } from './project';

/** 이름 붙여 둔 검색 조건 하나. 검색 창에서 누르면 그 조건과 묶는 단위가 걸린다. */
export interface FilterTemplate {
  id: string;
  name: string;
  search: TransactionSearch;
  /** 묶는 단위. 검색 창에서 함께 고르는 값이라 함께 남긴다. */
  unit: EntryPeriodUnit;
}

interface FilterTemplatesStore {
  /** 가계부별 템플릿. 분류·자산·태그 id 가 가계부마다 달라 섞어 둘 수 없다. */
  byProject: Record<string, FilterTemplate[]>;
  save: (projectId: string, name: string, search: TransactionSearch, unit: EntryPeriodUnit) => void;
  rename: (projectId: string, id: string, name: string) => void;
  remove: (projectId: string, id: string) => void;
}

/**
 * 검색 조건 템플릿 (2026-10-08 사용자 요청).
 *
 * **기기에 남긴다(persistStorage -- 웹은 localStorage, 앱은 AsyncStorage).** 가계부의 기록이
 * 아니라 보는 사람의 손버릇이라 묶는 단위·자산 목록 보기 같은 다른 보기 설정과 같은 자리다.
 * 서버에 두면 표·마이그레이션·동기화 명령·사본 표가 함께 늘어야 하는데(앱은 끊겨도 모두
 * 돌아야 한다, offline_everything), 그 값이 하는 일은 검색 창의 알약 몇 개를 한 번에 켜는
 * 것뿐이다. 그래서 다른 기기·다른 구성원과는 나누지 않는다.
 *
 * 같은 이름으로 다시 저장하면 그 템플릿을 덮어쓴다 -- 이름으로 고르는 목록에 같은 이름이
 * 둘 서면 어느 것인지 알 수 없다.
 */
export const useFilterTemplateStore = create<FilterTemplatesStore>()(
  persist(
    (set) => ({
      byProject: {},
      save: (projectId, name, search, unit) =>
        set((state) => {
          const list = state.byProject[projectId] ?? [];
          const trimmed = name.trim();
          if (!trimmed) return state;
          const same = list.find((item) => item.name === trimmed);
          const next = same
            ? list.map((item) => (item.id === same.id ? { ...item, search, unit } : item))
            : [...list, { id: newId(), name: trimmed, search, unit }];
          return { byProject: { ...state.byProject, [projectId]: next } };
        }),
      rename: (projectId, id, name) =>
        set((state) => {
          const list = state.byProject[projectId] ?? [];
          const trimmed = name.trim();
          // 빈 이름이나 다른 템플릿과 겹치는 이름은 받지 않는다. 화면이 먼저 막는다.
          if (!trimmed || list.some((item) => item.id !== id && item.name === trimmed)) return state;
          return {
            byProject: {
              ...state.byProject,
              [projectId]: list.map((item) => (item.id === id ? { ...item, name: trimmed } : item)),
            },
          };
        }),
      remove: (projectId, id) =>
        set((state) => ({
          byProject: {
            ...state.byProject,
            [projectId]: (state.byProject[projectId] ?? []).filter((item) => item.id !== id),
          },
        })),
    }),
    {
      name: 'filter-templates-storage',
      storage: createJSONStorage(() => persistStorage),
    },
  ),
);

/**
 * 남겨 둔 템플릿을 지금 모양으로 읽는다.
 *
 * 검색 조건에 칸이 늘면(세는 기준·끊는 자리처럼) 예전에 남긴 템플릿에는 그 칸이 없다. 빈 검색
 * 위에 덮어 읽어 없는 칸은 처음 값으로 채운다. 단위도 모르는 값이면 달로 읽는다.
 */
function normalized(template: FilterTemplate): FilterTemplate {
  return {
    ...template,
    search: { ...EMPTY_SEARCH, ...template.search },
    unit: isEntryPeriodUnit(template.unit) ? template.unit : 'month',
  };
}

/**
 * 그 템플릿이 지금 걸린 조건과 같은가. 검색 창이 지금 걸린 템플릿을 켜 보인다.
 *
 * 칸마다 견준다 -- 통째로 문자열로 바꾸면 칸의 차례가 다른 같은 조건이 다르게 나온다. 고른
 * 목록(분류·태그 등)은 고른 차례가 달라도 같은 조건이라 정렬해서 견준다.
 */
export function templateMatches(
  template: FilterTemplate,
  search: TransactionSearch,
  unit: EntryPeriodUnit,
): boolean {
  // 기간을 정한 조건은 목록이 그 한 줄이라 묶는 단위가 하는 일이 없다. 그때는 단위를 보지 않는다.
  if (searchPeriodModeOf(template.search) === 'unit' && template.unit !== unit) return false;
  const same = (a: unknown, b: unknown) =>
    Array.isArray(a) && Array.isArray(b)
      ? a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000')
      : a === b;
  return (Object.keys(EMPTY_SEARCH) as Array<keyof TransactionSearch>).every((key) =>
    same(template.search[key], search[key]),
  );
}

const NO_TEMPLATES: FilterTemplate[] = [];

/** 지금 가계부의 템플릿과 그것을 고치는 손잡이. 가계부를 고르지 않았으면 빈 목록이다. */
export function useFilterTemplates() {
  const projectId = useProject((state) => state.selectedProjectId);
  const stored = useFilterTemplateStore((state) =>
    projectId ? state.byProject[projectId] ?? NO_TEMPLATES : NO_TEMPLATES,
  );
  const { save, rename, remove } = useFilterTemplateStore.getState();
  const templates = useMemo(() => stored.map(normalized), [stored]);

  return {
    templates,
    /** 가계부를 고르지 않았으면 남길 자리가 없다. 화면은 저장 단추를 감춘다. */
    canSave: projectId !== null,
    save: (name: string, search: TransactionSearch, unit: EntryPeriodUnit) => {
      if (projectId) save(projectId, name, search, unit);
    },
    rename: (id: string, name: string) => {
      if (projectId) rename(projectId, id, name);
    },
    remove: (id: string) => {
      if (projectId) remove(projectId, id);
    },
  };
}
