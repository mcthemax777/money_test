/*
 * 푸시를 받을 준비와, 푸시를 눌렀을 때 갈 곳.
 *
 * 화면을 그리지 않는다. 로그인한 껍데기 안에 한 번 둔다 -- 토큰을 적으려면 로그인해
 * 있어야 하고, 눌린 알림을 보관함으로 보내려면 화면 이동(`useNavigation`)이 있어야 한다.
 */
import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';

import { useProject } from '@money/core/store/project';

import { registerPushDevice } from '../push';
import { useNavigation } from './navigation';

export default function PushSetup() {
  const { go } = useNavigation();
  const response = Notifications.useLastNotificationResponse();
  /** 이미 따라간 알림. 같은 응답이 다시 그려질 때 보관함을 거듭 열지 않는다. */
  const handledRef = useRef<string | null>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    registerPushDevice().then((stop) => {
      if (cancelled) stop();
      else unsubscribe = stop;
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  /*
   * 보관함 알림을 누르면 보관함으로 간다.
   *
   * 다른 가계부의 후보면 그 가계부로 바꾼 뒤 간다. 알림은 구성원 모두에게 가므로, 지금
   * 고른 가계부가 아닌 곳의 알림을 누르는 일이 있다. 내 목록에 없는 가계부(그 사이
   * 내보내졌다)면 바꾸지 않고 지금 가계부의 보관함을 연다.
   */
  useEffect(() => {
    if (!response) return;
    const id = response.notification.request.identifier;
    if (handledRef.current === id) return;
    handledRef.current = id;

    const data = response.notification.request.content.data as { type?: unknown; projectId?: unknown };
    if (data?.type !== 'entry-draft') return;

    const project = useProject.getState();
    const target = typeof data.projectId === 'string' ? data.projectId : null;
    if (target && target !== project.selectedProjectId && project.projects.some((p) => p.id === target)) {
      project.setSelectedProjectId(target);
    }
    go('/transactions/inbox');
  }, [response, go]);

  return null;
}
