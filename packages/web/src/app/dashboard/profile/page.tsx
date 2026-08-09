'use client';

import Link from 'next/link';
import { useAuth } from '@/store/auth';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ProfilePage() {
  const { user, isAuthenticated, loadUser } = useAuth();
  const router = useRouter();

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, router]);

  if (!isAuthenticated) {
    return <div>로딩 중...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/dashboard" className="text-blue-600 hover:underline">
            대시보드
          </Link>
          <span>/</span>
          <h1 className="text-2xl font-bold text-gray-900">프로필</h1>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="space-y-4">
            <div>
              <p className="text-sm text-gray-600">이름</p>
              <p className="text-lg font-medium text-gray-900">{user?.name}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">이메일</p>
              <p className="text-lg font-medium text-gray-900">{user?.email}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">가입일</p>
              <p className="text-lg font-medium text-gray-900">
                {user?.createdAt && new Date(user.createdAt).toLocaleDateString('ko-KR')}
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
