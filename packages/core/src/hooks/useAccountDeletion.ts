import { useState } from 'react';
import type { AccountDeletionPreview } from '@money/types';

import { apiClient } from '../lib/api-client';
import { useApiError } from '../lib/api-error';
import { useTranslation } from '../lib/i18n';

/**
 * 내 정보의 계정 삭제. 웹과 앱이 같은 순서로 간다.
 *
 *   1. `check` -- 무엇이 함께 사라지고 무엇이 막는지 서버에 묻는다(끊겨 있으면 실패를 알린다).
 *   2. 막는 가계부가 있으면 `blocked` 를 보여 주고 끝낸다. 없으면 확인 창(`confirmBody`)을 연다.
 *   3. `remove` -- 지운다. 성공하면 부르는 쪽이 로그아웃한다(구글 세션 끊기는 플랫폼마다 다르다).
 *
 * 서버가 확인과 삭제를 한 트랜잭션에서 다시 보므로, 미리 보기와 삭제 사이에 상황이 바뀌어도
 * (그 사이 누가 가계부에 들어왔다) 남의 자료를 지우지 않는다 -- 그때는 409 가 온다.
 */
export function useAccountDeletion() {
  const { t } = useTranslation();
  const { messageOf } = useApiError();
  const [preview, setPreview] = useState<AccountDeletionPreview | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');

  const check = async () => {
    setIsChecking(true);
    setError('');
    try {
      setPreview(await apiClient.getAccountDeletionPreview());
    } catch (err) {
      setPreview(null);
      setError(messageOf(err, 'profile.deleteAccountCheckFailed'));
    } finally {
      setIsChecking(false);
    }
  };

  const close = () => setPreview(null);

  const blocked = preview?.sharedOwnedProjects ?? [];
  const isBlocked = blocked.length > 0;
  /** 확인 창으로 갈 수 있는가. 막는 가계부가 있으면 안내만 한다. */
  const isConfirmOpen = preview !== null && !isBlocked;
  const isBlockedOpen = preview !== null && isBlocked;

  /** 확인 창의 문단. 함께 지워지는 것, 빠지는 것, 해지되지 않는 구독, 남는 결제 기록. */
  const confirmBody: string[] = [];
  if (preview) {
    const names = preview.soloProjects.map((project) => project.name).join(', ');
    confirmBody.push(
      names ? t('profile.deleteAccountSolo', { names }) : t('profile.deleteAccountNoSolo'),
    );
    if (preview.joinedProjectCount > 0) {
      confirmBody.push(t('profile.deleteAccountJoined', { count: preview.joinedProjectCount }));
    }
    const subscribed = preview.soloProjects.filter((project) => project.hasRenewingSubscription);
    if (subscribed.length > 0) {
      confirmBody.push(
        t('profile.deleteAccountSubscription', {
          names: subscribed.map((project) => project.name).join(', '),
        }),
      );
    }
    confirmBody.push(t('profile.deleteAccountKept'));
  }

  /** 지운다. TypedConfirmModal 의 onConfirm 모양으로 돌려준다. */
  const remove = async (): Promise<{ ok: boolean; message?: string }> => {
    setIsDeleting(true);
    try {
      await apiClient.deleteAccount();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: messageOf(err, 'profile.deleteAccountFailed') };
    } finally {
      setIsDeleting(false);
    }
  };

  return {
    check,
    close,
    remove,
    isChecking,
    isDeleting,
    error,
    blocked,
    isBlockedOpen,
    isConfirmOpen,
    confirmBody,
  };
}
