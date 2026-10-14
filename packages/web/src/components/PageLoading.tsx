/**
 * 화면을 옮기는 동안 본문 자리에 두는 표시.
 *
 * 각 화면 폴더의 loading.tsx가 이것을 그린다. 이 경계가 없으면 다음 화면이 다 될
 * 때까지 앞 화면이 그대로 남아, 눌러 놓고 아무 일도 일어나지 않는 것처럼 보인다.
 * 껍데기(사이드바·탭)는 레이아웃에 있어 그대로 남고 본문만 바뀐다.
 */
'use client';

import { useTranslation } from '@money/core/lib/i18n';

import LoadingBlock from './LoadingBlock';

/** 글자 대신 돌림 표시를 세운다 (2026-10-15 사용자 요청 -- 기다릴 때는 움직이는 표시). */
export default function PageLoading() {
  const { t } = useTranslation();

  return <LoadingBlock label={t('common.loading')} />;
}
