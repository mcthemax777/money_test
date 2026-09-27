'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { adminLogin } from '@/lib/admin-api';

/** 관리 도구 로그인. 아이디·비밀번호는 서버 환경 변수에 있다(ADMIN_USERNAME / ADMIN_PASSWORD_HASH). */
export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      await adminLogin(username.trim(), password);
      router.replace('/admin');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '로그인하지 못했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
      >
        <h1 className="text-lg font-semibold text-gray-900">관리 도구</h1>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">아이디</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoFocus
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">비밀번호</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </label>
        {error ? <p className="rounded bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
        <button
          type="submit"
          disabled={isSubmitting || !username || !password}
          className="w-full rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50"
        >
          {isSubmitting ? '들어가는 중…' : '로그인'}
        </button>
      </form>
    </div>
  );
}
