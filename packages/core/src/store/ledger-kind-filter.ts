import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { persistStorage } from '../lib/persist-storage';

import { LEDGER_KIND_GROUPS } from '../lib/entries';

/** 처음에는 둘 다 켜져 있다. 그 차가 곧 순수입이다. */
const ALL_KEYS = LEDGER_KIND_GROUPS.map((group) => group.key);

interface LedgerKindFilterStore {
  /** 가계 첫 문장에 더할 갈래 (lib/entries 의 LEDGER_KIND_GROUPS 키) */
  selectedKeys: string[];
  toggleKey: (key: string) => void;
}

/**
 * 가계 첫 문장에 더할 갈래.
 *
 * 자산의 `useAssetTypeFilter` 와 같은 규칙이다 -- 무엇을 켜 뒀는지는 기기에 남고,
 * 목록에 없는 키가 저장돼 있어도 화면이 LEDGER_KIND_GROUPS 를 훑으며 맞춰 보므로
 * 그냥 무시된다.
 *
 * **이 값은 첫 문장만 바꾼다.** 아래 목록과 분류별·수단별 보기는 그대로 둔다. 문장은
 * "지금 무엇을 보고 있나"를 말하는 자리이고, 목록에서 지출만 보는 것은 그 보기가 각자
 * 가진 탭이다. 둘을 묶으면 문장을 바꾸려다 목록이 사라진다.
 */
export const useLedgerKindFilter = create<LedgerKindFilterStore>()(
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
      name: 'ledger-kind-filter-storage',
      storage: createJSONStorage(() => persistStorage),
    },
  ),
);
