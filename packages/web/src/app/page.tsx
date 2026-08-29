'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/store/auth';
import { useTranslation } from '@/lib/i18n';

export default function Home() {
  const { t } = useTranslation();
  const router = useRouter();
  const { isAuthenticated, isInitializing } = useAuth();

  useEffect(() => {
    // isInitializing이 false가 될 때까지 기다렸다가 리다이렉트
    if (!isInitializing) {
      if (isAuthenticated) {
        router.push('/home');
      } else {
        router.push('/login');
      }
    }
  }, [isInitializing, isAuthenticated, router]);

  return (
    <div className="flex justify-center items-center h-screen">{t('shell.signingIn')}</div>
  );
}
