/*
 * 고른 프로젝트를 서버와 맞추는 자리.
 *
 * 화면을 그리지 않는다. 프로젝트가 바뀔 때 한 번 동기화를 걸어 두는 일만 한다.
 * 화면 안에 두지 않는 이유는 화면마다 같은 코드를 두지 않기 위해서다.
 *
 * 실패는 조용히 넘긴다. 사본은 이미 읽을 수 있고, 오프라인은 오류가 아니다.
 */
import { useEffect } from 'react';

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
    void (async () => {
      const result = await syncNow(projectId, timeZone);
      if (cancelled || !result) return;

      if (result.offline) {
        console.log('오프라인. 기기 사본으로 그린다.');
        return;
      }
      console.log(
        `동기화 완료. 번호 ${result.version} (요청 ${result.rounds}회, 올림 ${result.pushed}건, 보류 ${result.held}건)`,
      );
    })();

    /*
     * 서버가 바뀐 것을 알려 오면 그때마다 다시 맞춘다.
     *
     * 다른 사람이 웹에서 고친 것이 이 길로 들어온다. 알림이 오지 않아도 위의 한 번과
     * 저장 직후의 동기화가 있으므로 화면이 틀리지는 않는다 -- 늦게 따라붙을 뿐이다.
     */
    const stopListening = listenForChanges(projectId, timeZone);

    return () => {
      cancelled = true;
      stopListening();
    };
  }, [projectId, timeZone]);

  return null;
}
