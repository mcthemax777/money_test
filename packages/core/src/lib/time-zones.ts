/**
 * 프로젝트가 고를 수 있는 타임존.
 *
 * 세상의 타임존을 다 늘어놓지 않는다. 월 합계와 카드 마감/결제일의 경계를 정하는 값이라
 * 목록이 길어지면 고르기만 어려워진다. 쓰는 사람이 있는 곳만 둔다.
 *
 * 웹과 앱이 같은 목록을 봐야 한다. 한쪽에만 있는 타임존을 고르면 다른 화면에서는 그 값이
 * 목록에 없어 무엇으로 계산되는지 알 수 없다.
 */
import type { MessageKey } from './i18n';

export interface TimeZoneOption {
  id: string;
  /** UTC 처럼 옮길 이름이 없는 것은 비운다. 그때는 id 를 그대로 적는다. */
  nameKey?: MessageKey;
}

export const TIME_ZONE_OPTIONS: TimeZoneOption[] = [
  { id: 'Asia/Seoul', nameKey: 'tz.seoul' },
  { id: 'Asia/Tokyo', nameKey: 'tz.tokyo' },
  { id: 'Asia/Shanghai', nameKey: 'tz.shanghai' },
  { id: 'Asia/Singapore', nameKey: 'tz.singapore' },
  { id: 'Europe/London', nameKey: 'tz.london' },
  { id: 'America/New_York', nameKey: 'tz.newYork' },
  { id: 'America/Los_Angeles', nameKey: 'tz.losAngeles' },
  { id: 'UTC' },
];
