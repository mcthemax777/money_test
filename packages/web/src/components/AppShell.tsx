'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useProjectBootstrap } from '@money/core/hooks/useProjectBootstrap';
import { useTranslation } from '@money/core/lib/i18n';
import { useAuth } from '@money/core/store/auth';
import DashboardSidebar from '@/components/DashboardSidebar';
import MobileTabBar from '@/components/MobileTabBar';
import MobileTopBar from '@/components/MobileTopBar';

/**
 * 로그인 뒤 화면들의 공통 껍데기.
 *
 * 로그인 확인, 프로젝트 목록, 화면 이동 자리, 본문 여백을 여기 한 곳에서 정한다.
 * 화면마다 각자 감싸고 있어 여백(`p-4` vs `px-4 py-8`)과 최대 너비가 서로 달랐다.
 *
 * 이동하는 자리는 화면 너비에 따라 갈린다. 넓으면 왼쪽 사이드바 하나, 좁으면 위쪽
 * 막대(프로젝트·나)와 아래쪽 탭(화면 이동)이다. 좁은 화면에서 사이드바를 서랍처럼
 * 꺼내 쓰면 지금 어디에 있는지가 열기 전까지 보이지 않는다.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { t, locale } = useTranslation();
  const { isAuthenticated, isInitializing } = useAuth();
  // 프로젝트 목록과 첫 선택. 앱의 껍데기도 같은 훅을 쓴다.
  useProjectBootstrap();

  useEffect(() => {
    if (!isInitializing && !isAuthenticated) {
      router.push('/login');
    }
  }, [isInitializing, isAuthenticated, router]);

  if (isInitializing || !isAuthenticated) {
    return (
      <div className="flex justify-center items-center h-screen">{t('shell.signingIn')}</div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardSidebar />
      <MobileTopBar />

      {/*
        위아래 막대는 화면에 붙어 있다(fixed). 그 높이(h-14)만큼 본문을 비켜 준다.
        아래는 아이폰 홈 표시줄 자리까지 더한다 (MobileTabBar 주석 참고).
      */}
      <main className="md:ml-64 pt-14 pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pt-0 md:pb-0">
        {/*
          언어를 바꾸면 본문을 새로 만든다(key).

          사전에서 문구를 꺼내는 화면은 스토어를 구독하고 있어 저절로 다시 그려지지만,
          날짜 표기처럼 훅 없이 지금 언어를 읽어 쓰는 자리는 다시 그릴 까닭이 없어
          옛 표기가 남는다. 언어를 바꾸는 일은 드물어 한 번 새로 받는 값이 싸다.
        */}
        {/*
          위 여백은 좁은 화면에서만 줄인다. 위쪽 막대가 붙어 있어 넓은 화면과 같은 32를
          주면 첫 줄이 한참 내려간 것처럼 보인다. 앱의 껍데기도 같은 값을 쓴다.
        */}
        <div key={locale} className="max-w-7xl mx-auto px-4 pb-8 pt-4 md:pt-8">
          {children}
        </div>
      </main>

      <MobileTabBar />
    </div>
  );
}
