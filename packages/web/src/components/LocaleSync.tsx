'use client';

import { useEffect } from 'react';

import { useTranslation } from '@money/core/lib/i18n';

/**
 * 문서의 언어 표시(`<html lang>`)와 탭 제목을 고른 언어에 맞춘다.
 *
 * 루트 레이아웃은 서버 컴포넌트라 lang을 고정값으로만 적을 수 있다. 이 값은
 * 화면에 보이지 않지만 화면 읽어 주는 프로그램이 어느 말로 읽을지, 브라우저가
 * 어느 사전으로 맞춤법을 볼지, 줄을 어디서 끊을지를 정한다. 한국어로 적힌 채
 * 영어를 그리면 그 판단이 전부 어긋난다.
 */
export function LocaleSync() {
  const { locale, t } = useTranslation();

  useEffect(() => {
    document.documentElement.lang = locale;

    /*
     * 탭 제목도 함께 바꾼다.
     *
     * 루트 레이아웃의 metadata는 서버가 만드는 값이라 사용자마다 다를 수 없다.
     * 거기에는 언어와 상관없는 앱 이름만 두고, 설명은 여기서 붙인다.
     */
    document.title = `${t('app.title')} - ${t('app.description')}`;
  }, [locale, t]);

  return null;
}
