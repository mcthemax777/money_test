'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@money/core/store/auth';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';
import { useTranslation } from '@money/core/lib/i18n';
import { FIRST_PATH } from '@money/core/lib/nav';
import { LEGAL_PATHS } from '@money/core/lib/legal';
import { useApiError } from '@money/core/lib/api-error';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { signInWithGoogle, isLoading, isAuthenticated } = useAuth();
  const [error, setError] = useState('');
  const { messageOf } = useApiError();
  /**
   * 이용약관·개인정보처리방침 동의와 만 14세 이상 확인 (2026-10-25, 앱과 같다). 구글 단추는 구글 스크립트가 그려
   * 끌 수 없으므로, 체크해야 단추가 나타난다. 새 계정은 서버도 이 확인 없이 만들지 않는다(TERMS_REQUIRED).
   */
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      router.push(FIRST_PATH);
    }
  }, [isAuthenticated, router]);

  const handleCredential = useCallback(
    async (idToken: string) => {
      setError('');

      try {
        await signInWithGoogle(idToken, agreed);
        router.push(FIRST_PATH);
      } catch (caught) {
        setError(messageOf(caught, 'login.failed'));
      }
    },
    [signInWithGoogle, router, agreed, messageOf],
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
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>{t('login.agree')}</span>
          </label>
          <p className="flex justify-center gap-4 text-xs text-gray-500">
            <Link href={LEGAL_PATHS.terms} className="underline" target="_blank">
              {t('login.terms')}
            </Link>
            <Link href={LEGAL_PATHS.privacy} className="underline" target="_blank">
              {t('login.privacy')}
            </Link>
          </p>

          {agreed ? <GoogleSignInButton onCredential={handleCredential} onError={setError} /> : null}

          {isLoading && (
            <p className="text-center text-sm text-gray-600">{t('shell.signingIn')}</p>
          )}
        </div>

        <p className="text-center text-xs text-gray-500">{t('login.autoSignup')}</p>
      </div>
    </div>
  );
}
