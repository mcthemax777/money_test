/**
 * 보관함에 기다리는 후보의 수. 거래 화면의 보관함 아이콘과 아래 탭·사이드바의 거래 칸 배지가
 * 이 값을 그린다.
 *
 * 웹과 앱이 함께 쓴다. 값은 두 곳에서 들어온다 -- 껍데기가 켜질 때·가계부를 바꿀 때·사본이
 * 바뀔 때 세는 것(`useInboxCountSync`), 그리고 보관함 목록을 읽거나 후보를 처리한 화면이 제
 * 목록의 수를 적는 것(`useEntryDrafts`). 뒤엣것 덕에 보관함에서 하나를 처리하면 탭의 수가
 * 다시 세지 않아도 곧바로 준다.
 *
 * 어느 가계부의 수인지 함께 든다. 가계부를 바꾼 직후 앞 가계부의 수가 탭에 남으면 안 된다.
 */
import { create } from 'zustand';

import { draftPort } from '../data/draft-port';
import { useAuth } from './auth';

interface InboxCountStore {
  projectId: string | null;
  count: number;
  set: (projectId: string, count: number) => void;
  reset: () => void;
}

export const useInboxCountStore = create<InboxCountStore>()((set) => ({
  projectId: null,
  count: 0,
  set: (projectId, count) =>
    set((state) => (state.projectId === projectId && state.count === count ? state : { projectId, count })),
  reset: () => set({ projectId: null, count: 0 }),
}));

/** 그 가계부의 대기 건수. 아직 세지 못했거나 다른 가계부의 값이면 0 이다. */
export function useInboxCount(projectId: string | null): number {
  return useInboxCountStore((state) => (projectId && state.projectId === projectId ? state.count : 0));
}

/**
 * 다시 센다. 못 세면(연결 없음) 앞의 값을 둔다 -- 오프라인이라고 배지가 사라지면 기다리는
 * 후보를 잊는다.
 */
export async function refreshInboxCount(projectId: string | null): Promise<void> {
  if (!projectId) return;
  try {
    const rows = await draftPort().list(projectId, { status: 'pending' });
    useInboxCountStore.getState().set(projectId, rows.length);
  } catch {
    // 위의 까닭으로 앞 값을 둔다.
  }
}

// 계정이 바뀌면 비운다. 앞 사람의 수가 다음 사람의 탭에 잠깐이라도 뜨지 않게 한다.
useAuth.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id) useInboxCountStore.getState().reset();
});
