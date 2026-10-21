/*
 * 동기화가 태그를 붙이지 못한 줄이 있었다는 소식을 Alert 로 한 번 알린다. 화면은 그리지 않는다.
 *
 * 끊긴 동안 단 태그가, 그 사이 다른 기기가 지운 줄이나 고친 분할에는 붙지 못한다. 서버는 나머지만 적용하고
 * 그 수를 돌려준다(core 의 `useSyncNotice`). 알리지 않으면 사용자는 표시가 된 줄 안다.
 * 내보내짐 알림(ProjectAccessLostAlert)과 같이 늘 떠 있는 자리에 둔다.
 */
import { useEffect } from 'react';
import { Alert } from 'react-native';

import { useTranslation } from '@money/core/lib/i18n';
import { useSyncNotice } from '@money/core/store/sync-notice';

export default function SkippedTagsAlert() {
  const { t } = useTranslation();
  const skipped = useSyncNotice((state) => state.skippedTags);
  const clear = useSyncNotice((state) => state.clearSkippedTags);

  useEffect(() => {
    if (skipped === 0) return;
    Alert.alert(t('sync.skippedTags.title'), t('sync.skippedTags.body', { count: skipped }), [
      { text: t('common.close'), onPress: clear },
    ], { onDismiss: clear });
  }, [skipped]);

  return null;
}
