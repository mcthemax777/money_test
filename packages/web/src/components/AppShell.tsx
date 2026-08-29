'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { apiClient } from '@/lib/api-client';
import { useTranslation } from '@/lib/i18n';
import { useAuth } from '@/store/auth';
import { useProject } from '@/store/project';
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
  const { projects, setProjects, selectedProjectId, setSelectedProjectId } = useProject();

  useEffect(() => {
    if (!isInitializing && !isAuthenticated) {
      router.push('/login');
    }
  }, [isInitializing, isAuthenticated, router]);

  /*
   * 프로젝트 목록.
   *
   * 사이드바가 받아 두던 것을 껍데기로 옮겼다. 좁은 화면에서는 사이드바를 아예
   * 그리지 않는데, 위쪽 막대와 아래쪽 탭이 이 목록을 봐야 한다.
   */
  useEffect(() => {
    if (!isAuthenticated || projects.length > 0) return;

    const loadProjects = async () => {
      try {
        const data = await apiClient.getMyProjects();
        setProjects(data || []);
        // 고른 것이 없으면 첫 프로젝트를 본다.
        if (!selectedProjectId && data && data.length > 0) {
          setSelectedProjectId(data[0].id);
        }
      } catch (err) {
        console.error('프로젝트 목록 조회 실패:', err);
      }
    };

    loadProjects();
  }, [isAuthenticated, projects.length, selectedProjectId, setProjects, setSelectedProjectId]);

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
        <div key={locale} className="max-w-7xl mx-auto px-4 py-8">
          {children}
        </div>
      </main>

      <MobileTabBar />
    </div>
  );
}
