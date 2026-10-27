/**
 * 고양이 엠블럼의 화면 쪽 값 (2026-10-28). 웹과 앱이 함께 쓴다.
 *
 * 값은 서버에서만 온다(`GET /cats`) -- 판정이 서버에 있어서 기기 사본에는 두지 않는다. 받은 것을 기기에 남겨 두어
 * 끊긴 동안에도 도감과 걷는 고양이가 그대로 보인다. 새 고양이는 다시 닿을 때 온다.
 *
 * 데리고 다닐 고양이는 끊긴 동안에도 고를 수 있다. 고른 것을 `pendingParade` 에 들고 있다가 다음 받기에서 먼저
 * 보낸다 (설정의 이름 바꾸기와 같은 모양이다, `pending-profile`).
 *
 * "새 고양이가 왔다" 알림은 이 기기에서 아직 알리지 않은 고양이다(`seen`). 이 기기에서 그 가계부를 처음 받을 때는
 * 하루 안에 온 고양이만 알린다 -- 다른 기기에서 이미 본 오래된 고양이를 새 기기에서 다시 알리지 않기 위해서다.
 * 기능을 처음 열 때 지난 자료로 한꺼번에 받는 고양이는 방금 온 것이라 알린다.
 */
import { CAT_PARADE_MAX, defaultParade, isCatBreedId, type CatDto } from '@money/types';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { apiClient } from '../lib/api-client';
import { apiErrorCode } from '../lib/api-error';
import { isOfflineError } from '../lib/offline-error';
import { persistStorage } from '../lib/persist-storage';
import { useAuth } from './auth';

/** 처음 받는 가계부에서 알릴 고양이의 나이. */
const FRESH_ARRIVAL_MS = 24 * 60 * 60 * 1000;

export interface ProjectCats {
  owned: CatDto.Owned[];
  /** 서버의 값. null 이면 고른 적이 없다. */
  parade: string[] | null;
}

export interface CatArrivals {
  projectId: string;
  breedIds: string[];
}

interface CatStore {
  byProject: Record<string, ProjectCats>;
  /** 가계부마다 이 기기에서 이미 알린 고양이. */
  seen: Record<string, string[]>;
  /** 끊긴 동안 고른 데리고 다닐 고양이. 보내면 지운다. */
  pendingParade: Record<string, string[]>;
  /** 화면 아래의 고양이를 이 기기에서 보일지. */
  showParade: boolean;
  /** 아직 알리지 않은 새 고양이. 남기지 않는다 -- 다음에 켜면 `seen` 이 다시 가린다. */
  arrivals: CatArrivals | null;
  /** 마지막 받기가 실패했는가 (도감이 적는다). */
  loadFailed: boolean;
  refresh: (projectId: string) => Promise<void>;
  /** 데리고 다닐 고양이를 정한다. 저장하지 못한 까닭이 끊김이 아니면 던진다. */
  setParade: (projectId: string, breedIds: string[]) => Promise<void>;
  setShowParade: (show: boolean) => void;
  dismissArrivals: () => void;
  reset: () => void;
}

/** 같은 가계부를 동시에 두 번 받지 않는다. 받는 중에 또 부르면 그 받기가 끝난 뒤 한 번 더 받는다. */
const inflight = new Map<string, Promise<void>>();
const again = new Set<string>();

