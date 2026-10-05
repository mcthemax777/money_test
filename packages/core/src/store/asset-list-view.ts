import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { persistStorage } from '../lib/persist-storage';

/**
 * 자산 탭의 계좌 목록을 무엇으로 묶어 볼지.
 *
 *   person  사용자별. 사람마다 상자 하나, 그 안은 사용자가 끌어 정한 차례다.
 *   type    자산유형별. 네 묶음(입출금·현금 · 예적금·연금 · 투자 · 대출)마다 상자 하나,
 *           계좌 옆에 주인 이름을 적는다.
 *
 * 고른 것은 기기에 남는다 (홈의 유형 필터와 같은 자리). 가계부를 가리지 않는 보기
 * 취향이라 프로젝트를 들고 다니지 않는다.
 */
export type AssetListView = 'person' | 'type';

interface AssetListViewStore {
  view: AssetListView;
  setView: (view: AssetListView) => void;
}

export const useAssetListView = create<AssetListViewStore>()(
  persist(
    (set) => ({
      view: 'person',
      setView: (view) => set({ view }),
    }),
    {
      name: 'asset-list-view-storage',
      storage: createJSONStorage(() => persistStorage),
    },
  ),
);
