/**
 * 보관함의 기기 쪽 창구 (안드로이드 전용).
 *
 * 알림을 듣는 일과 사진에서 글자를 읽는 일은 안드로이드만 할 수 있어 네이티브에 둔다.
 * 그 문구를 거래 후보로 바꾸는 규칙은 core 의 `draft-parse` 에 있다 -- 웹과 검사가
 * 같은 규칙을 써야 하기 때문이다.
 *
 * **네이티브가 없을 수도 있다.** 이 모듈을 넣기 전에 만든 빌드에서는 requireNativeModule
 * 이 던진다. 그때 앱이 시작조차 못 하면 안 되므로, 여기서 잡아 두고 `isAvailable` 로
 * 알려 준다. 화면은 그 값으로 "이 기기에서는 알림 등록을 쓸 수 없다"를 그린다.
 */
import { requireNativeModule } from 'expo-modules-core';

/** 버퍼에 담긴 알림 하나. 해석하기 전의 날것이다. */
export interface CapturedNotification {
  /** 같은 알림의 재전송을 하나로 모으는 열쇠. 지울 때 이 값을 되돌려 준다. */
  key: string;
  packageName: string;
  title: string | null;
  text: string;
  /** 알림이 온 시각 (epoch ms) */
  postedAt: number;
}

interface InboxNativeModule {
  isNotificationAccessGranted(): boolean;
  openNotificationAccessSettings(): void;
  readNotifications(): CapturedNotification[];
  clearNotifications(keys: string[]): void;
  recognizeText(uri: string): Promise<string>;
}

const native: InboxNativeModule | null = (() => {
  try {
    return requireNativeModule<InboxNativeModule>('InboxNative');
  } catch {
    return null;
  }
})();

/** 이 빌드에 네이티브가 들어 있는가. 없으면 아래 함수들은 빈 값을 돌려준다. */
export const isAvailable = native !== null;

export function isNotificationAccessGranted(): boolean {
  return native?.isNotificationAccessGranted() ?? false;
}

export function openNotificationAccessSettings(): void {
  native?.openNotificationAccessSettings();
}

export function readNotifications(): CapturedNotification[] {
  return native?.readNotifications() ?? [];
}

export function clearNotifications(keys: string[]): void {
  if (keys.length === 0) return;
  native?.clearNotifications(keys);
}

export async function recognizeText(uri: string): Promise<string> {
  if (!native) return '';
  return native.recognizeText(uri);
}
