'use client';

/*
 * 웹의 업데이트 안내. 설치가 없으니 새로고침이 곧 업데이트다.
 *
 * 셋을 한다.
 *
 *   - **강제.** 서버가 이 빌드를 426 으로 거절하면(관리 도구에서 웹 최소 빌드를 올렸을 때)
 *     닫을 수 없는 창을 띄운다. API 를 옛 화면과 맞지 않게 바꾸는 배포에서만 쓴다.
 *   - **권유.** 탭이 다시 보일 때와 10분마다 `/version` 을 물어, 배포된 빌드가 이 탭과
 *     다르면 아래쪽에 "새 버전이 있습니다" 띠를 띄운다. 적던 것이 있을 수 있어 스스로
 *     새로고침하지 않는다.
 *   - **지워진 조각.** 배포하면 옛 빌드의 JS 조각이 서버에서 사라진다. 옛 탭이 그 조각을
 *     부르면 실패하므로, 그때는 한 번 새로고침한다(되풀이하지 않게 30초에 한 번까지).
 */
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { RefreshCw, X } from 'lucide-react';

import { useTranslation } from '@money/core/lib/i18n';
import { checkAppUpdate, installUpdateHandler, useUpdateLevel } from '@money/core/store/app-update';

/** 이 탭의 빌드 번호. 빌드할 때 박힌다(next.config.js). */
const WEB_VERSION = process.env.NEXT_PUBLIC_WEB_VERSION ?? '';

/*
 * 첫 요청보다 먼저 이 빌드를 알린다. 이 모듈이 읽히는 때가 어느 컴포넌트의 효과보다 앞이다
 * -- 효과 안에서 하면 AuthInitializer 가 먼저 보낸 요청에는 머리글이 없다.
 */
if (typeof window !== 'undefined' && WEB_VERSION) {
  installUpdateHandler('web', WEB_VERSION);
}

/** 새 빌드를 묻는 간격. 탭을 켜 둔 채 며칠 두는 일이 흔하다. */
const POLL_MS = 10 * 60 * 1000;

/** 조각 실패로 새로고침한 시각. 새로고침해도 또 실패하면 되풀이하지 않는다. */
const CHUNK_RELOAD_KEY = 'money-chunk-reload-at';
const CHUNK_RELOAD_GAP_MS = 30 * 1000;

function isChunkError(reason: unknown): boolean {
  const error = reason as { name?: string; message?: string } | null;
  return (
    error?.name === 'ChunkLoadError' ||
    /Loading chunk [\w-]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module/i.test(
      error?.message ?? '',
    )
  );
}

function reloadForChunk(): void {
  try {
    const last = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? 0);
    if (Date.now() - last < CHUNK_RELOAD_GAP_MS) return;
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {
    // 저장소가 막혀 있으면 되풀이를 막을 길이 없다. 새로고침하지 않는다.
    return;
  }
  window.location.reload();
}

/** 지금 배포된 빌드 번호. 못 읽으면 null(오프라인·배포 중). */
async function deployedVersion(): Promise<string | null> {
  try {
    const response = await fetch('/version', { cache: 'no-store' });
    if (!response.ok) return null;
    const data = (await response.json()) as { version?: string | null };
    return data.version ?? null;
  } catch {
    return null;
  }
}

export function WebUpdate() {
  const { t } = useTranslation();
  const level = useUpdateLevel();
  const pathname = usePathname();
  const [hasNewBuild, setHasNewBuild] = useState(false);
  const [isBannerClosed, setIsBannerClosed] = useState(false);

  useEffect(() => {
    if (!WEB_VERSION) return;

    const check = async () => {
      void checkAppUpdate();
      const deployed = await deployedVersion();
      if (deployed && deployed !== WEB_VERSION) setHasNewBuild(true);
    };

    void check();
    const timer = window.setInterval(() => void check(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);

    const onError = (event: ErrorEvent) => {
      if (isChunkError(event.error ?? { message: event.message })) reloadForChunk();
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      if (isChunkError(event.reason)) reloadForChunk();
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  /*
   * 관리 도구에는 강제 창을 띄우지 않는다. 웹 최소 빌드를 잘못 올려도 되돌릴 자리가 남아야
   * 한다 -- 관리 도구의 서버 길은 버전 검사를 건너뛴다.
   */
  if (level === 'force' && !pathname?.startsWith('/admin')) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4">
        <div
          role="alertdialog"
          aria-modal="true"
          className="dialog-enter w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        >
          <h2 className="text-lg font-semibold text-gray-900">{t('update.forceTitle')}</h2>
          <p className="mt-3 text-sm text-gray-700">{t('update.webForceBody')}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            {t('update.webReload')}
          </button>
        </div>
      </div>
    );
  }

  // 관리 도구에서 웹 권유 빌드를 올렸을 때도 같은 띠다.
  if ((!hasNewBuild && level !== 'recommend') || isBannerClosed) return null;

  return (
    <div className="unfold fixed inset-x-0 bottom-4 z-[90] flex justify-center px-4">
      <div
        role="status"
        className="flex items-center gap-3 rounded-full bg-gray-900 py-2 pl-4 pr-2 text-sm text-white shadow-lg"
      >
        <span>{t('update.webNew')}</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-full bg-white px-3 py-1 font-medium text-gray-900 hover:bg-gray-100"
        >
          {t('update.webReload')}
        </button>
        <button
          type="button"
          onClick={() => setIsBannerClosed(true)}
          aria-label={t('update.later')}
          className="rounded-full p-1 text-gray-300 hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
