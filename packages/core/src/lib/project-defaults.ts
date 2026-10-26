import type { CurrencyCode } from '@money/types';

import { activeLocale } from './i18n';

/**
 * 새 가계부의 저장 통화와 시간대 (2026-10-25). 이 기기의 시간대와 화면 언어에서 고른다.
 *
 * 저장 통화는 만든 뒤 바꿀 수 없으므로 가장 그럴듯한 값을 고른다: 시간대가 서울·도쿄면 원·엔, 아니면 화면 언어
 * (한국어 원, 일본어 엔, 그 밖 달러). 시간대를 읽지 못하면 서울이다 (서버의 기본값과 같다).
 */
export function newProjectDefaults(): { ledgerCurrency: CurrencyCode; timezone: string } {
  const timezone = deviceTimeZone();
  return { ledgerCurrency: currencyFor(timezone, activeLocale()), timezone };
}

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul';
  } catch {
    return 'Asia/Seoul';
  }
}

function currencyFor(timezone: string, locale: string): CurrencyCode {
  if (timezone === 'Asia/Seoul') return 'KRW';
  if (timezone === 'Asia/Tokyo') return 'JPY';
  if (locale === 'ko') return 'KRW';
  if (locale === 'ja') return 'JPY';
  return 'USD';
}
