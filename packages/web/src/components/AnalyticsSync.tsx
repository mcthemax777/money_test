'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

import { setAnalyticsSink, trackScreen } from '@money/core/lib/analytics';

/**
 * 사용 통계(Firebase Analytics, GA4). 무엇을 보낼지는 core 의 `lib/analytics` 가 정하고,
 * 여기는 firebase JS SDK 를 꽂고 화면 이동을 알리기만 한다. 화면을 그리지 않는다.
 *
 * **켜지는 조건.** 출시 빌드이고 `NEXT_PUBLIC_FIREBASE_*` 넷이 모두 있어야 한다. 하나라도
 * 없으면(개발 서버 포함) SDK 를 받지도 않는다. 값은 Firebase 콘솔의 프로젝트 설정 → 웹 앱에서
 * 얻는다(앱과 같은 프로젝트).
 *
 * GA 가 스스로 보내는 page_view 는 끈다(send_page_view). 주소에 초대 코드 같은 값이 실려
 * 오므로, 물음표 뒤를 뗀 화면 이름만 core 가 보낸다. GA 속성의 "향상된 측정 → 페이지 조회"
 * 의 "브라우저 기록 이벤트" 도 꺼야 화면 이동이 두 번 세지지 않는다.
 *
 * 관리 화면(/admin)은 세지 않는다.
 */
const CONFIG = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

const IS_CONFIGURED =
  process.env.NODE_ENV === 'production' && Object.values(CONFIG).every((value) => Boolean(value));

export function AnalyticsSync() {
  const pathname = usePathname();

  useEffect(() => {
    if (!IS_CONFIGURED) return;
    let cancelled = false;

    void (async () => {
      // SDK 는 필요할 때만 받는다. 설정이 없는 배포의 번들에 실리지 않게.
      const [{ initializeApp, getApps }, analyticsSdk] = await Promise.all([
        import('firebase/app'),
        import('firebase/analytics'),
      ]);
      // 쿠키·IndexedDB 를 막은 브라우저에서는 GA 가 돌지 않는다. 그때는 보내지 않고 쓴다.
      if (cancelled || !(await analyticsSdk.isSupported())) return;

      const app = getApps()[0] ?? initializeApp(CONFIG);
      const analytics = analyticsSdk.initializeAnalytics(app, {
        config: { send_page_view: false },
      });

      setAnalyticsSink({
        logEvent: (name, params) => analyticsSdk.logEvent(analytics, name, params),
        logScreen: (name) =>
          analyticsSdk.logEvent(analytics, 'screen_view', {
            firebase_screen: name,
            firebase_screen_class: name,
          }),
        setUserId: (userId) => analyticsSdk.setUserId(analytics, userId),
        setEnabled: (enabled) => analyticsSdk.setAnalyticsCollectionEnabled(analytics, enabled),
      });
      // 꽂기 전에 연 첫 화면은 세지 못했다. 지금 주소로 한 번 센다.
      if (!window.location.pathname.startsWith('/admin')) trackScreen(window.location.pathname);
    })().catch(() => {
      // 통계를 못 붙였다. 화면은 그대로 쓴다.
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (pathname && !pathname.startsWith('/admin')) trackScreen(pathname);
  }, [pathname]);

  return null;
}
