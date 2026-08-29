/**
 * 화면 언어.
 *
 * 사전(dictionary)에서 문구를 꺼내는 자리와, 날짜·숫자를 그 언어로 적는 자리를
 * 함께 둔다.
 *
 * 라이브러리를 넣지 않았다. 이 앱은 화면이 전부 클라이언트 컴포넌트라 언어별
 * 경로(/en/...)가 필요 없고, 필요한 것은 "고른 언어로 사전에서 문구를 꺼내는 것"
 * 하나뿐이다. next-intl 같은 것을 넣으면 App Router의 경로 구조까지 바꿔야 한다.
 */
import { useCallback, useMemo } from 'react';
import { DEFAULT_LOCALE, isLocale, localeTag, type Locale } from '@money/types';

import { useLocaleStore } from '@/store/locale';
import { en } from './messages/en';
import { ja } from './messages/ja';
import { ko, type MessageKey } from './messages/ko';

export type { MessageKey };

const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = { ko, en, ja };

/** `{name}` 자리를 채운다. 넘기지 않은 자리는 열쇠 이름 그대로 남는다. */
function fill(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;

  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/**
 * 문구 하나. React 밖(스토어, 유틸)에서도 쓸 수 있게 locale을 받는다.
 *
 * 사전에 없는 열쇠는 한국어로 되돌린다. 열쇠 문자열을 그대로 그리면 화면에
 * `home.tab.expense` 같은 것이 뜬다. 타입이 막고 있어 여기까지 오는 일은
 * 사전을 손으로 고쳐 깨뜨렸을 때뿐이다.
 */
export function translate(
  locale: Locale,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const dictionary = DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
  return fill(dictionary[key] ?? ko[key] ?? key, params);
}

/**
 * 화면에서 쓰는 통로.
 *
 * 스토어를 구독하므로 언어를 바꾸면 이 훅을 쓰는 컴포넌트가 다시 그려진다.
 */
export function useTranslation() {
  const locale = useLocaleStore((state) => state.locale);

  /*
   * t는 언어가 바뀔 때만 새로 만든다.
   *
   * 매번 새 함수를 돌려주면, 이 함수를 useCallback/useEffect의 의존성에 넣은
   * 화면이 그릴 때마다 그 효과를 다시 실행한다. 조회를 다시 부르는 자리에서는
   * 그대로 끝없는 되풀이가 된다.
   */
  const t = useCallback(
    (key: MessageKey, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale],
  );

  return useMemo(() => ({ locale, tag: localeTag(locale), t }), [locale, t]);
}

/**
 * React 밖에서 읽는 지금 언어의 Intl 태그.
 *
 * 날짜 표기 유틸(lib/datetime)처럼 훅을 쓸 수 없는 자리가 쓴다. 값을 따로 들고
 * 있지 않고 스토어를 그대로 읽는다. 두 곳에 두면 한쪽만 바뀐 채로 어긋난다.
 */
export function activeLocale(): Locale {
  const { locale } = useLocaleStore.getState();
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

export function activeLocaleTag(): string {
  return localeTag(activeLocale());
}
