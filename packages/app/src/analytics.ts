/**
 * 사용 통계(Firebase Analytics)와 오류 보고(Crashlytics).
 *
 * 무엇을 보낼지는 core 의 `lib/analytics` 가 정한다. 여기는 Firebase 에 넘기는 일만 한다.
 * Firebase 프로젝트는 푸시(FCM)와 같은 것이다 -- app.json 의 googleServicesFile.
 *
 * **개발 빌드는 보내지 않는다.** 사용자가 켜 두었어도 `__DEV__` 면 두 수집을 모두 끈다.
 * 개발 중의 화면 이동과 일부러 낸 오류가 출시 통계에 섞이면 숫자를 믿을 수 없다. 이 값은
 * Firebase 가 기기에 남기므로, 개발 빌드를 깐 기기에 출시 빌드를 덮어 깔면 출시 빌드가
 * 켜질 때 다시 켠다.
 *
 * **화면 이름은 JS 가 보낸다.** Firebase 의 자동 화면 보고는 `firebase.json` 에서 껐다 -- 켜 두면
 * 앱을 켤 때마다 액티비티 이름(`MainActivity`)으로 screen_view 가 하나 섞인다(2026-10-10 기기에서 봄).
 * 빌드할 때 읽는 값이라 바꾸면 APK 를 다시 만들어야 한다.
 *
 * 시험할 때는 `adb shell setprop debug.firebase.analytics.app online.bboyong.app` 를 걸고
 * Firebase 콘솔의 DebugView 를 본다(출시 빌드여야 이벤트가 나간다).
 */
import {
  getAnalytics,
  logEvent,
  logScreenView,
  setAnalyticsCollectionEnabled,
  setUserId,
} from '@react-native-firebase/analytics';
import {
  getCrashlytics,
  setCrashlyticsCollectionEnabled,
  setUserId as setCrashlyticsUserId,
} from '@react-native-firebase/crashlytics';

import { setAnalyticsSink } from '@money/core/lib/analytics';

/** 앱을 켤 때 한 번. 스토어를 다시 읽은 뒤에 불러야 끈 사람의 값이 먼저 선다. */
export function setupAnalytics(): void {
  const analytics = getAnalytics();
  const crashlytics = getCrashlytics();

  setAnalyticsSink({
    // 약속을 돌려주지 않는다(라이브러리가 안에서 버린다). 이름·값이 틀리면 곧바로 던지고, core 의 track 이 삼킨다.
    logEvent: (name, params) => logEvent(analytics, name, params),
    logScreen: (name) => {
      void logScreenView(analytics, { screen_name: name, screen_class: name }).catch(() => undefined);
    },
    setUserId: (userId) => {
      void setUserId(analytics, userId).catch(() => undefined);
      // Crashlytics 는 null 을 받지 않는다. 빈 값이 "사용자 없음"이다.
      void setCrashlyticsUserId(crashlytics, userId ?? '').catch(() => undefined);
    },
    setEnabled: (enabled) => {
      const on = enabled && !__DEV__;
      void setAnalyticsCollectionEnabled(analytics, on).catch(() => undefined);
      void setCrashlyticsCollectionEnabled(crashlytics, on).catch(() => undefined);
    },
  });
}
