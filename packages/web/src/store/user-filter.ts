import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Person } from '@/lib/types';


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
}

export const useUserFilter = create<UserFilterStore>()(
  persist(
    (set) => ({
      people: [],
      setPeople: (people: Person[]) => set({ people }),
      selectedPersonIds: [],
      personFilterTouched: false,
      setSelectedPersonIds: (personIds: string[]) =>
        set({ selectedPersonIds: personIds }),
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
      partialize: (state) => ({
        selectedPersonIds: state.selectedPersonIds,
        personFilterTouched: state.personFilterTouched,
      }),
    }
  )
);
