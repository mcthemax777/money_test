/**
 * 내보내졌다는 소식을 받아 화면에 알릴 거리로 내준다.
 *
 * 두 가지를 한다. 조회가 403 으로 돌아오는 것을 지켜보도록 창구에 손잡이를 걸고
 * (`api-client`), 처리가 끝나 적혀 있는 이름을 화면에 넘긴다.
 *
 * **늘 떠 있는 자리에서 부른다.** 마지막 가계부에서 내보내지면 그 자리에서 시작
 * 화면으로 바뀌므로, 사라지는 화면이 이것을 들고 있으면 알림도 함께 사라진다
 * (앱은 App 의 Authenticated, 웹은 껍데기와 시작 화면 양쪽).
 */
import { useEffect } from 'react';

import { apiClient } from '../lib/api-client';
import { reportProjectAccessLost } from '../lib/project-access';
import { useProject } from '../store/project';

export interface ProjectAccessNotice {
  /** 내보내진 가계부의 이름. null 이면 알릴 것이 없다. 이름을 모르면 빈 글자다. */
  lostName: string | null;
  /** 사람이 알림을 닫았다. */
  dismiss: () => void;
}

export function useProjectAccessNotice(): ProjectAccessNotice {
  const lostName = useProject((state) => state.accessLostName);
  const setAccessLostName = useProject((state) => state.setAccessLostName);

  useEffect(() => {
    apiClient.setProjectAccessLostHandler(() => void reportProjectAccessLost());
    return () => apiClient.setProjectAccessLostHandler(null);
  }, []);

  return {
    lostName,
    dismiss: () => setAccessLostName(null),
  };
}
