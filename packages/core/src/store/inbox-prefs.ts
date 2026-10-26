import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { persistStorage } from '../lib/persist-storage';

/**
 * 보관함(알림 읽기)의 이 기기 설정 (2026-10-25).
 *
 * `shareSamples` 는 **금융 앱 알림의 원문을 서버로 보내 인식 규칙을 고치는 데 쓰게 할지**다. 기본은 끔이다 --
 * 알림 원문에는 거래처·금액·이름이 들어 있어, 따로 동의한 사람의 것만 보낸다(개인정보보호법 §15·§22, Play 의
 * 사용자 데이터 정책). 끄면 알림은 이 기기 안에서만 해석된다.
 */
interface InboxPrefs {
  shareSamples: boolean;
  setShareSamples: (share: boolean) => void;
}

export const useInboxPrefs = create<InboxPrefs>()(
  persist(
    (set) => ({
      shareSamples: false,
      setShareSamples: (shareSamples) => set({ shareSamples }),
    }),
    {
      name: 'inbox-prefs',
      storage: createJSONStorage(() => persistStorage),
      partialize: (state) => ({ shareSamples: state.shareSamples }),
    },
  ),
);
