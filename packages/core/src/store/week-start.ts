import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { persistStorage } from '../lib/persist-storage';
import { DEFAULT_WEEK_START, isWeekStart, type WeekStart } from '@money/types';

import { apiClient } from '../lib/api-client';

/**
 * 한 주를 어느 요일에서 끊는가.
 *
 * 언어 스토어(`locale`)와 같은 꼴이다. 진짜 값은 서버(User.weekStart)에 있고 여기
 * 두는 것은 그 사본이다. 기기에 남겨 두지 않으면 새로고침할 때마다 /users/me 응답이
 * 올 때까지 달력이 일요일로 섰다가 고른 요일로 다시 그려진다 -- 칸이 통째로 움직여
 * 깜빡임이 언어보다 크게 보인다.
 *
 * 서버에 저장하는 일까지 이 스토어가 맡는다. 화면은 setWeekStart 하나만 부르면 된다.
 */
interface WeekStartStore {
  weekStart: WeekStart;
  /** 서버에 저장하는 중. 고르는 자리에서 버튼을 잠그는 데 쓴다. */
  isSaving: boolean;
  /** 사용자가 고른 요일. 서버 저장이 실패하면 되돌리고 예외를 그대로 올린다. */
  setWeekStart: (weekStart: WeekStart) => Promise<void>;
  /** 로그인·프로필 조회로 받은 서버 값을 반영한다. 모르는 값은 무시한다. */
  applyServerWeekStart: (weekStart: unknown) => void;
}

export const useWeekStartStore = create<WeekStartStore>()(
  persist(
    (set, get) => ({
      weekStart: DEFAULT_WEEK_START,
      isSaving: false,

      setWeekStart: async (weekStart) => {
        const previous = get().weekStart;
        if (weekStart === previous) return;

        /*
         * 화면을 먼저 바꾸고 서버에 저장한다. 응답을 기다렸다가 바꾸면 누른 뒤 한 박자
         * 아무 일도 일어나지 않는다. 저장이 실패하면 되돌린다 -- 화면만 바뀌면 다음에
         * 들어올 때 이유 없이 옛 요일로 돌아가 있다.
         */
        set({ weekStart, isSaving: true });

        try {
          await apiClient.updateProfile({ weekStart });
        } catch (error) {
          set({ weekStart: previous });
          throw error;
        } finally {
          set({ isSaving: false });
        }
      },

      applyServerWeekStart: (weekStart) => {
        if (!isWeekStart(weekStart)) return;
        if (get().weekStart === weekStart) return;

        set({ weekStart });
      },
    }),
    {
      name: 'week-start-store',
      storage: createJSONStorage(() => persistStorage),
      partialize: (state) => ({ weekStart: state.weekStart }),
    },
  ),
);

/** 화면에서 쓰는 통로. 고른 요일이 바뀌면 이 훅을 쓰는 컴포넌트가 다시 그려진다. */
export function useWeekStart(): WeekStart {
  return useWeekStartStore((state) => state.weekStart);
}
