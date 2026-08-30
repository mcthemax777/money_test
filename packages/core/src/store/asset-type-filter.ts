import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { persistStorage } from '../lib/persist-storage';

import { ASSET_TYPE_GROUPS } from '../lib/net-worth';

/** 처음에는 넷 다 켜져 있다. 그 합이 곧 총자산이다. */
const ALL_KEYS = ASSET_TYPE_GROUPS.map((group) => group.key);

interface AssetTypeFilterStore {
  /** 홈의 총액에 더할 유형 묶음 (lib/net-worth의 ASSET_TYPE_GROUPS 키) */
  selectedKeys: string[];
  toggleKey: (key: string) => void;
}

/**
 * 홈에서 총액에 더할 자산 유형.
 *
 * 사람 id와 달리 유형 키는 프로젝트를 가리지 않으므로 소속을 들고 다닐 필요가 없다.
 * 목록에서 사라진 키가 저장돼 있어도 화면이 ASSET_TYPE_GROUPS를 훑으며 맞춰 보므로
 * 그냥 무시된다.
 */
export const useAssetTypeFilter = create<AssetTypeFilterStore>()(
  persist(
    (set) => ({
      selectedKeys: ALL_KEYS,
      toggleKey: (key: string) =>
        set((state) => ({
          selectedKeys: state.selectedKeys.includes(key)
            ? state.selectedKeys.filter((k) => k !== key)
            : [...state.selectedKeys, key],
        })),
    }),
    {
      name: 'asset-type-filter-storage',
      storage: createJSONStorage(() => persistStorage),
    },
  ),
);
