/*
 * 로그아웃 (2026-10-25). 내 정보와 시작 화면이 함께 쓴다.
 *
 * 로그아웃은 이 기기의 사본을 지우고, 사본 안에는 아직 서버에 닿지 못한 거래의 큐가 있다. 예전에는 묻지 않고
 * 지워, 끊긴 동안 적은 거래가 사라졌다. 보내지 못한 것이 있으면 그 수를 알리고 확인을 받는다.
 */
import { Alert } from 'react-native';

import { translate, type MessageKey } from '@money/core/lib/i18n';
import { useAuth } from '@money/core/store/auth';
import { useLocaleStore } from '@money/core/store/locale';

import { signOutGoogle } from './api';
import { unsentCount } from './offline';
import { unregisterPushDevice } from './push';

/** 사람이 그만두지 않았는지 묻는다. 보내지 못한 것이 없으면 묻지 않고 true 다. */
async function confirmUnsentLoss(): Promise<boolean> {
  const { pending, held } = await unsentCount();
  const count = pending + held;
  if (count === 0) return true;

  const t = (key: MessageKey, params?: Record<string, string | number>) =>
    translate(useLocaleStore.getState().locale, key, params);
  return new Promise((resolve) => {
    Alert.alert(
      t('signOut.unsentTitle'),
      t('signOut.unsentBody', { count }),
      [
        { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
        { text: t('signOut.unsentConfirm'), style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/**
 * 로그아웃한다. 그만두면 false 다.
 *
 * 차례가 중요하다. 푸시 기기는 토큰이 살아 있을 때 지워야 서버가 누구의 기기인지 알고(`unregisterPushDevice`),
 * 구글 세션도 끊어야 다음 로그인이 계정을 다시 고르게 한다(`signOutGoogle`). 사본 지우기는 마지막이다.
 */
export async function signOut(): Promise<boolean> {
  if (!(await confirmUnsentLoss())) return false;
  try {
    await unregisterPushDevice();
    await signOutGoogle();
  } finally {
    await useAuth.getState().logout();
  }
  return true;
}
