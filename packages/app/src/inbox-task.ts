/*
 * 알림이 왔을 때 화면 없이 도는 작업.
 *
 * 네이티브 알림 서비스가 돈 이야기로 보이는 알림을 버퍼에 적고 이 작업을 깨운다
 * (`InboxCollectTaskService`). 앱이 꺼져 있어도 후보가 곧바로 담기고, 서버가 그 가계부
 * 구성원의 기기 전부에 푸시를 보낸다.
 *
 * 로그인해 있지 않거나 고른 가계부가 없으면 아무것도 하지 않는다. 알림은 버퍼에 남아
 * 다음에 앱을 열고 "지금 확인하기"를 누를 때 올라간다.
 */
import { getAccessToken } from '@money/core/lib/auth-tokens';
import { useProject } from '@money/core/store/project';

import { boot } from './boot';
import { collectNotificationsSoon } from './inbox';

/** 네이티브의 `InboxCollectTaskService.TASK_NAME` 과 같아야 한다. */
export const INBOX_COLLECT_TASK = 'InboxCollect';

export async function inboxCollectTask(): Promise<void> {
  try {
    await boot();
    if (!getAccessToken()) return;

    const projectId = useProject.getState().selectedProjectId;
    if (!projectId) return;

    await collectNotificationsSoon(projectId);
  } catch (error) {
    // 작업이 실패해도 알림은 버퍼에 남는다. 오류를 올리면 네이티브가 작업을 끝낼 뿐이다.
    console.warn('알림을 후보로 올리지 못했습니다:', error);
  }
}
