'use client';

import { useState } from 'react';
import { SUPPORTED_LOCALES, type Locale } from '@money/types';

import { useApiError } from '@money/core/lib/api-error';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { useLocaleStore } from '@money/core/store/locale';
import HelpTitle from '@/components/HelpTitle';

/** 언어 이름을 담은 열쇠. 사전이 세 언어 모두에서 같은 값(그 나라 말)을 갖는다. */
const NAME_KEY: Record<Locale, MessageKey> = {
  ko: 'language.ko',
  en: 'language.en',
  ja: 'language.ja',
};

/**
 * 화면 언어를 고르는 자리.
 *
 * 프로젝트 관리의 타임존·표시 통화 칸과 같은 모양이다 -- 왼쪽에 이름과 설명, 오른쪽에
 * 선택 상자. 접힌 상자에도 지금 값이 적혀 있어 열지 않고도 보인다.
 */
export default function LanguageSettings() {
  const { t, locale } = useTranslation();
  const { setLocale, isSaving } = useLocaleStore();
  const [error, setError] = useState('');
  const { messageOf } = useApiError();

  const choose = async (next: Locale) => {
    setError('');

    try {
      await setLocale(next);
    } catch (err) {
      console.error('언어 변경 실패:', err);
      // 스토어가 이미 이전 언어로 되돌려 두었다. 알림은 그 언어로 적힌다.
      // 서버에 닿지 못했으면 "연결되면 할 수 있습니다"로 말한다 (messageOf 가 가른다).
      setError(messageOf(err, 'settings.language.saveFailed'));
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* 설명을 펼쳐도 고르는 칸이 아래로 밀리지 않게 남은 너비만 쓴다. */}
        <div className="min-w-0 flex-1">
          <HelpTitle title={t('settings.language.title')} description={t('settings.language.description')} />
        </div>
        <select
          value={locale}
          onChange={(e) => choose(e.target.value as Locale)}
          disabled={isSaving}
          aria-label={t('settings.language.title')}
          className="px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {SUPPORTED_LOCALES.map((code) => (
            <option key={code} value={code}>
              {t(NAME_KEY[code])}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
