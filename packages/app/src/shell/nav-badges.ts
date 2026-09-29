/*
 * 아래 탭·사이드바의 칸에 얹는 빨간 수.
 *
 * - 거래: 보관함에 기다리는 후보. 보관함은 거래 화면 안에서 들어가는 곳이다.
 * - 설정: 아직 서버에 가지 못한 거래와 읽지 않은 문의 답. 둘 다 설정 안쪽 화면에서만 풀 수 있다.
 *
 * 그 화면을 열지 않으면 있는 줄 모르는 것들이라 탭에도 띄운다.
 */
import { useEffect, useState } from 'react';

import { useMirrorVersion } from '@money/core/hooks/useMirrorVersion';
import { useInboxCount } from '@money/core/store/inbox-count';
import { useInquiryUnread } from '@money/core/store/inquiry-unread';
import { useProject } from '@money/core/store/project';

import { heldMutations, queuedMutations } from '../offline';

/**
 * 아직 서버에 가지 못한 명령의 수. 보내지 못한 거래 화면의 두 칸(보내는 중·골라야 하는 것)을 합친다.
 *
 * 평소에는 0 이어야 한다. 0 이 아니면 설정 줄에 배지가 서서, 그 화면을 열지 않고도 무엇이
 * 막혀 있는지 알 수 있다. 동기화가 사본을 바꿀 때마다 다시 센다.
 */
export function useOutboxCount(): number {
  const projectId = useProject((state) => state.selectedProjectId);
  const mirrorVersion = useMirrorVersion();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!projectId) {
      setCount(0);
      return;
    }
    let cancelled = false;
    Promise.all([heldMutations(projectId), queuedMutations(projectId)])
      .then(([held, queued]) => {
        if (!cancelled) setCount(held.length + queued.length);
      })
      .catch((error) => console.warn('보내지 못한 거래를 세지 못했습니다:', error));
    return () => {
      cancelled = true;
    };
  }, [projectId, mirrorVersion]);

  return count;
}

/** 칸마다 띄울 수. 열쇠는 메뉴의 주소(`navItemsOf` 의 href)이고, 없는 칸은 0 이다. */
export function useNavBadges(): Record<string, number> {
  const projectId = useProject((state) => state.selectedProjectId);
  const inbox = useInboxCount(projectId);
  const outbox = useOutboxCount();
  const inquiry = useInquiryUnread((state) => state.count);
  return { '/transactions': inbox, '/settings': outbox + inquiry };
}
