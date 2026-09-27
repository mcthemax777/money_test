'use client';

/*
 * 관리 도구의 껍데기. 사용자 화면(AppShell)과 따로다 -- 구글 로그인과 무관하게 관리자
 * 아이디·비밀번호로 들어온다.
 *
 * 로그인 화면을 뺀 모든 관리 화면은 들어올 때 토큰을 확인하고(`/admin/me`), 없거나 끝났으면
 * 관리 도구 로그인으로 보낸다.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { adminLogout, adminMe, getAdminToken } from '@/lib/admin-api';
import { ADMIN_TOOLS } from './tools';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === '/admin/login';
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    if (isLogin) return;
    if (!getAdminToken()) {
      router.replace('/admin/login');
      return;
    }
    let alive = true;
    adminMe()
      .then((me) => alive && setUsername(me.username))
      .catch(() => alive && router.replace('/admin/login'));
    return () => {
      alive = false;
    };
  }, [isLogin, router]);

  if (isLogin) return <div className="min-h-screen bg-gray-50">{children}</div>;
  if (!username) {
    return <div className="flex min-h-screen items-center justify-center bg-gray-50 text-sm text-gray-500">확인 중…</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-3">
          <Link href="/admin" className="font-semibold text-gray-900">
            관리 도구
          </Link>
          <nav className="flex flex-1 gap-1 overflow-x-auto">
            {ADMIN_TOOLS.map((tool) => (
              <Link
                key={tool.href}
                href={tool.href}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  pathname.startsWith(tool.href)
                    ? 'bg-blue-50 font-medium text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {tool.title}
              </Link>
            ))}
          </nav>
          <span className="hidden text-sm text-gray-500 sm:inline">{username}</span>
          <button
            type="button"
            onClick={() => {
              adminLogout();
              router.replace('/admin/login');
            }}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50 active:bg-gray-100"
          >
            로그아웃
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
    </div>
  );
}
