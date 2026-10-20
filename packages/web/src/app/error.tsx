'use client';

import { useEffect } from 'react';
import { useTranslation } from '@money/core/lib/i18n';

import { isChunkError, reloadForChunk } from '@/components/WebUpdate';

/**
 * 화면 하나를 그리다 난 오류를 받는 자리 (2026-10-16).
 *
 * 없으면 어느 화면에서든 그리다 던진 오류 하나가 페이지를 통째로 비우고 Next 의 기본 문구만 남겼다. 배포 직후
 * 옛 조각을 받으려다 실패한 것이면 한 번 새로고침한다 -- 그 오류는 창(window)까지 올라오지 않고 여기서 멈춰,
 * WebUpdate 의 새로고침이 돌지 않았다.
 */
export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useTranslation();

  useEffect(() => {
    console.error('화면 오류:', error);
    if (isChunkError(error)) reloadForChunk();
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-sm text-gray-700">{t('common.pageError')}</p>
      <button
        type="button"
        onClick={reset}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        {t('common.retry')}
      </button>
    </div>
  );
}
