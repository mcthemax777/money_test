import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { persistStorage } from '../lib/persist-storage';
import type { Person } from '../lib/types';


interface UserFilterStore {
  people: Person[];
  setPeople: (people: Person[]) => void;
  selectedPersonIds: string[];
  setSelectedPersonIds: (personIds: string[]) => void;
  togglePersonId: (personId: string) => void;
  /**
   * 사용자가 체크박스를 한 번이라도 건드렸는지.
   *
   * 아무도 고르지 않은 상태는 "거래 없음"을 뜻한다. 그래서 첫 방문의 빈 배열과
   * 사용자가 직접 전부 해제한 빈 배열을 구분해야 한다. 전자는 전체 선택으로
   * 채워 주고, 후자는 그대로 둔다.
   */
  personFilterTouched: boolean;
  /**
   * 지금 담긴 선택이 어느 프로젝트 것인지.
   *
   * 사람 id는 프로젝트마다 다르다. 이 값이 없던 시절에는 프로젝트를 바꿔도
   * 선택과 "건드림" 표시가 그대로 남아, 남의 프로젝트 id만 든 선택이
   * "사용자가 전부 해제한 상태"로 읽혔다. 그 결과 전환 직후 가계 화면의
   * 거래·합계·예산 사용액이 전부 0으로 보였다.
   *
   * 전환 경로마다 초기화를 챙기는 대신 소속을 들고 비교한다. 어느 경로로
   * 바뀌든 다음 조회에서 스스로 맞춰진다.
   */
  filterProjectId: string | null;
  /** 이 프로젝트의 구성원 전체를 고른 상태로 초기화한다. */
  resetPersonFilterFor: (projectId: string, personIds: string[]) => void;
}

export const useUserFilter = create<UserFilterStore>()(
  persist(
    (set) => ({
      people: [],
      /*
       * 구성원 목록을 갈아 끼운다.
       *
       * 새로 만든 구성원은 선택에도 넣는다. 일부만 고른 상태에서 구성원을 추가하면
       * 그 사람은 필터 밖이라 화면에서 곧장 사라지고, 방금 만든 것이 보이지 않으면
       * 저장에 실패한 것으로 읽힌다.
       *
       * 목록이 비어 있던 경우는 건드리지 않는다. 첫 조회나 프로젝트 전환 직후라
       * "추가"가 아니라 처음 채우는 것이고, 이 경우의 선택 맞추기는
       * usePersonFilterSync 가 소속(filterProjectId)을 보고 처리한다.
       */
      setPeople: (people: Person[]) =>
        set((state) => {
          if (state.people.length === 0) return { people };
          const known = new Set(state.people.map((person) => person.id));
          const added = people.filter((person) => !known.has(person.id)).map((p) => p.id);
          if (added.length === 0) return { people };
          return { people, selectedPersonIds: [...state.selectedPersonIds, ...added] };
        }),
      selectedPersonIds: [],
      personFilterTouched: false,
      filterProjectId: null,
      setSelectedPersonIds: (personIds: string[]) =>
        set({ selectedPersonIds: personIds }),
      resetPersonFilterFor: (projectId: string, personIds: string[]) =>
        set({
          filterProjectId: projectId,
          selectedPersonIds: personIds,
          personFilterTouched: false,
        }),
      togglePersonId: (personId: string) =>
        set((state) => ({
          personFilterTouched: true,
          selectedPersonIds: state.selectedPersonIds.includes(personId)
            ? state.selectedPersonIds.filter((id) => id !== personId)
            : [...state.selectedPersonIds, personId],
        })),
    }),
    {
      name: 'user-filter-storage',
      storage: createJSONStorage(() => persistStorage),
      partialize: (state) => ({
        selectedPersonIds: state.selectedPersonIds,
        personFilterTouched: state.personFilterTouched,
        filterProjectId: state.filterProjectId,
      }),
    }
  )
);
