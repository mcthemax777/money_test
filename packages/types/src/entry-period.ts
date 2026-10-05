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
import { DEFAULT_WEEK_START, weekdayOffset, type WeekStart } from './week-start';

export type EntryPeriodUnit = 'year' | 'month' | 'week';

/** 저장·전달에 쓰는 기본값. 이 칸이 없는 옛 기기의 요청도 이것으로 읽는다. */
export const DEFAULT_ENTRY_PERIOD: EntryPeriodUnit = 'month';

export function isEntryPeriodUnit(value: unknown): value is EntryPeriodUnit {
  return value === 'year' || value === 'month' || value === 'week';
}

/**
 * 열쇠가 가리키는 기간의 갈래. 묶는 단위 셋에 **직접 정한 기간**(`range`)이 더해진다.
 *
 * 거래 화면의 검색에서 기간을 정하면 그 기간 전체가 줄 하나가 된다. 그 줄도 열쇠 하나로
 * 가리켜야 펼치기·분석이 같은 길을 지난다.
 */
export type PeriodKeyUnit = EntryPeriodUnit | 'range';

/**
 * 기간을 어디서 끊을지. 거래 화면의 검색이 고른다. 없거나 1 이면 달력대로다.
 *
 *   monthStartDay   달이 며칠에 시작하는가 (1~31). 14 면 8월 14일 ~ 9월 13일이 한 달이다.
 *                   그 달에 그날이 없으면(2월 31일) 그 달의 말일에 시작한다.
 *   yearStartMonth  해가 몇 월에 시작하는가 (1~12). 3 이면 3월 ~ 이듬해 2월이 한 해다.
 *
 * 주를 어느 요일에서 끊을지는 따로 받는다(`WeekStart`). 주 열쇠는 그 주의 첫날이라
 * 요일이 열쇠 안에 이미 들어 있다.
 */
export interface PeriodAnchor {
  monthStartDay?: number;
  yearStartMonth?: number;
}

/**
 * 조회에 실려 온 끊는 자리를 읽는다. 질의 문자열이라 숫자가 문자로 온다.
 *
 * 읽을 수 없거나 범위 밖이면 그 칸을 버린다 -- 달력대로 묶는 것이 조용히 엉뚱한 날에서
 * 끊는 것보다 낫다. 서버와 기기 사본이 같은 것을 쓴다.
 */
export function asPeriodAnchor(query: {
  monthStartDay?: unknown;
  yearStartMonth?: unknown;
}): PeriodAnchor {
  const day = Number(query.monthStartDay);
  const month = Number(query.yearStartMonth);
  return {
    ...(Number.isInteger(day) && day >= 1 && day <= 31 ? { monthStartDay: day } : {}),
    ...(Number.isInteger(month) && month >= 1 && month <= 12 ? { yearStartMonth: month } : {}),
  };
}

/** 시작일·시작 월이 1 이 아닌가. 1 이면 달력의 달·해와 같아 열쇠도 그대로다. */
function anchoredDay(anchor: PeriodAnchor | undefined): number | null {
  const day = anchor?.monthStartDay;
  return day && Number.isInteger(day) && day > 1 && day <= 31 ? day : null;
}
function anchoredMonth(anchor: PeriodAnchor | undefined): number | null {
  const month = anchor?.yearStartMonth;
  return month && Number.isInteger(month) && month > 1 && month <= 12 ? month : null;
}

/** 시작일이 day 인 달이 그 달의 며칠에 시작하는가. 그날이 없으면 말일이다. */
function anchoredStart(year: number, month: number, day: number): number {
  return Math.min(day, lastDay(year, month));
}

const pad2 = (value: number) => String(value).padStart(2, '0');

/** 직접 정한 기간의 열쇠. 양끝을 포함한 달력 날짜 둘이다. */
export function rangePeriodKey(startKey: string, endKey: string): string {
  return `${startKey}~${endKey}`;
}

/**
 * 달 이름 하나로 가리킬 수 있는 열쇠인가. 시작일이 1 인 달("2026-09")만 그렇다.
 *
 * 조회는 그런 달만 이름으로 보내고, 나머지는 날짜 구간으로 보낸다 -- 시작일이 다른 달은
 * 서버가 아는 달 이름이 아니다.
 */
export function isCalendarMonthKey(key: string): boolean {
  return /^\d{4}-\d{2}$/.test(key);
}

