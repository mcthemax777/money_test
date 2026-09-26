/*
 * 푸시 알림의 기기 쪽.
 *
 * 서버는 보관함에 알림 후보가 담기면 그 가계부 구성원의 기기 전부에 FCM 으로 알린다.
 * 이 파일은 그 알림을 받을 준비를 한다 -- 알림 채널을 만들고, 권한을 묻고, 이 기기의
 * FCM 토큰을 서버에 적고, 로그아웃할 때 지운다.
 *
 * **FCM 설정(google-services.json)이 없는 빌드에서는 토큰을 받지 못한다.** 그때는
 * 적기를 건너뛰고 나머지는 그대로 돈다. 보관함에는 후보가 그대로 담긴다.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { apiClient } from '@money/core/lib/api-client';
import { translate } from '@money/core/lib/i18n';
import { useLocaleStore } from '@money/core/store/locale';

/** 보관함 알림의 채널. 서버의 `DRAFT_CHANNEL_ID`, app.json 의 `defaultChannel` 과 같아야 한다. */
const DRAFT_CHANNEL_ID = 'drafts';

/** 서버에 적은 토큰. 로그아웃할 때 이것을 지운다. */
let registeredToken: string | null = null;

/**
 * 앱이 앞에 떠 있을 때도 알림을 보인다.
 *
 * 기본값은 "앞에 있으면 보이지 않는다"다. 다른 화면을 보는 중에 결제 알림이 조용히
 * 사라지면 보관함에 후보가 생긴 것을 모른다.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * 이 기기를 푸시 받을 기기로 서버에 적는다. 로그인한 뒤에 부른다.
 *
 * 권한을 거절했거나 토큰을 받지 못하면 조용히 물러난다 -- 푸시는 곁들이는 것이라
 * 로그인을 막을 까닭이 없다. 돌려주는 값은 토큰이 바뀔 때 다시 적는 구독을 푸는 함수다.
 */
export async function registerPushDevice(): Promise<() => void> {
  if (Platform.OS !== 'android') return () => {};

  try {
    // 채널이 있어야 안드로이드 8 이상에서 알림이 뜬다. 권한을 묻기 전에 만들어 둔다.
    await Notifications.setNotificationChannelAsync(DRAFT_CHANNEL_ID, {
      // 안드로이드 설정 > 알림에 보이는 이름. 채널을 만들 때의 화면 언어로 적힌다.
      name: translate(useLocaleStore.getState().locale, 'inbox.title'),
      importance: Notifications.AndroidImportance.HIGH,
    });

    // 안드로이드 13 부터는 알림을 띄우려면 사람이 허락해야 한다.
    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return () => {};

    const { data } = await Notifications.getDevicePushTokenAsync();
    await sendToken(String(data));
  } catch (error) {
    console.warn('푸시 토큰을 적지 못했습니다:', error);
    return () => {};
  }

  // FCM 은 토큰을 바꿀 때가 있다(앱 데이터 삭제, 오래 안 쓴 기기). 바뀌면 다시 적는다.
  const subscription = Notifications.addPushTokenListener(({ data }) => {
    sendToken(String(data)).catch((error) => console.warn('푸시 토큰을 다시 적지 못했습니다:', error));
  });
  return () => subscription.remove();
}

/**
 * 이 기기를 푸시 받을 기기에서 뺀다. **로그아웃 전에** 부른다.
 *
 * 토큰이 살아 있을 때 불러야 서버가 누구의 것인지 안다. 빼지 않고 나가면 이 기기의
 * 잠금 화면에 앞 사람의 가계부 알림이 계속 뜬다. 실패해도 로그아웃은 멈추지 않는다 --
 * 다음 사람이 로그인하면 같은 토큰의 주인이 그 사람으로 바뀐다.
 */
export async function unregisterPushDevice(): Promise<void> {
  const token = registeredToken;
  if (!token) return;
  registeredToken = null;
  try {
    await apiClient.unregisterPushDevice(token);
  } catch (error) {
    console.warn('푸시 토큰을 지우지 못했습니다:', error);
  }
}

async function sendToken(token: string): Promise<void> {
  if (!token) return;
  await apiClient.registerPushDevice({ token, platform: 'android' });
  registeredToken = token;
}