export const useCats = create<CatStore>()(
  persist(
    (set, get) => {
      /** 받은 모습을 적고, 이 기기에서 처음 보는 고양이를 알림에 넣는다. */
      const apply = (projectId: string, state: CatDto.State, now: number) => {
        const owned = state.owned.filter((cat) => isCatBreedId(cat.breedId));
        const known = get().seen[projectId];
        const fresh = owned
          .filter((cat) =>
            known
              ? !known.includes(cat.breedId)
              : now - Date.parse(cat.grantedAt) < FRESH_ARRIVAL_MS,
          )
          .map((cat) => cat.breedId);
        const previous = get().arrivals;
        const arrivals =
          fresh.length === 0
            ? previous
            : {
                projectId,
                // 앞 알림이 같은 가계부의 것이면 이어 붙인다. 다른 가계부의 것은 새 알림이 덮는다.
                breedIds: [
                  ...(previous?.projectId === projectId ? previous.breedIds : []),
                  ...fresh.filter((id) => !(previous?.projectId === projectId && previous.breedIds.includes(id))),
                ],
              };
        set((current) => ({
          byProject: { ...current.byProject, [projectId]: { owned, parade: state.parade } },
          seen: { ...current.seen, [projectId]: owned.map((cat) => cat.breedId) },
          arrivals,
          loadFailed: false,
        }));
      };

      const fetchOnce = async (projectId: string) => {
        const pending = get().pendingParade[projectId];
        try {
          let state: CatDto.State;
          if (pending) {
            try {
              state = await apiClient.setCatParade(projectId, pending);
            } catch (error) {
              // 끊김이 아닌 거절(그 사이 다른 기기가 바꾼 목록 따위)이면 고른 것을 버리고 서버 값을 쓴다.
              if (isOfflineError(error) || apiErrorCode(error) !== 'CAT_PARADE_INVALID') throw error;
              state = await apiClient.getCats(projectId);
            }
            set((current) => {
              const { [projectId]: _sent, ...rest } = current.pendingParade;
              return { pendingParade: rest };
            });
          } else {
            state = await apiClient.getCats(projectId);
          }
          apply(projectId, state, Date.now());
        } catch (error) {
          // 끊겼으면 앞 값을 둔다. 다시 닿으면 다시 받는다.
          if (!isOfflineError(error)) set({ loadFailed: true });
        }
      };

      return {
        byProject: {},
        seen: {},
        pendingParade: {},
        showParade: true,
        arrivals: null,
        loadFailed: false,

        refresh: (projectId) => {
          const running = inflight.get(projectId);
          if (running) {
            again.add(projectId);
            return running;
          }
          const run = (async () => {
            try {
              do {
                again.delete(projectId);
                await fetchOnce(projectId);
              } while (again.has(projectId));
            } finally {
              inflight.delete(projectId);
            }
          })();
          inflight.set(projectId, run);
          return run;
        },

        setParade: async (projectId, breedIds) => {
          const ids = [...new Set(breedIds)].slice(0, CAT_PARADE_MAX);
          const before = get().byProject[projectId];
          // 먼저 바꿔 보인다. 고양이가 곧바로 걸어 나와야 눌린 것을 안다.
          set((current) => ({
            byProject: before
              ? { ...current.byProject, [projectId]: { ...before, parade: ids } }
              : current.byProject,
          }));
          try {
            const state = await apiClient.setCatParade(projectId, ids);
            apply(projectId, state, Date.now());
          } catch (error) {
            if (isOfflineError(error)) {
              set((current) => ({ pendingParade: { ...current.pendingParade, [projectId]: ids } }));
              return;
            }
            set((current) => ({
              byProject: before ? { ...current.byProject, [projectId]: before } : current.byProject,
            }));
            throw error;
          }
        },

        setShowParade: (showParade) => set({ showParade }),
        dismissArrivals: () => set({ arrivals: null }),
        reset: () => set({ byProject: {}, seen: {}, pendingParade: {}, arrivals: null, loadFailed: false }),
      };
    },
    {
      name: 'cats',
      storage: createJSONStorage(() => persistStorage),
      partialize: (state) => ({
        byProject: state.byProject,
        seen: state.seen,
        pendingParade: state.pendingParade,
        showParade: state.showParade,
      }),
    },
  ),
);

/** 지금 데리고 다니는 고양이. 끊긴 동안 고른 것이 있으면 그것, 고른 적이 없으면 먼저 온 고양이들이다. */
export function paradeOf(
  cats: ProjectCats | undefined,
  pending: string[] | undefined,
): string[] {
  if (!cats) return [];
  const owned = new Set(cats.owned.map((cat) => cat.breedId));
  const chosen = pending ?? cats.parade;
  return chosen ? chosen.filter((id) => owned.has(id)) : defaultParade(cats.owned);
}

/** 이 가계부에서 데리고 다니는 고양이. */
export function useParade(projectId: string | null): string[] {
  const cats = useCats((state) => (projectId ? state.byProject[projectId] : undefined));
  const pending = useCats((state) => (projectId ? state.pendingParade[projectId] : undefined));
  return paradeOf(cats, pending);
}

/*
 * 계정이 바뀌면 비운다. 앞 사람의 고양이와 "알린 것" 기록이 다음 사람에게 남지 않게 한다.
 * 보이기 설정은 기기의 값이라 둔다.
 */
useAuth.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id && previous.user) useCats.getState().reset();
});
