'use client';

import { useState } from 'react';
import { SUPPORTED_LOCALES, type Locale } from '@money/types';

import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { useLocaleStore } from '@money/core/store/locale';

/** 언어 이름을 담은 열쇠. 사전이 세 언어 모두에서 같은 값(그 나라 말)을 갖는다. */
const NAME_KEY: Record<Locale, MessageKey> = {
  ko: 'language.ko',
  en: 'language.en',
  ja: 'language.ja',
};

/**
 * 화면 언어를 고르는 자리.
 *
 * 목록(select)이 아니라 세 칸을 한 줄에 늘어놓는다. 셋뿐이라 접어 둘 까닭이 없고,
 * 지금 무엇으로 보고 있는지가 열지 않고도 보인다.
 */
export default function LanguageSettings() {
  const { t, locale } = useTranslation();
  const { setLocale, isSaving } = useLocaleStore();
  const [error, setError] = useState('');

  const choose = async (next: Locale) => {
    setError('');

    try {
      await setLocale(next);
    } catch (err) {
      console.error('언어 변경 실패:', err);
      // 스토어가 이미 이전 언어로 되돌려 두었다. 알림은 그 언어로 적힌다.
      setError(t('settings.language.saveFailed'));
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold text-gray-900">{t('settings.language.title')}</h2>
      <p className="mt-1 text-sm text-gray-600">{t('settings.language.description')}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {SUPPORTED_LOCALES.map((code) => {
          const selected = code === locale;

          return (
            <button
              key={code}
              type="button"
              onClick={() => choose(code)}
              disabled={isSaving}
              aria-pressed={selected}
              /* 고른 칸 표시는 사이드바 메뉴·분류 목록과 같은 값을 쓴다. */
              className={`min-w-24 rounded-lg border px-4 py-2 text-sm transition disabled:opacity-50 ${
                selected
                  ? 'border-blue-600 bg-blue-50 font-medium text-blue-600'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {t(NAME_KEY[code])}
            </button>
          );
        })}
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
