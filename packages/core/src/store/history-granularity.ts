import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { persistStorage } from '../lib/persist-storage';

/** 자산 추이 그래프의 단위. `useAssetHistory` 의 Granularity 와 같은 낱말이다. */
export type HistoryGranularity = 'day' | 'week' | 'month' | 'year';

const GRANULARITIES: readonly HistoryGranularity[] = ['day', 'week', 'month', 'year'];

function isGranularity(value: unknown): value is HistoryGranularity {
  return typeof value === 'string' && (GRANULARITIES as readonly string[]).includes(value);
}

interface HistoryGranularityStore {
  granularity: HistoryGranularity;
  setGranularity: (granularity: HistoryGranularity) => void;
}

/**
 * 자산 추이에서 **직접 고른** 단위. 다음에 그래프를 열 때 이 단위로 선다.
 *
 * 모든 추이 그래프가 이 값 하나를 나눠 쓴다 -- 전체 추이에서 주로 바꾸면 계좌·자산주인을
 * 열어도 주로 선다. 따로 두면 전체에서 고른 단위가 계좌에서는 다시 월로 보여, 바꾼 것이
 * 안 먹은 것처럼 보인다.
 *
 * 칸을 눌러 한 단 내려간 것(`drillInto`)은 남기지 않는다. 그건 한 구간을 들여다보려고
 * 잠깐 내려간 것이라, 다음에 열 때까지 일별에 머물러 있으면 고른 적 없는 단위가 된다.
 */
export const useHistoryGranularity = create<HistoryGranularityStore>()(
  persist(
    (set) => ({
      granularity: 'month',
      setGranularity: (granularity) => set({ granularity }),
    }),
    {
      name: 'history-granularity-storage',
      storage: createJSONStorage(() => persistStorage),
      partialize: (state) => ({ granularity: state.granularity }),
      /*
       * 모르는 낱말은 버리고 기본값(월)을 남긴다. 그대로 실으면 어느 탭도 켜지지 않은
       * 그래프가 되고, 창 크기(WINDOW_SIZE)를 못 찾아 조회가 깨진다.
       */
      merge: (persisted, current) => {
        const saved = (persisted as { granularity?: unknown } | undefined)?.granularity;
        return { ...current, ...(isGranularity(saved) ? { granularity: saved } : {}) };
      },
    },
  ),
);
