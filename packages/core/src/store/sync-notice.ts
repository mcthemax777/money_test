import { create } from 'zustand';

/**
 * 동기화가 사람에게 한 번 알릴 것 (2026-10-21).
 *
 * 지금은 **태그를 붙이지 못한 줄의 수** 하나다. 끊긴 동안 거래에 태그를 달았는데 그 사이 다른 기기가 그
 * 줄을 지웠거나 분할을 고쳤으면, 서버는 나머지만 적용하고 그 대상을 돌려준다(`skippedTagTargets`). 예전에는
 * 그 목록을 읽는 곳이 없어 사용자는 표시가 된 줄 알았다. 동기화 엔진이 여기 더하고, 앱의 늘 떠 있는 자리가
 * 한 번 알린 뒤 지운다. 저장하지 않는다 -- 다시 켠 뒤까지 알릴 일은 아니다.
 */
interface SyncNoticeStore {
  skippedTags: number;
  addSkippedTags: (count: number) => void;
  clearSkippedTags: () => void;
}

export const useSyncNotice = create<SyncNoticeStore>()((set) => ({
  skippedTags: 0,
  addSkippedTags: (count) => set((state) => ({ skippedTags: state.skippedTags + count })),
  clearSkippedTags: () => set({ skippedTags: 0 }),
}));
