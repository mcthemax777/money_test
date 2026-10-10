import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { persistStorage } from '../lib/persist-storage';

interface AssetExclusionStore {
  /** 가계부 id -> 합계에서 뺀 계좌 id */
  excludedByProject: Record<string, string[]>;
  /** 계좌들을 합계에 넣거나(included) 뺀다. 묶음 전체 선택·해제도 이것 하나로 한다. */
  setIncluded: (projectId: string, accountIds: readonly string[], included: boolean) => void;
}

/**
 * 자산 탭에서 합계에서 뺀 계좌 (2026-10-10 사용자 요청).
 *
 * 예전에는 유형 묶음(네 칸)을 통째로 켜고 껐다. 이제 묶음을 누르면 그 안의 계좌 목록이
 * 열리고 계좌마다 뺀다 -- 묶음이 켜졌는지는 그 안의 계좌가 모두/일부/하나도 빠지지
 * 않았는지로 읽는다 (`useAssetExclusion`).
 *
 * 계좌 id 는 가계부마다 다르므로 가계부별로 든다. 기기에만 남는 보기 취향이라 서버에
 * 올리지 않는다(홈의 사람 고르기와 같다). 지워진 계좌의 id 가 남아 있어도 화면이 지금
 * 있는 계좌와 맞춰 보므로 그냥 무시된다.
 */
export const useAssetExclusion = create<AssetExclusionStore>()(
  persist(
    (set) => ({
      excludedByProject: {},
      setIncluded: (projectId, accountIds, included) =>
        set((state) => {
          const current = new Set(state.excludedByProject[projectId] ?? []);
          for (const id of accountIds) {
            if (included) current.delete(id);
            else current.add(id);
          }
          return { excludedByProject: { ...state.excludedByProject, [projectId]: [...current] } };
        }),
    }),
    {
      name: 'asset-exclusion-storage',
      storage: createJSONStorage(() => persistStorage),
    },
  ),
);
