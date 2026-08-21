'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/store/auth';
import DashboardSidebar from '@/components/DashboardSidebar';

/**
 * 로그인 뒤 화면들의 공통 껍데기.
 *
 * 로그인 확인, 사이드바, 본문 여백을 여기 한 곳에서 정한다. 화면마다 각자 감싸고
 * 있어 여백(`p-4` vs `px-4 py-8`)과 최대 너비가 서로 달랐다.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, isInitializing } = useAuth();

  useEffect(() => {
    if (!isInitializing && !isAuthenticated) {
      router.push('/login');
    }
  }, [isInitializing, isAuthenticated, router]);

  if (isInitializing || !isAuthenticated) {
    return <div className="flex justify-center items-center h-screen">로그인 중...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardSidebar />

      <main className="md:ml-64">
        <div className="max-w-7xl mx-auto px-4 py-8">{children}</div>
      </main>
    </div>
  );
}
