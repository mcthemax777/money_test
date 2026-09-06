/*
 * 고른 프로젝트를 서버와 맞추는 자리.
 *
 * 화면을 그리지 않는다. 동기화를 걸어 두는 일만 한다. 화면 안에 두지 않는 이유는
 * 화면마다 같은 코드를 두지 않기 위해서다.
 *
 * 맞추는 순간은 다섯이다. 프로젝트를 고를 때, 거래를 저장한 직후(`useLocalWrites`),
 * 서버가 알려 올 때, 그리고 **앱이 앞으로 돌아올 때**. 앱을 여는 순간은 첫째에 들어간다.
 *
 * 실패는 조용히 넘긴다. 사본은 이미 읽을 수 있고, 오프라인은 오류가 아니다.
 */
import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useProject, useProjectTimeZone } from '@money/core/store/project';

import { listenForChanges, syncNow, useLocalWrites } from '../offline';

export default function OfflineSync() {
  const projectId = useProject((state) => state.selectedProjectId);
  const timeZone = useProjectTimeZone();

  // 쓰기 창구를 이 프로젝트의 사본으로. 그려지기 전에 걸어 두어야 첫 입력이 새지 않는다.
  useLocalWrites(projectId ?? '', timeZone);

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;

    /** 한 번 맞추고 결과를 남긴다. 어디서 시작했는지(`왜`)를 함께 적는다. */
    const run = async (why: string) => {
      const result = await syncNow(projectId, timeZone);
      if (cancelled || !result) return;

      if (result.offline) {
        console.log(`오프라인(${why}). 기기 사본으로 그린다.`);
        return;
      }
      console.log(
        `동기화 완료(${why}). 번호 ${result.version} (요청 ${result.rounds}회, 올림 ${result.pushed}건, 보류 ${result.held}건)`,
      );
    };

    void run('시작');

    /*
     * 서버가 바뀐 것을 알려 오면 그때마다 다시 맞춘다.
     *
     * 다른 사람이 웹에서 고친 것이 이 길로 들어온다. 알림이 오지 않아도 위의 한 번과
     * 저장 직후의 동기화가 있으므로 화면이 틀리지는 않는다 -- 늦게 따라붙을 뿐이다.
     */
    const listener = listenForChanges(projectId, timeZone);

    /*
     * 앞으로 돌아올 때 한 번 맞춘다.
     *
     * 잠든 사이 알림 연결이 끊기면 다시 붙기까지 최대 1분을 기다리는데, 하필 사용자가
     * 화면을 보고 있는 그 1분이 가장 긴 기다림이 된다. 그래서 둘을 함께 한다 --
     * **밀린 것을 지금 받고**(syncNow), **기다리는 중이면 그만 기다리게 한다**(wake).
     * 붙어 있으면 wake 는 아무 일도 하지 않는다.
     *
     * `background`·`inactive` 에서 돌아올 때만이다. 안드로이드는 화면을 켤 때마다
     * `active` 를 다시 보내는 일이 있어, 이전 상태를 보지 않으면 그때마다 동기화가 돈다.
     */
    let previous: AppStateStatus = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next) => {
      const returned = previous !== 'active' && next === 'active';
      previous = next;
      if (!returned || cancelled) return;

      listener.wake();
      void run('복귀');
    });

    return () => {
      cancelled = true;
      subscription.remove();
      listener.close();
    };
  }, [projectId, timeZone]);

  return null;
}
