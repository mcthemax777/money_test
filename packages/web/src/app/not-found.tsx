'use client';

import Link from 'next/link';
import { useTranslation } from '@money/core/lib/i18n';
import { FIRST_PATH } from '@money/core/lib/nav';

/**
 * 없는 주소 (2026-10-25). 없으면 Next 의 영어 기본 문구만 떴다. 첫 화면으로 돌아가는 길을 준다 -- 로그인하지
 * 않았으면 그 화면이 로그인으로 보낸다.
 */
export default function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-sm text-gray-700">{t('common.notFound')}</p>
      <Link
        href={FIRST_PATH}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        {t('common.goHome')}
      </Link>
    </div>
  );
}
