import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { apiClient } from '../lib/api-client';
import { isOfflineError } from '../lib/offline-error';
import { persistStorage } from '../lib/persist-storage';
import { useConnectivity } from './connectivity';

/** 사용자 설정 중 끊긴 동안에도 바꿀 수 있는 것. 서버의 PATCH /users/me 가 받는 모양이다. */
export interface ProfilePatch {
  name?: string;
  locale?: string;
  weekStart?: number;
}

interface PendingProfileStore {
  /** 아직 서버에 닿지 못한 변경. 같은 칸은 나중 값이 이긴다. */
  pending: ProfilePatch;
  /** 누구의 변경인가. 다른 계정으로 들어오면 버린다 -- 남의 설정을 올리면 안 된다. */
  userId: string | null;
}

/**
 * 보내지 못한 프로필 변경 (이름·언어·주 시작 요일).
 *
 * 가계부 명령 큐(아웃박스)에 두지 않는다. 이 값들은 가계부가 아니라 사용자의 것이고, 명령
 * 재생은 가계부의 편집 권한을 요구해 보기 권한인 사람의 언어 변경이 거절된다. 그래서 따로
 * 들고 있다가 연결이 돌아오면 한 번에 보낸다 (`flushPendingProfile`).
 *
 * 기기에 남겨 둔다(persist). 앱을 껐다 켜도 보낼 것이 남아야 한다.
 */
export const usePendingProfile = create<PendingProfileStore>()(
  persist((): PendingProfileStore => ({ pending: {}, userId: null }), {
    name: 'money-pending-profile',
    storage: createJSONStorage(() => persistStorage),
  }),
);

/** 지금 로그인한 사용자. 순환을 피하려고 늦게 읽는다 (auth 가 이 파일을 부른다). */
async function currentUserId(): Promise<string | null> {
  const { useAuth } = await import('./auth');
  return useAuth.getState().user?.id ?? null;
}

/**
 * 프로필을 저장한다. 닿으면 곧바로, 끊겨 있으면 들고 있다가 나중에 보낸다.
 *
 * 'queued' 를 돌려주면 화면은 이미 바꾼 값을 그대로 두면 된다 (되돌리지 않는다). 서버가 거절한
 * 것(이름이 비었다 등)은 그대로 던진다 -- 그것은 나중에 보내도 거절이다.
 */
export async function saveProfile(patch: ProfilePatch): Promise<'saved' | 'queued'> {
  try {
    await apiClient.updateProfile(patch as never);
    // 방금 보낸 칸은 들고 있던 옛 값이 뒤늦게 덮지 않게 뺀다.
    const rest = { ...usePendingProfile.getState().pending };
    for (const key of Object.keys(patch) as Array<keyof ProfilePatch>) delete rest[key];
    usePendingProfile.setState({ pending: rest });
    return 'saved';
  } catch (error) {
    if (!isOfflineError(error)) throw error;
    const userId = await currentUserId();
    const state = usePendingProfile.getState();
    usePendingProfile.setState({
      userId,
      pending: state.userId === userId ? { ...state.pending, ...patch } : { ...patch },
    });
    return 'queued';
  }
}

/** 끊긴 동안 바꾼 칸. 로그인 때 서버 값이 이 칸들을 덮지 않게 한다. */
export function pendingProfileFields(): ProfilePatch {
  return usePendingProfile.getState().pending;
}

let flushing = false;

/**
 * 들고 있던 변경을 보낸다. 연결이 돌아왔을 때와 로그인 직후에 부른다.
 *
 * 다른 계정의 것이면 버린다. 보내지 못하면(아직 끊김) 그대로 둔다.
 */
export async function flushPendingProfile(): Promise<void> {
  const { pending, userId } = usePendingProfile.getState();
  if (Object.keys(pending).length === 0 || flushing) return;

  const current = await currentUserId();
  if (!current) return;
  if (current !== userId) {
    usePendingProfile.setState({ pending: {}, userId: null });
    return;
  }

  flushing = true;
  try {
    await apiClient.updateProfile(pending as never);
    // 보내는 사이에 더 바뀐 칸은 남긴다.
    const now = usePendingProfile.getState().pending;
    const rest: ProfilePatch = {};
    for (const [key, value] of Object.entries(now) as Array<[keyof ProfilePatch, never]>) {
      if (pending[key] !== value) rest[key] = value;
    }
    usePendingProfile.setState({ pending: rest });
  } catch (error) {
    // 거절이면 다시 보내도 거절이다. 버리고, 다음 로그인의 서버 값이 화면을 되돌린다.
    if (!isOfflineError(error)) usePendingProfile.setState({ pending: {}, userId: null });
  } finally {
    flushing = false;
  }
}

/* 끊겼다가 닿으면 보낸다. 요청마다 연결 상태가 갱신되므로 첫 성공 응답이 곧 신호다. */
useConnectivity.subscribe((state, previous) => {
  if (previous.isOffline && !state.isOffline) void flushPendingProfile();
});
