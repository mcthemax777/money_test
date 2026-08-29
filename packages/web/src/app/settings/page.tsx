'use client';

import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import ExchangeRateSettings from '@/components/ExchangeRateSettings';
import LanguageSettings from '@/components/LanguageSettings';
import { useTranslation } from '@/lib/i18n';

export default function SettingsPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <PageHeader title={t('settings.title')} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Link href="/settings/profile">
          <div className="bg-white rounded-lg shadow p-6 hover:shadow-md transition cursor-pointer">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {t('settings.profile.title')}
                </h2>
                <p className="mt-1 text-sm text-gray-600">
                  {t('settings.profile.description')}
                </p>
              </div>
              <div className="text-2xl">→</div>
            </div>
          </div>
        </Link>

        <Link href="/settings/projects">
          <div className="bg-white rounded-lg shadow p-6 hover:shadow-md transition cursor-pointer">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {t('settings.projects.title')}
                </h2>
                <p className="mt-1 text-sm text-gray-600">
                  {t('settings.projects.description')}
                </p>
              </div>
              <div className="text-2xl">→</div>
            </div>
          </div>
        </Link>
      </div>

      <div className="space-y-4">
        {/*
          환율을 손으로 정하는 유일한 자리.
          거래 입력에서는 실제 금액만 받고 환율은 계산해 보여 준다.
        */}
        <ExchangeRateSettings />

        {/* 언어는 이 계정의 값이고 환율은 프로젝트의 값이다. 자리는 같아도 뜻이 다르다. */}
        <LanguageSettings />

      </div>

    </div>
  );
}
