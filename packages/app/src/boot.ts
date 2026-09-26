/*
 * 앱이 무엇을 하든 먼저 해 둘 준비. **한 번만 돈다.**
 *
 * 부르는 곳이 둘이다 -- 화면(App)과, 알림이 왔을 때 화면 없이 도는 백그라운드
 * 작업(`inbox-task`). 두 곳은 같은 자바스크립트 런타임을 나눠 쓴다: 작업이 먼저 떠서
 * 준비를 마친 뒤에 사람이 앱을 열 수도, 그 반대일 수도 있다. 각자 준비하면 사본이 두 번
 * 열리고 두 번째가 앞의 연결을 덮는다. 그래서 약속 하나를 나눠 쓴다.
 */
import { useAuth } from '@money/core/store/auth';

import { setupApi } from './api';
import { setupOffline } from './offline';
import { hydrateStores } from './persistence';

let booting: Promise<void> | null = null;

export function boot(): Promise<void> {
  booting ??= (async () => {
    await setupApi(() => useAuth.setState({ user: null, isAuthenticated: false }));
    await hydrateStores();
    // 사본을 먼저 열어 둔다. 첫 화면이 서버를 기다리지 않고 사본에서 그려진다.
    await setupOffline();
  })().catch((error) => {
    // 실패한 준비를 붙들고 있으면 다시 시도할 길이 없다. 다음 부름이 새로 한다.
    booting = null;
    throw error;
  });
  return booting;
}
