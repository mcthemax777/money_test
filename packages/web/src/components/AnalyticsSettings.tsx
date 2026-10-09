'use client';

import { useAnalyticsPrefs } from '@money/core/lib/analytics';
import { useTranslation } from '@money/core/lib/i18n';

/**
 * 사용 통계를 보낼지. 이 브라우저에만 남는 값이다(계정이 아니다).
 *
 * 시작 요일 칸(`WeekStartSettings`)과 같은 모양이다. 앱은 같은 값을 팝업으로 고른다.
 */
export default function AnalyticsSettings() {
  const { t } = useTranslation();
  const { enabled, setEnabled } = useAnalyticsPrefs();

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900">{t('settings.analytics.title')}</h2>
        <select
          value={enabled ? 'on' : 'off'}
          onChange={(e) => setEnabled(e.target.value === 'on')}
          aria-label={t('settings.analytics.title')}
          className="px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="on">{t('settings.analytics.on')}</option>
          <option value="off">{t('settings.analytics.off')}</option>
        </select>
      </div>
    </div>
  );
}
