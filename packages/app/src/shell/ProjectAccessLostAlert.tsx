/*
 * 내보내졌다는 소식을 Alert 로 알린다. 화면은 그리지 않는다.
 *
 * **늘 떠 있는 자리에 둔다**(App 의 `Authenticated`). 마지막 가계부에서 내보내지면 그
 * 자리에서 시작 화면으로 바뀌는데, 껍데기 안에 두면 알림이 그 화면과 함께 사라진다.
 *
 * 무엇을 할지(목록 다시 받기, 남은 가계부로 옮기기)는 core 가 이미 했다. 여기는 그
 * 결과를 사람에게 말하는 자리다.
 */
import { useEffect } from 'react';
import { Alert } from 'react-native';

import { useProjectAccessNotice } from '@money/core/hooks/useProjectAccessNotice';
import { useTranslation } from '@money/core/lib/i18n';

export default function ProjectAccessLostAlert() {
  const { t } = useTranslation();
  const { lostName, dismiss } = useProjectAccessNotice();

  useEffect(() => {
    if (lostName === null) return;

    Alert.alert(
      t('project.accessLost.title'),
      // 이름을 알면 어느 가계부인지 함께 적는다. 가계부를 여럿 쓰는 사람에게는 그것이 요점이다.
      lostName ? `${lostName}\n\n${t('project.accessLost.body')}` : t('project.accessLost.body'),
      [{ text: t('common.close'), onPress: dismiss }],
      // 바깥을 눌러 닫아도 소식을 지운다. 지우지 않으면 다음 렌더에 같은 창이 다시 뜬다.
      { onDismiss: dismiss },
    );
  }, [lostName]);

  return null;
}
