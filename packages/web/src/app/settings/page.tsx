'use client';

import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import ExchangeRateSettings from '@/components/ExchangeRateSettings';
import LanguageSettings from '@/components/LanguageSettings';
import WeekStartSettings from '@/components/WeekStartSettings';
import { useTranslation } from '@money/core/lib/i18n';
import { useProject } from '@money/core/store/project';

export default function SettingsPage() {
  const { t } = useTranslation();
  const projects = useProject((state) => state.projects);

  return (
    <div className="space-y-6">
      <PageHeader title={t('settings.title')} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <SettingsCard
          href="/settings/profile"
          title={t('settings.profile.title')}
          description={t('settings.profile.description')}
        />

        <SettingsCard
          href="/settings/projects"
          title={t('settings.projects.title')}
          description={t('settings.projects.description')}
        />

        {/*
          분류와 태그는 한 번 짜 두고 오래 쓰는 것이라 메뉴에서 내려 여기에 둔다.
          가계부가 있어야 뜻이 있으므로, 없는 사람에게는 보이지 않는다.
        */}
        {projects.length > 0 ? (
          <SettingsCard
            href="/settings/categories"
            title={t('settings.categories.title')}
            description={t('settings.categories.description')}
          />
        ) : null}
      </div>

      <div className="space-y-4">
        {/*
          환율을 손으로 정하는 유일한 자리.
          거래 입력에서는 실제 금액만 받고 환율은 계산해 보여 준다.
        */}
        <ExchangeRateSettings />

        {/* 언어는 이 계정의 값이고 환율은 프로젝트의 값이다. 자리는 같아도 뜻이 다르다. */}
        <LanguageSettings />

        {/* 시작 요일도 이 계정의 값이다. 달력과 주 단위 보기가 함께 본다. */}
        <WeekStartSettings />
      </div>

    </div>
  );
}

/** 하위 화면으로 들어가는 칸. 앱의 SettingsScreen 에도 같은 짝이 있다. */
function SettingsCard({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link href={href}>
      <div className="bg-white rounded-lg shadow p-6 hover:shadow-md transition cursor-pointer">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
            <p className="mt-1 text-sm text-gray-600">{description}</p>
          </div>
          <div className="text-2xl">→</div>
        </div>
      </div>
    </Link>
  );
}