/**
 * 그 시각이 속한 기간의 열쇠.
 *
 *   year   "2026"
 *   month  "2026-09"
 *   week   "2026-09-13"  -- 그 주의 **첫날** 날짜다
 *
 * 주를 어느 요일에서 끊을지는 사용자가 고른다 (`WeekStart`, 기본은 일요일). 달력
 * (`TransactionCalendar`)이 앞을 메우는 칸 수도 요일 이름의 차례(`weekdayNames`)도
 * 같은 값을 본다. 한 화면에서 주가 월요일에 시작하고 다른 화면에서 일요일에 시작하면
 * 같은 거래가 다른 주에 들어간다.
 *
 * 열쇠는 **자릿수가 고정된 문자열**이라 같은 단위끼리는 사전순 비교가 곧 날짜 비교다.
 * 목록 정렬이 그것에 기댄다.
 */
export function periodKeyOf(
  date: Date | string,
  timeZone: string,
  unit: EntryPeriodUnit,
  weekStart: WeekStart = DEFAULT_WEEK_START,
  /**
   * 달·해를 어디서 끊을지 (`PeriodAnchor`). 끊는 자리가 1 이 아니면 열쇠에 붙는다.
   *
   *   달  "2026-08@14"  -- 2026년 8월 14일에 시작하는 한 달
   *   해  "2026@03"     -- 2026년 3월에 시작하는 한 해
   *
   * 붙여 두는 것은 열쇠 하나로 기간이 정해져야 해서다. "2026-08" 만 넘기면 받는 쪽이
   * 시작일을 따로 알아야 하고, 그 값이 엇갈리면 같은 줄이 다른 날을 덮는다.
   */
  anchor?: PeriodAnchor,
): string {
  const dateKey = zonedDateKey(new Date(date), timeZone);
  if (unit === 'week') return weekStartKey(dateKey, weekStart);

  const [year, month, day] = dateKey.split('-').map(Number);
  if (unit === 'year') {
    const startMonth = anchoredMonth(anchor);
    if (!startMonth) return dateKey.slice(0, 4);
    return `${month >= startMonth ? year : year - 1}@${pad2(startMonth)}`;
  }

  const startDay = anchoredDay(anchor);
  if (!startDay) return dateKey.slice(0, 7);
  // 그 달의 시작일 전이면 앞 달에 시작한 기간이다.
  if (day >= anchoredStart(year, month, startDay)) return `${year}-${pad2(month)}@${pad2(startDay)}`;
  const previous = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  return `${previous.year}-${pad2(previous.month)}@${pad2(startDay)}`;
}

/**
 * 열쇠가 어느 단위의 것인가. 생김새가 스스로 말한다.
 *
 *   "2026"        4 자  해       "2026@03"     3월에 시작하는 해
 *   "2026-09"     7 자  달       "2026-08@14"  14일에 시작하는 달
 *   "2026-09-13" 10 자  주
 *   "2026-08-14~2026-09-20"     직접 정한 기간 (range)
 *
 * **읽는 쪽은 단위를 따로 받지 않는다.** 화면의 단위 상태와 손에 든 열쇠는 한 순간
 * 어긋난다 -- 단위를 바꾸면 상태가 먼저 바뀌고 새 목록은 그 다음에 온다. 그 사이에
 * 옛 열쇠를 새 단위로 읽으면 "2026-09" 를 해로 읽어 `Number` 가 NaN 이 되고, 그 값으로
 * 만든 날짜가 형식기에서 터진다(실제로 그랬다). 열쇠에서 읽으면 그 자리가 없다.
 */
export function unitOfKey(key: string): PeriodKeyUnit {
  if (key.includes('~')) return 'range';
  // 끊는 자리가 붙은 열쇠("2026-08@14", "2026@03")는 앞의 모양이 단위다.
  const base = key.split('@')[0];
  if (base.length <= 4) return 'year';
  if (base.length <= 7) return 'month';
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
  if (unit === 'range') {
    const [startKey, endKey] = key.split('~');
    return { startKey, endKey };
  }
  const [base, anchorText] = key.split('@');
  if (unit === 'year') {
    const year = Number(base);
    if (!anchorText) return { startKey: `${base}-01-01`, endKey: `${base}-12-31` };
    // 시작 월의 1일부터 이듬해 그 달 앞까지.
    const startMonth = Number(anchorText);
    return {
      startKey: formatKey(year, startMonth, 1),
      endKey: addDays(formatKey(year + 1, startMonth, 1), -1),
    };
  }
  if (unit === 'month') {
    const [year, month] = base.split('-').map(Number);
    if (!anchorText) {
      return { startKey: `${base}-01`, endKey: formatKey(year, month, lastDay(year, month)) };
    }
    // 이 달의 시작일부터 다음 달 시작일 앞날까지. 시작일이 없는 달은 말일에 시작한다.
    const startDay = Number(anchorText);
    const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
    return {
      startKey: formatKey(year, month, anchoredStart(year, month, startDay)),
      endKey: addDays(formatKey(next.year, next.month, anchoredStart(next.year, next.month, startDay)), -1),
    };
  }
  return { startKey: key, endKey: addDays(key, 6) };
}

