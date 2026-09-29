/**
 * 읽지 않은 문의 답의 수. 설정의 "문의하기" 칸 배지가 이 값을 그린다.
 *
 * 웹과 앱이 함께 쓴다. 값은 서버에서만 온다(`GET /inquiries/unread-count`) -- 문의는 기기
 * 사본에 두지 않는다. 세는 때는 셋이다: 설정 화면이 열릴 때, 문의 하나를 열어 읽었을 때,
 * 앱이 답장 푸시를 받았을 때.
 *
 * 못 세면(연결 없음) 앞의 값을 그대로 둔다. 배지가 오프라인이라고 사라지면 답이 온 것을 잊는다.
 */
import { create } from 'zustand';

import { apiClient } from '../lib/api-client';
import { useAuth } from './auth';

interface InquiryUnreadStore {
  count: number;
  refresh: () => Promise<void>;
  /** 로그아웃할 때 비운다. 다음 사람에게 앞 사람의 배지가 보이지 않게. */
  reset: () => void;
}

export const useInquiryUnread = create<InquiryUnreadStore>()((set) => ({
  count: 0,
  refresh: async () => {
    try {
      const count = await apiClient.getInquiryUnreadCount();
      set((state) => (state.count === count ? state : { count }));
    } catch {
      // 위의 까닭으로 앞 값을 둔다.
    }
  },
  reset: () => set({ count: 0 }),
}));

/** 스토어 밖(푸시 받기)에서 부르는 통로. */
export function refreshInquiryUnread(): Promise<void> {
  return useInquiryUnread.getState().refresh();
}

/*
 * 계정이 바뀌면(로그아웃·다른 계정으로 로그인) 비운다. 앞 사람의 배지가 다음 사람의 설정에
 * 잠깐이라도 뜨지 않게 한다. 새 사람의 수는 설정 화면이 열릴 때 센다.
 */
useAuth.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id) useInquiryUnread.getState().reset();
});
