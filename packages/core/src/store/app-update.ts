/**
 * 업데이트 안내의 상태. 앱과 웹이 함께 쓴다.
 *
 * 두 길로 채워진다.
 *
 *   - **정책을 읽어서** (`checkAppUpdate`). 앱은 켤 때와 다시 앞으로 올 때, 웹은 탭이 다시
 *     보일 때 부른다. 강제·권유 둘 다 여기서 정해진다.
 *   - **서버가 426 으로 거절해서** (`installUpdateHandler`). 정책을 읽기 전에 보낸 요청이나
 *     백그라운드 작업이 먼저 막힐 수 있다. 그때는 곧바로 강제로 두고 정책을 다시 읽어
 *     안내 문구와 주소를 채운다.
 *
 * 저장하는 것은 "나중에"를 누른 권유 버전 하나다. 같은 버전을 켤 때마다 다시 묻지 않는다.
 * 강제는 저장하지 않는다 -- 관리 도구에서 되돌리면 다음 확인에서 풀려야 한다.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { updateLevelOf, type AppPlatform, type AppVersionPolicy, type UpdateLevel } from '@money/types';

import { apiClient } from '../lib/api-client';
import { persistStorage } from '../lib/persist-storage';

interface AppUpdateStore {
  /** 정책에 비춘 이 판의 처지. 권유를 넘겼는지는 보지 않은 값이다(`useUpdateLevel`). */
  level: UpdateLevel;
  policy: AppVersionPolicy | null;
  /** 이 판의 버전. 창에 "지금 버전"으로 적는다. */
  currentVersion: string | null;
  /** "나중에"를 누른 권유 버전. 더 새 버전이 나오면 다시 묻는다. */
  dismissedVersion: string | null;
  /** 지금 권유를 넘긴다. */
  dismiss: () => void;
}

export const useAppUpdate = create<AppUpdateStore>()(
  persist(
    (set, get) => ({
      level: null,
      policy: null,
      currentVersion: null,
      dismissedVersion: null,
      dismiss: () => set({ dismissedVersion: get().policy?.latestVersion ?? null }),
    }),
    {
      name: 'app-update-store',
      storage: createJSONStorage(() => persistStorage),
      partialize: (state) => ({ dismissedVersion: state.dismissedVersion }),
    },
  ),
);

/** 화면이 띄울 창. 권유를 넘긴 버전이면 권유는 없는 것으로 본다. */
export function useUpdateLevel(): UpdateLevel {
  return useAppUpdate((state) => {
    if (state.level !== 'recommend') return state.level;
    return state.policy?.latestVersion === state.dismissedVersion ? null : 'recommend';
  });
}

/** 이 판의 플랫폼과 버전. `installUpdateHandler` 가 넣고 확인이 쓴다. */
let client: { platform: AppPlatform; version: string } | null = null;
/** 진행 중인 확인. 켤 때와 앞으로 올 때가 겹쳐도 한 번만 읽는다. */
let checking: Promise<void> | null = null;

/**
 * 이 판을 알리고 426 을 받을 곳을 건다. 첫 요청보다 먼저 한 번 부른다.
 *
 * 머리글(`setClientVersion`)과 426 처리를 한 자리에 묶는다. 따로 두면 머리글만 싣고 창을
 * 띄울 곳이 없어, 옛 판의 사람은 까닭 모를 오류만 본다.
 */
export function installUpdateHandler(platform: AppPlatform, version: string): void {
  client = { platform, version };
  useAppUpdate.setState({ currentVersion: version });
  apiClient.setClientVersion(platform, version);
  apiClient.setUpdateRequiredHandler(() => {
    if (useAppUpdate.getState().level === 'force') return;
    useAppUpdate.setState({ level: 'force' });
    // 문구와 주소를 채운다. 정책이 이미 풀렸으면(되돌렸으면) 이 확인이 창을 거둔다.
    void checkAppUpdate();
  });
}

/**
 * 정책을 읽어 처지를 정한다. 못 읽으면(오프라인) 지금 상태를 그대로 둔다.
 *
 * 못 읽었다고 강제를 풀지 않는다 -- 서버가 426 을 준 판이 네트워크가 흔들린 틈에 쓰이게
 * 된다. 반대로 권유를 새로 띄우지도 않는다.
 */
export function checkAppUpdate(): Promise<void> {
  if (!client) return Promise.resolve();
  const { platform, version } = client;

  checking ??= apiClient
    .getAppVersionPolicy(platform)
    .then((policy) => useAppUpdate.setState({ policy, level: updateLevelOf(version, policy) }))
    .catch(() => undefined)
    .finally(() => {
      checking = null;
    });
  return checking;
}
