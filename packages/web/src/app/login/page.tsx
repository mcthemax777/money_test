'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/store/auth';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';

export default function LoginPage() {
  const router = useRouter();
  const { signInWithGoogle, isLoading, isAuthenticated } = useAuth();
  const [error, setError] = useState('');

  useEffect(() => {
    if (isAuthenticated) {
      router.push('/dashboard');
    }
  }, [isAuthenticated, router]);

  const handleCredential = useCallback(
    async (idToken: string) => {
      setError('');

      try {
        await signInWithGoogle(idToken);
        router.push('/dashboard');
      } catch {
        setError('로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.');
      }
    },
    [signInWithGoogle, router],
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8 px-4">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">bboyong</h1>
          <p className="mt-2 text-sm text-gray-600">개인 재무 관리 서비스</p>
        </div>

        {error && (
          <div className="p-3 bg-red-50 text-red-800 text-sm rounded">{error}</div>
        )}

        <div className="space-y-4">
          <GoogleSignInButton onCredential={handleCredential} onError={setError} />

          {isLoading && (
            <p className="text-center text-sm text-gray-600">로그인 중...</p>
          )}
        </div>

        <p className="text-center text-xs text-gray-500">
          구글 계정으로 로그인하면 계정이 자동으로 만들어집니다.
        </p>
      </div>
    </div>
  );
}