/**
 * 그 날짜가 속한 주의 첫날.
 *
 * 주로 묶는 자리는 전부 이것을 지난다 -- 거래 목록의 주 묶음도, 자산 추이의 주 단위
 * 그래프도(`reports.service` 의 `weekBuckets`) 같은 날에서 주를 끊는다.
 *
 * 시작 요일을 받지 않으면 일요일이다. 사용자가 고른 요일을 아는 자리(거래 화면과
 * 그 조회)만 값을 넘기고, 그 설정이 닿지 않는 자리는 지금까지와 같이 센다.
 *
 * UTC 로 센다. 달력 날짜만 다루므로 서머타임이 끼어들 자리가 없다 (`recurring.ts` 의
 * `addDays` 와 같은 까닭이다).
 */
export function weekStartKey(
  dateKey: string,
  weekStart: WeekStart = DEFAULT_WEEK_START,
): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - weekdayOffset(date.getUTCDay(), weekStart));
  return formatKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/**
 * 열쇠를 같은 단위로 delta 칸 옮긴다. 해는 해, 달은 달, 주는 7일씩이다.
 *
 * 분석 창의 앞뒤 단추와 추이 막대가 쓴다. 주 열쇠는 그 주의 첫날이므로 7일씩 옮기면
 * 시작 요일이 그대로 따라온다 -- 시작 요일을 다시 물을 필요가 없다.
 */
export function shiftPeriodKey(key: string, delta: number): string {
  const unit = unitOfKey(key);
  // 직접 정한 기간은 옮길 차례가 없다. 그대로 돌려준다 -- 화면은 앞뒤 단추를 두지 않는다.
  if (unit === 'range') return key;
  const [base, anchorText] = key.split('@');
  const suffix = anchorText ? `@${anchorText}` : '';
  if (unit === 'year') return `${Number(base) + delta}${suffix}`;
  if (unit === 'month') {
    const [year, month] = base.split('-').map(Number);
    const index = month - 1 + delta;
    const shiftedYear = year + Math.floor(index / 12);
    const shiftedMonth = (((index % 12) + 12) % 12) + 1;
    return `${shiftedYear}-${pad2(shiftedMonth)}${suffix}`;
  }
  return addDays(key, delta * 7);
}

/** 그 날짜의 다음 날. 양끝을 포함한 구간을 [시작, 끝) 로 바꿀 때 쓴다. */
export function nextDateKey(dateKey: string): string {
  return addDays(dateKey, 1);
}

/**
 * 열쇠가 기간 열쇠의 모양인가. 해 "2026"·"2026@03", 달 "2026-09"·"2026-08@14",
 * 주 "2026-09-13", 직접 정한 기간 "2026-08-14~2026-09-20" 중 하나다.
 */
export function isPeriodKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.includes('~')) {
    const [startKey, endKey, extra] = value.split('~');
    return extra === undefined && isDayKey(startKey) && isDayKey(endKey) && startKey <= endKey;
  }
  const [base, anchorText, extra] = value.split('@');
  if (extra !== undefined) return false;
  if (anchorText !== undefined) {
    if (!/^\d{2}$/.test(anchorText)) return false;
    const anchor = Number(anchorText);
    if (/^\d{4}$/.test(base)) return anchor >= 2 && anchor <= 12;
    return isMonthKey(base) && anchor >= 2 && anchor <= 31;
  }
  return /^\d{4}$/.test(base) || isMonthKey(base) || isDayKey(base);
}

function isMonthKey(value: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

function isDayKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  return month >= 1 && month <= 12 && day >= 1 && day <= lastDay(year, month);
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
