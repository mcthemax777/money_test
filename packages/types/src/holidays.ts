/**
 * 휴일 판정의 공용 조각. 반복 등록의 "휴일 제외"·"휴일이면 앞/뒤 평일"이 쓴다.
 *
 * **공휴일 목록은 여기 없다.** 서버 DB(`PublicHoliday`)에 있고, 관리 도구에서 발표될 때마다
 * 갱신한다. 셈하는 쪽(서버)이 그 나라의 목록을 읽어 일정에 실어 준다
 * (`RecurringSchedule.publicHolidays`). 웹과 앱은 공휴일을 셈하지 않는다.
 *
 * 나라는 가계부의 시간대로 정한다(`holidayCountryOf`). 시간대 목록이 짧아서(core 의
 * `time-zones`) 나라를 따로 고르게 하지 않는다. UTC 는 한국으로 본다 -- 이 앱의 기본이다.
 */

export const HOLIDAY_COUNTRIES = ['KR', 'JP', 'CN', 'SG', 'GB', 'US'] as const;
export type HolidayCountry = (typeof HOLIDAY_COUNTRIES)[number];

/** 시간대 → 나라. 목록에 없는 시간대는 한국이다. */
const COUNTRY_OF_TIME_ZONE: Record<string, HolidayCountry> = {
  'Asia/Seoul': 'KR',
  'Asia/Tokyo': 'JP',
  'Asia/Shanghai': 'CN',
  'Asia/Singapore': 'SG',
  'Europe/London': 'GB',
  'America/New_York': 'US',
  'America/Los_Angeles': 'US',
  UTC: 'KR',
};

export function holidayCountryOf(timeZone: string | null | undefined): HolidayCountry {
  return (timeZone && COUNTRY_OF_TIME_ZONE[timeZone]) || 'KR';
}

/** 요일. 0 이 일요일, 6 이 토요일이다 (`Date.getUTCDay` 와 같다). */
export function weekdayOf(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay();
}

/** 토요일·일요일인가. 여섯 나라 모두 주말이 토·일이다. */
export function isWeekend(dateKey: string): boolean {
  const day = weekdayOf(dateKey);
  return day === 0 || day === 6;
}
