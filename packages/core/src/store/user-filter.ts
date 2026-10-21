import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { persistStorage } from '../lib/persist-storage';
import type { Person } from '../lib/types';


interface UserFilterStore {
  people: Person[];
  /** 마지막으로 본 구성원 id. 저장되어, 다시 켠 뒤 처음 채울 때 새로 들어온 사람을 가린다. */
  knownPersonIds: string[];
  setPeople: (people: Person[]) => void;
  selectedPersonIds: string[];
  setSelectedPersonIds: (personIds: string[]) => void;
  togglePersonId: (personId: string) => void;
  /**
   * 선택과 "건드림" 표시를 한 번에 박는다.
   *
   * 선택을 한 사람으로 좁혀 두고 나중에 그대로 되돌리는 자리(자산 상세의
   * "거래내역 보기")가 쓴다. 표시를 함께 켜지 않으면 usePersonFilterSync 가 좁혀 둔
   * 선택을 "한 번도 고르지 않은 상태"로 보고 전체 선택으로 되돌린다. 되돌릴 때는
   * 떠나기 전의 표시를 그대로 다시 박아야 그 뒤의 동작도 예전과 같아진다.
   */
  setPersonFilter: (personIds: string[], touched: boolean) => void;
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
  /**
   * 선택을 통째로 지운다. 로그아웃처럼 보는 사람이 바뀌는 자리에서 부른다.
   *
   * selectedPersonIds 만 비우면 personFilterTouched 와 filterProjectId 가 남는다.
   * 같은 사람이 같은 프로젝트로 다시 들어왔을 때 usePersonFilterSync 가 그 빈 배열을
   * "사용자가 직접 전부 해제한 상태"로 읽어, 아무도 고르지 않은 채로 화면이 빈다.
   * 소속과 건드림 표시까지 함께 지워야 다음 로그인이 전체 선택으로 시작한다.
   */
  clearPersonFilter: () => void;
}

/**
 * 구성원을 모두 골랐는가. 전부면 화면은 사람 조건을 빼고 서버의 전체 기준 값을 쓴다.
 *
 * 길이로 견주지 않는다 (2026-10-16). 같은 id 가 둘 들어간 옛 선택이나 사라진 사람의 id 가 남으면 길이는 맞거나
 * 어긋나도 실제 고른 사람과 다르다. 그래서 모든 구성원이 선택에 있는지로 본다. 여러 화면이 함께 쓴다.
 */
export function isEveryPersonSelected(
  people: ReadonlyArray<{ id: string }>,
  selectedPersonIds: readonly string[],
): boolean {
  if (people.length === 0) return false;
  const selected = new Set(selectedPersonIds);
  return people.every((person) => selected.has(person.id));
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
          const knownPersonIds = people.map((person) => person.id);
          /*
           * 처음 채울 때(앱을 다시 켠 뒤)는 지난번에 본 구성원(`knownPersonIds`, 저장된다)과 견준다 (2026-10-21).
           * 목록은 저장하지 않아, 예전에는 처음 채울 때 늘 건너뛰었다 -- 필터를 한 번 만진 사람에게는 그사이
           * 들어온 구성원의 거래가 필터를 다시 풀 때까지 숨었다. 처음 쓰는 기기나 고른 적 없는 필터는
           * usePersonFilterSync 가 맞춘다.
           */
          const before =
            state.people.length > 0
              ? state.people.map((person) => person.id)
              : state.personFilterTouched
                ? state.knownPersonIds
                : [];
          if (before.length === 0) return { people, knownPersonIds };
          const known = new Set(before);
          // 이미 고른 사람은 다시 넣지 않는다 (2026-10-16). 만들기 쪽(useAssetsData)이 먼저 넣어 두면 같은 id 가
          // 둘이 되어, 길이로 "전부 골랐다"를 가리는 화면이 일부만 고른 것으로 읽고 주인 없는 통장을 뺐다.
          const selected = new Set(state.selectedPersonIds);
          const added = people
            .filter((person) => !known.has(person.id) && !selected.has(person.id))
            .map((p) => p.id);
          if (added.length === 0) return { people, knownPersonIds };
          return { people, knownPersonIds, selectedPersonIds: [...state.selectedPersonIds, ...added] };
        }),
      knownPersonIds: [],
      selectedPersonIds: [],
      personFilterTouched: false,
      filterProjectId: null,
      setSelectedPersonIds: (personIds: string[]) =>
        set({ selectedPersonIds: personIds }),
      setPersonFilter: (personIds: string[], touched: boolean) =>
        set({ selectedPersonIds: personIds, personFilterTouched: touched }),
      resetPersonFilterFor: (projectId: string, personIds: string[]) =>
        set({
          filterProjectId: projectId,
          selectedPersonIds: personIds,
          personFilterTouched: false,
        }),
      clearPersonFilter: () =>
        set({
          people: [],
          knownPersonIds: [],
          selectedPersonIds: [],
          personFilterTouched: false,
          filterProjectId: null,
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
        knownPersonIds: state.knownPersonIds,
      }),
    }
  )
);
