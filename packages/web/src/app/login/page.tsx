'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@money/core/store/auth';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';
import { useTranslation } from '@money/core/lib/i18n';

export default function LoginPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { signInWithGoogle, isLoading, isAuthenticated } = useAuth();
  const [error, setError] = useState('');

  useEffect(() => {
    if (isAuthenticated) {
      router.push('/home');
    }
  }, [isAuthenticated, router]);

  const handleCredential = useCallback(
    async (idToken: string) => {
      setError('');

      try {
        await signInWithGoogle(idToken);
        router.push('/home');
      } catch {
        setError(t('login.failed'));
      }
    },
    [signInWithGoogle, router, t],
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8 px-4">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">bboyong</h1>
          <p className="mt-2 text-sm text-gray-600">{t('login.tagline')}</p>
        </div>

        {error && (
          <div className="p-3 bg-red-50 text-red-800 text-sm rounded">{error}</div>
        )}

        <div className="space-y-4">
          <GoogleSignInButton onCredential={handleCredential} onError={setError} />

          {isLoading && (
            <p className="text-center text-sm text-gray-600">{t('shell.signingIn')}</p>
          )}
        </div>

        <p className="text-center text-xs text-gray-500">{t('login.autoSignup')}</p>
      </div>
    </div>
  );
}
