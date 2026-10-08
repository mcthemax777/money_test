'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import CountBadge from '@/components/CountBadge';
import PageHeader from '@/components/PageHeader';
import ExchangeRateSettings from '@/components/ExchangeRateSettings';
import LanguageSettings from '@/components/LanguageSettings';
import WeekStartSettings from '@/components/WeekStartSettings';
import { useTranslation } from '@money/core/lib/i18n';
import { useProject } from '@money/core/store/project';
import { useInquiryUnread } from '@money/core/store/inquiry-unread';

export default function SettingsPage() {
  const { t } = useTranslation();
  const projects = useProject((state) => state.projects);
  const inquiryUnread = useInquiryUnread((state) => state.count);
  const refreshInquiryUnread = useInquiryUnread((state) => state.refresh);

  /*
   * 설정을 열 때도 한 번 더 센다. 창으로 돌아올 때 세는 것은 껍데기(`AppShell`)가 한다.
   */
  useEffect(() => {
    void refreshInquiryUnread();
  }, [refreshInquiryUnread]);

  return (
    <div className="space-y-6">
      <PageHeader title={t('settings.title')} />

      {/*
        차례 (2026-10-09 사용자 요청): 내 정보, 프로젝트 관리, 분류·태그, 시작 요일, 언어, 환율, 엑셀,
        문의하기. 앱은 끝에 보내지 못한 거래가 하나 더 선다. 설명은 적지 않는다 -- 들어간 화면이 말한다.
      */}
      <div className="space-y-4">
        <SettingsCard
          href="/settings/profile"
          title={t('settings.profile.title')}
        />

        <SettingsCard
          href="/settings/projects"
          title={t('settings.projects.title')}
        />

        {/*
          분류와 태그는 한 번 짜 두고 오래 쓰는 것이라 메뉴에서 내려 여기에 둔다.
          가계부가 있어야 뜻이 있으므로, 없는 사람에게는 보이지 않는다.
        */}
        {projects.length > 0 ? (
          <SettingsCard
            href="/settings/categories"
            title={t('settings.categories.title')}
          />
        ) : null}

        {/* 시작 요일은 이 계정의 값이다. 달력과 주 단위 보기가 함께 본다. */}
        <WeekStartSettings />

        {/* 언어는 이 계정의 값이고 환율은 프로젝트의 값이다. 자리는 같아도 뜻이 다르다. */}
        <LanguageSettings />

        {/*
          환율을 손으로 정하는 유일한 자리.
          거래 입력에서는 실제 금액만 받고 환율은 계산해 보여 준다.
        */}
        <ExchangeRateSettings />

        {/* 거래내역을 엑셀로 내보내고, 엑셀의 거래를 한꺼번에 넣는다. 가계부가 있어야 뜻이 있다. */}
        {projects.length > 0 ? (
          <SettingsCard
            href="/settings/sheet"
            title={t('settings.sheet.title')}
          />
        ) : null}

        {/* 관리자에게 문의. 답이 오면 읽지 않은 답의 수가 배지로 선다(앱과 같다). */}
        <SettingsCard
          href="/settings/inquiries"
          title={t('settings.inquiries.title')}
          badge={inquiryUnread}
        />
      </div>
    </div>
  );
}

/** 하위 화면으로 들어가는 칸. 앱의 SettingsScreen 에도 같은 짝이 있다. */
function SettingsCard({
  href,
  title,
  badge = 0,
}: {
  href: string;
  title: string;
  /** 제목 옆의 빨간 건수. 0 이면 그리지 않는다. */
  badge?: number;
}) {
  return (
    <Link href={href} className="block">
      <div className="bg-white rounded-lg shadow p-6 hover:shadow-md transition cursor-pointer">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            {title}
            <CountBadge count={badge} inline />
          </h2>
          <div className="text-2xl">→</div>
        </div>
      </div>
    </Link>
  );
}
