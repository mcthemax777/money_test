import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Person {
  id: string;
  name: string;
}

interface UserFilterStore {
  people: Person[];
  setPeople: (people: Person[]) => void;
  selectedPersonIds: string[];
  setSelectedPersonIds: (personIds: string[]) => void;
  togglePersonId: (personId: string) => void;
}

export const useUserFilter = create<UserFilterStore>()(
  persist(
    (set) => ({
      people: [],
      setPeople: (people: Person[]) => set({ people }),
      selectedPersonIds: [],
      setSelectedPersonIds: (personIds: string[]) =>
        set({ selectedPersonIds: personIds }),
      togglePersonId: (personId: string) =>
        set((state) => ({
          selectedPersonIds: state.selectedPersonIds.includes(personId)
            ? state.selectedPersonIds.filter((id) => id !== personId)
            : [...state.selectedPersonIds, personId],
        })),
    }),
    {
      name: 'user-filter-storage',
      partialize: (state) => ({
        selectedPersonIds: state.selectedPersonIds,
      }),
    }
  )
);
