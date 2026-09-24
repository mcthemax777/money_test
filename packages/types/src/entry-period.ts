/**
 * 거래 목록을 무엇으로 묶는가 -- 해, 달, 주.
 *
 * 거래 화면의 **바깥 묶음**이다. 안쪽 묶음(날짜별·분류별·수단별)과는 다른 축이다.
 * 오래 쓴 가계부에서는 달이 예순 줄이 되어 한 해를 한눈에 볼 수 없고, 반대로 이번 달만
 * 촘촘히 보려는 사람에게는 달이 너무 성기다.
 *
 * **열쇠 하나로 기간 하나를 가리킨다.** 서버·기기 사본·두 화면이 그 열쇠를 주고받고,
 * 거기서 조회 구간과 화면의 이름이 파생된다. 그래서 규칙을 여기 한 곳에 둔다 -- 두 벌이면
 * 같은 주가 화면마다 다른 날에서 시작한다.
 *
 * **날짜만 다룬다. 시각도 타임존도 여기 없다.** 넘어오는 것과 돌려주는 것이 모두 프로젝트
 * 타임존의 달력 날짜이고, 그 문자열을 인스턴트로 바꾸는 일은 부르는 쪽이 한다
 * (`recurring.ts` 와 같은 규칙이다).
 */

import { zonedDateKey } from './tz';

export type EntryPeriodUnit = 'year' | 'month' | 'week';

/** 저장·전달에 쓰는 기본값. 이 칸이 없는 옛 기기의 요청도 이것으로 읽는다. */
export const DEFAULT_ENTRY_PERIOD: EntryPeriodUnit = 'month';

export function isEntryPeriodUnit(value: unknown): value is EntryPeriodUnit {
  return value === 'year' || value === 'month' || value === 'week';
}

/**
 * 그 시각이 속한 기간의 열쇠.
 *
 *   year   "2026"
 *   month  "2026-09"
 *   week   "2026-09-13"  -- 그 주의 **일요일** 날짜다
 *
 * 주를 일요일에서 끊는 것은 이 저장소가 이미 그렇게 하고 있기 때문이다 -- 달력
 * (`TransactionCalendar`)이 `getDay()` 로 앞을 메우고, 요일 이름(`weekdayNames`)도
 * 일요일부터 센다. 한 화면에서 주가 월요일에 시작하고 다른 화면에서 일요일에 시작하면
 * 같은 거래가 다른 주에 들어간다.
 *
 * 열쇠는 **자릿수가 고정된 문자열**이라 같은 단위끼리는 사전순 비교가 곧 날짜 비교다.
 * 목록 정렬이 그것에 기댄다.
 */
export function periodKeyOf(
  date: Date | string,
  timeZone: string,
  unit: EntryPeriodUnit,
): string {
  const dateKey = zonedDateKey(new Date(date), timeZone);
  if (unit === 'year') return dateKey.slice(0, 4);
  if (unit === 'month') return dateKey.slice(0, 7);
  return weekStartKey(dateKey);
}

/**
 * 열쇠가 어느 단위의 것인가. 생김새가 스스로 말한다.
 *
 *   "2026"        4 자  해
 *   "2026-09"     7 자  달
 *   "2026-09-13" 10 자  주
 *
 * **읽는 쪽은 단위를 따로 받지 않는다.** 화면의 단위 상태와 손에 든 열쇠는 한 순간
 * 어긋난다 -- 단위를 바꾸면 상태가 먼저 바뀌고 새 목록은 그 다음에 온다. 그 사이에
 * 옛 열쇠를 새 단위로 읽으면 "2026-09" 를 해로 읽어 `Number` 가 NaN 이 되고, 그 값으로
 * 만든 날짜가 형식기에서 터진다(실제로 그랬다). 열쇠에서 읽으면 그 자리가 없다.
 */
export function unitOfKey(key: string): EntryPeriodUnit {
  if (key.length <= 4) return 'year';
  if (key.length <= 7) return 'month';
  return 'week';
}

/**
 * 기간의 첫날과 끝날. 양끝을 포함한 달력 날짜다.
 *
 * 조회 구간을 만드는 데 쓴다. 달에서도 돌려주지만, 부르는 쪽은 달 이름을 그대로 넘길 수
 * 있으면 그 편을 고른다 -- 경계를 만드는 일을 서버와 사본이 각자 아는 방법으로 하게
 * 두는 것이 거래 화면의 규칙이다(`useTransactions` 의 `monthRange`).
 *
 * 단위는 열쇠에서 읽는다 (`unitOfKey`).
 */
export function periodDayRange(key: string): { startKey: string; endKey: string } {
  const unit = unitOfKey(key);
  if (unit === 'year') {
    return { startKey: `${key}-01-01`, endKey: `${key}-12-31` };
  }
  if (unit === 'month') {
    const [year, month] = key.split('-').map(Number);
    return { startKey: `${key}-01`, endKey: formatKey(year, month, lastDay(year, month)) };
  }
  return { startKey: key, endKey: addDays(key, 6) };
}

/**
 * 그 날짜가 속한 주의 일요일.
 *
 * 주로 묶는 자리는 전부 이것을 지난다 -- 거래 목록의 주 묶음도, 자산 추이의 주 단위
 * 그래프도(`reports.service` 의 `weekBuckets`) 같은 날에서 주를 끊는다.
 *
 * UTC 로 센다. 달력 날짜만 다루므로 서머타임이 끼어들 자리가 없다 (`recurring.ts` 의
 * `addDays` 와 같은 까닭이다).
 */
export function weekStartKey(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return formatKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return formatKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** 그 달의 말일. 28~31 이다. */
function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatKey(year: number, month: number, day: number): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}
