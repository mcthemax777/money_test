'use client';

import { useProjectAccessNotice } from '@money/core/hooks/useProjectAccessNotice';
import { useTranslation } from '@money/core/lib/i18n';

/**
 * 내보내졌다는 소식을 알리는 창. 앱의 `ProjectAccessLostAlert` 와 같은 자리다.
 *
 * **늘 떠 있는 자리 둘에 둔다** -- 껍데기(`AppShell`)와 시작 화면(`/start`). 마지막
 * 가계부에서 내보내지면 껍데기를 쓰는 화면에서 시작 화면으로 옮겨 가는데, 한쪽에만
 * 두면 그 순간에 소식이 사라진다. 소식은 스토어에 있어(`accessLostName`) 어느 쪽에서
 * 그리든 같은 글이 뜬다.
 *
 * 무엇을 할지(목록 다시 받기, 남은 가계부로 옮기기)는 core 가 이미 했다. 여기는 그
 * 결과를 사람에게 말하는 자리다.
 */
export default function ProjectAccessLostDialog() {
  const { t } = useTranslation();
  const { lostName, dismiss } = useProjectAccessNotice();

  if (lostName === null) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-gray-900">{t('project.accessLost.title')}</h2>
        {/* 이름을 알면 어느 가계부인지 함께 적는다. 가계부를 여럿 쓰는 사람에게는 그것이 요점이다. */}
        {lostName ? <p className="mt-2 font-medium text-gray-900">{lostName}</p> : null}
        <p className="mt-2 text-sm text-gray-600">{t('project.accessLost.body')}</p>

        <button
          type="button"
          onClick={dismiss}
          autoFocus
          className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white hover:bg-blue-700"
        >
          {t('common.close')}
        </button>
      </div>
    </div>
  );
}
