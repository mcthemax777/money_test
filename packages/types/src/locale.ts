/**
 * 화면 언어.
 *
 * 사용자마다 고르는 값이라 서버(User.locale)에 저장한다. 브라우저에만 두면 기기를
 * 바꿀 때마다 다시 골라야 한다.
 *
 * 프로젝트의 통화·타임존과는 다른 축이다. 통화는 원장이 무엇으로 적히는지이고
 * 언어는 그 원장을 누가 어떤 말로 읽는지다. 일본에 사는 사람이 원화 장부를
 * 일본어로 볼 수 있어야 한다.
 */

export const SUPPORTED_LOCALES = ['ko', 'en', 'ja'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** 고른 적이 없는 사용자와, 알 수 없는 값이 들어온 자리의 기본값. */
export const DEFAULT_LOCALE: Locale = 'ko';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Intl에 넘길 BCP 47 태그.
 *
 * 날짜·시각·숫자 표기는 사전에 적어 둘 것이 아니라 표준이 아는 값이다. 지역까지
 * 정해 준다. 'en'만 주면 실행 환경에 따라 영국식(31/12/2026)과 미국식(12/31/2026)이
 * 갈려 같은 화면이 기기마다 다르게 읽힌다.
 */
export const LOCALE_TAG: Record<Locale, string> = {
  ko: 'ko-KR',
  en: 'en-US',
  ja: 'ja-JP',
};

export function localeTag(locale: Locale): string {
  return LOCALE_TAG[locale];
}
