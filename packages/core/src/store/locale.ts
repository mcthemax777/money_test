import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { persistStorage } from '../lib/persist-storage';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@money/types';

import { apiClient } from '../lib/api-client';

/**
 * 지금 화면에 쓰는 말.
 *
 * 진짜 값은 서버(User.locale)에 있다. 여기 두는 것은 그 값의 사본이고, 브라우저에
 * 남겨 둔다(persist). 그렇게 하지 않으면 새로고침할 때마다 /users/me 응답이 올
 * 때까지 한국어로 그렸다가 고른 언어로 바뀌는 깜빡임이 생긴다.
 *
 * 서버에 저장하는 일까지 이 스토어가 맡는다. 화면은 어느 화면에서 골랐든
 * setLocale 하나만 부르면 된다.
 */
interface LocaleStore {
  locale: Locale;
  /** 서버에 저장하는 중. 고르는 자리에서 버튼을 잠그는 데 쓴다. */
  isSaving: boolean;
  /** 사용자가 고른 언어. 서버 저장이 실패하면 되돌리고 예외를 그대로 올린다. */
  setLocale: (locale: Locale) => Promise<void>;
  /** 로그인·프로필 조회로 받은 서버 값을 반영한다. 모르는 값은 무시한다. */
  applyServerLocale: (locale: unknown) => void;
}

export const useLocaleStore = create<LocaleStore>()(
  persist(
    (set, get) => ({
      locale: DEFAULT_LOCALE,
      isSaving: false,

      setLocale: async (locale) => {
        const previous = get().locale;
        if (locale === previous) return;

        /*
         * 화면을 먼저 바꾸고 서버에 저장한다. 응답을 기다렸다가 바꾸면 누른 뒤
         * 한 박자 아무 일도 일어나지 않는다.
         *
         * 저장이 실패하면 되돌린다. 화면만 바뀌고 서버가 그대로면 다음에 들어올 때
         * 이유 없이 옛 언어로 돌아가 있게 된다.
         */
        set({ locale, isSaving: true });

        try {
          await apiClient.updateProfile({ locale });
        } catch (error) {
          set({ locale: previous });
          throw error;
        } finally {
          set({ isSaving: false });
        }
      },

      applyServerLocale: (locale) => {
        if (!isLocale(locale)) return;
        if (get().locale === locale) return;

        set({ locale });
      },
    }),
    {
      name: 'locale-store',
      storage: createJSONStorage(() => persistStorage),
      partialize: (state) => ({ locale: state.locale }),
    },
  ),
);
