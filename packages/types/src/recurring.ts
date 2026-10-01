/**
 * 반복 등록의 일정 셈.
 *
 * "매일", "5일마다", "매월 25일", "매년 3월 1일" 을 **달력 날짜**로 풀어낸다. 서버와
 * 화면이 같은 답을 내야 하므로 여기 한 곳에 둔다 -- 기기는 후보를 만들 날을 정하는 데,
 * 서버는 "다음 예정일"을 셈해 실어 보내는 데 쓴다. 두 곳에 두면 화면이 적은 날과 실제로
 * 만들어지는 날이 어긋난다.
 *
 * **날짜만 다룬다. 시각도 타임존도 여기 없다.** 넘어오는 것과 돌려주는 것이 모두
 * 프로젝트 타임존의 달력 날짜("YYYY-MM-DD")이고, 그 문자열을 인스턴트로 바꾸는 일은
 * 부르는 쪽이 한다(`zonedFormValueToUtc`). 그래야 서울에서 만든 반복이 뉴욕에서
 * 하루 밀리지 않는다.
 */

import { isWeekend, weekdayOf } from './holidays';

/**
 * 얼마나 자주.
 *
 * `none` 은 **주기가 없는 반복**이다. 스스로 만들어지는 날이 없고, 사람이 보관함에서
 * "만들기"를 누를 때만 그 날짜로 후보가 생긴다. 달마다 같은 날 나가는 돈이 아니라
 * "적을 때마다 값이 같은 것"을 위한 자리다 -- 늘 같은 카페의 같은 커피, 늘 같은
 * 금액의 주차비처럼 언제 쓸지는 모르지만 적을 내용은 정해져 있는 것들이다.
 *
 * 셈하는 함수들(`dueOccurrences`·`nextOccurrence`)은 이 주기에 아무 날도 돌려주지
 * 않는다. 그 자리에 하루라도 돌려주면 보관함을 열 때마다 후보가 저절로 생긴다.
 *
 * `weekly` 는 매주 고른 요일들(`weekdays`)이다.
 */
export type RecurringFrequency = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

/**
 * 휴일에 걸린 회차를 어떻게 할지. 주기마다 고를 수 있는 것이 다르다(`HOLIDAY_RULES`).
 *
 *   - `none`   그날 그대로 만든다.
 *   - `skip`   만들지 않는다. 일별은 토·일·공휴일을, 주별은 공휴일만 건너뛴다 -- 주별은
 *              요일을 사람이 고르므로 토·일을 고른 것은 그 뜻이다.
 *   - `before` 휴일이면 휴일이 아닌 앞날로 당긴다 (월별·년별). 휴일은 토·일·공휴일이다.
 *   - `after`  휴일이면 휴일이 아닌 뒷날로 민다 (월별·년별).
 *
 * 당기거나 민 날이 **그 회차의 날짜**다. 후보의 열쇠(`r:<규칙>:<날짜>`)와 거래 시각,
 * 다음 예정일이 모두 그 날을 쓴다. 시작일·끝나는 날은 옮기기 전의 날로 본다.
 */
export type RecurringHolidayRule = 'none' | 'skip' | 'before' | 'after';

/** 주기마다 고를 수 있는 휴일 처리. 첫 것이 기본이다. */
export const HOLIDAY_RULES: Record<RecurringFrequency, RecurringHolidayRule[]> = {
  none: ['none'],
  daily: ['none', 'skip'],
  weekly: ['none', 'skip'],
  monthly: ['none', 'before', 'after'],
  yearly: ['none', 'before', 'after'],
};

/**
 * 반복의 일정 부분. 무엇을 적을지(금액·분류)는 여기 없다.
 *
 * 날짜는 전부 "YYYY-MM-DD" 다.
 */
export interface RecurringSchedule {
  frequency: RecurringFrequency;
  /** daily: 며칠마다. 1 이면 매일이다. */
  everyDays?: number | null;
  /** weekly: 요일들. 0 이 일요일, 6 이 토요일이다. */
  weekdays?: number[] | null;
  /** 휴일에 걸린 회차를 어떻게 할지. 없으면 `none` 이다. */
  holidayRule?: RecurringHolidayRule | null;
  /**
   * 공휴일 ("YYYY-MM-DD"). 부르는 쪽(서버)이 가계부 시간대의 나라 것을 DB 에서 읽어 채운다
   * (`holidayCountryOf`). 없으면 토·일만 휴일로 셈한다.
   */
  publicHolidays?: ReadonlySet<string> | null;
  /** monthly·yearly: 며칠. 그 달에 없는 날(2월 31일)은 그 달의 마지막 날로 당긴다. */
  dayOfMonth?: number | null;
  /** yearly: 몇 월 (1~12) */
  month?: number | null;
  /** 이 날부터. 이 날 자신도 회차가 될 수 있다. */
  startDate: string;
  /** 이 날까지. 없으면 끝이 없다. */
  endDate?: string | null;
  /**
   * 마지막으로 만들어 낸 회차의 날짜.
   *
   * 이 날까지는 이미 후보가 있다는 뜻이다. 다음에 만들 것은 이 날보다 뒤인 회차뿐이라,
   * 셈이 헛돌지 않는다. 부르는 쪽이 채운다 -- 서버가 그 반복의 후보를 세어 실어 보낸
   * 값(`RecurringRuleDto.Response.lastMadeOn`)이 그대로 여기 들어온다.
   *
   * 비워도 된다. 그러면 따라잡기 구간(최근 31일)을 통째로 돌려주고, 이미 있는 회차는
   * 서버가 중복 열쇠로 건너뛴다 -- 결과는 같고 요청만 커진다.
   */
  lastMadeOn?: string | null;
}

/**
 * 지난 회차를 얼마나 따라잡을지.
 *
 * 반복을 오래 전 날짜로 시작해 두면 그 사이의 모든 날이 밀린 회차가 된다. 매일 반복을
 * 2년 전부터로 두면 700건이 한꺼번에 보관함에 쌓이는데, 그것은 사용자가 원한 것이
 * 아니다. 최근 것만 따라잡고 그보다 오래된 회차는 건너뛴다.
 */
export const RECURRING_CATCH_UP_DAYS = 31;

/** 한 번에 만들 최대 회차 수. 따라잡기 상한과 함께 보관함이 넘치는 것을 막는다. */
export const RECURRING_MAX_PER_RUN = 31;

/**
 * 창 안에서 셀 수 있는 최대 걸음.
 *
 * 상한(`limit`)보다 넉넉해야 한다 -- 마지막 것부터 남기려면 창 안의 회차를 일단 다 세야
 * 하기 때문이다. 그러면서도 무한히 돌지는 않게 못을 박는다.
 */
const MAX_WINDOW_STEPS = 400;

/**
 * 당기거나 미는 회차를 찾으려고 창 앞뒤로 더 보는 날 수.
 *
 * 10월 1일이 일요일이고 "앞 평일"이면 그 회차는 9월 29일이다. 9월 29일에 셈할 때 창
 * (오늘까지) 밖의 10월 1일도 봐야 그 회차를 찾는다. 가장 긴 연휴(설·추석과 주말,
 * 대체공휴일이 붙은 것)보다 넉넉히 둔다.
 */
const SHIFT_PAD_DAYS = 14;

/** 휴일을 피해 옮길 때 넘지 않는 날 수. 공휴일 표가 잘못되어도 무한히 돌지 않게 한다. */
const MAX_SHIFT_DAYS = 30;

/**
 * 오늘까지 밀린 회차의 날짜들. 이른 날이 앞이다.
 *
 * 서버가 밀린 회차를 만들 때 부른다(`recurring-drafts`). 이미 만든 날을
 * `lastMadeOn` 에 주면 그 뒤부터 이어진다.
 */
export function dueOccurrences(
  schedule: RecurringSchedule,
  todayKey: string,
  options: { catchUpDays?: number; limit?: number } = {},
): string[] {
  // 주기가 없으면 저절로 오는 날이 없다. 사람이 누를 때만 그 날짜로 만든다.
  if (schedule.frequency === 'none') return [];

  const catchUpDays = options.catchUpDays ?? RECURRING_CATCH_UP_DAYS;
  const limit = options.limit ?? RECURRING_MAX_PER_RUN;

  const today = parseKey(todayKey);
  if (!today) return [];

  /*
   * 어디부터 셀지.
   *
   * "이미 만든 날 다음날"과 따라잡기 한계 중 늦은 날이다. 마지막 것이 없으면 오래된
   * 반복을 켜는 순간 지난 회차가 쏟아진다. 시작일은 옮기기 전의 날에 거는 값이라
   * 회차를 셀 때 본다(`occurrencesBetween`).
   */
  const floor = latest([
    schedule.lastMadeOn ? addDays(schedule.lastMadeOn, 1) : null,
    addDays(todayKey, -catchUpDays),
  ]);
  if (!floor || todayKey < floor) return [];

  /*
   * 창 안의 회차를 모두 세고 **마지막 것부터** 상한만큼 남긴다.
   *
   * 앞에서 자르면 오늘 것이 잘려 나간다 -- 32일치가 밀렸는데 31개만 만들면 오늘 것이
   * 빠지고, 사용자는 "오늘 것이 왜 없지"를 먼저 본다. 오래된 회차를 버리는 편이 낫다.
   */
  const pad = movesOnHoliday(schedule) ? SHIFT_PAD_DAYS : 0;
  const dates = occurrencesBetween(schedule, addDays(floor, -pad), addDays(todayKey, pad)).filter(
    (date) => date >= floor && date <= todayKey,
  );

  return dates.length > limit ? dates.slice(dates.length - limit) : dates;
}

/**
 * 다음에 만들어질 회차. 없으면 null 이다.
 *
 * 화면이 "다음 예정일"로 적는다. 이미 만든 것 다음이고 끝나는 날을 넘지 않는다.
 * 오늘이 회차이고 아직 만들지 않았으면 오늘을 돌려준다 -- 화면이 "오늘 만들어집니다"
 * 라고 적을 수 있다.
 */
export function nextOccurrence(schedule: RecurringSchedule, todayKey: string): string | null {
  // 주기가 없으면 다음 예정일도 없다. 화면은 그 자리에 "주기 없음"을 적는다.
  if (schedule.frequency === 'none') return null;

  const floor = latest([schedule.lastMadeOn ? addDays(schedule.lastMadeOn, 1) : null, todayKey]);
  if (!floor) return null;

  // 옮기기 전의 날이 조금 앞이어도 옮긴 날이 floor 뒤일 수 있다(휴일이면 뒷날).
  const pad = movesOnHoliday(schedule) ? SHIFT_PAD_DAYS : 0;
  let steps = 0;
  for (const nominal of nominalDates(schedule, addDays(floor, -pad))) {
    if (steps++ > MAX_WINDOW_STEPS) return null;
    const date = actualDate(schedule, nominal);
    if (date && date >= floor) return date;
  }
  return null;
}

/** 일정이 어긋난 자리. 화면이 그 칸에 표시를 켠다. */
export interface RecurringViolation {
  code:
    | 'FREQUENCY_INVALID'
    | 'EVERY_DAYS_INVALID'
    | 'WEEKDAYS_INVALID'
    | 'HOLIDAY_RULE_INVALID'
    | 'DAY_OF_MONTH_INVALID'
    | 'MONTH_INVALID'
    | 'START_DATE_INVALID'
    | 'END_DATE_INVALID'
    | 'END_BEFORE_START';
}

/**
 * 저장할 수 있는 일정인가.
 *
 * 서버와 화면이 같은 함수로 본다. 화면만 검사하면 서버가 500 으로 답하는 자리가 생기고,
 * 서버만 검사하면 사용자가 무엇이 틀렸는지 폼에서 알 수 없다.
 */
export function checkRecurring(schedule: RecurringSchedule): RecurringViolation | null {
  if (!(schedule.frequency in HOLIDAY_RULES)) {
    return { code: 'FREQUENCY_INVALID' };
  }
  if (!parseKey(schedule.startDate)) return { code: 'START_DATE_INVALID' };
  if (schedule.endDate && !parseKey(schedule.endDate)) return { code: 'END_DATE_INVALID' };
  if (schedule.endDate && schedule.endDate < schedule.startDate) {
    return { code: 'END_BEFORE_START' };
  }

  /*
   * 주기가 없으면 볼 것이 없다.
   *
   * 며칠마다·며칟날·몇 월은 저절로 오는 날을 정하는 값이고, 그 날이 없는 반복에는
   * 뜻이 없다. 시작일과 끝나는 날만 모양을 본다 -- 표에 반드시 있어야 하는 칸이라
   * 폼이 오늘 날짜로 채워 보낸다.
   */
  if (!HOLIDAY_RULES[schedule.frequency].includes(schedule.holidayRule ?? 'none')) {
    return { code: 'HOLIDAY_RULE_INVALID' };
  }

  if (schedule.frequency === 'none') return null;

  if (schedule.frequency === 'weekly') {
    const days = schedule.weekdays ?? [];
    const valid =
      days.length > 0 &&
      days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) &&
      new Set(days).size === days.length;
    return valid ? null : { code: 'WEEKDAYS_INVALID' };
  }

  if (schedule.frequency === 'daily') {
    const days = Number(schedule.everyDays ?? 1);
    if (!Number.isInteger(days) || days < 1 || days > 365) return { code: 'EVERY_DAYS_INVALID' };
    return null;
  }

  const day = Number(schedule.dayOfMonth);
  if (!Number.isInteger(day) || day < 1 || day > 31) return { code: 'DAY_OF_MONTH_INVALID' };

  if (schedule.frequency === 'yearly') {
    const month = Number(schedule.month);
    if (!Number.isInteger(month) || month < 1 || month > 12) return { code: 'MONTH_INVALID' };
  }
  return null;
}

/** 휴일이면 날짜를 옮기는 일정인가. 그런 일정만 창 앞뒤를 더 본다. */
function movesOnHoliday(schedule: RecurringSchedule): boolean {
  return (
    (schedule.frequency === 'monthly' || schedule.frequency === 'yearly') &&
    (schedule.holidayRule === 'before' || schedule.holidayRule === 'after')
  );
}

/**
 * `from` 부터의 옮기기 전 회차들. 시작일 전과 끝나는 날 뒤는 내지 않는다.
 *
 * 부르는 쪽이 필요한 만큼만 꺼낸다. 끝이 없는 반복이면 끝없이 나온다.
 */
function* nominalDates(schedule: RecurringSchedule, from: string): Generator<string> {
  let cursor = firstOnOrAfter(schedule, latest([schedule.startDate, from]) ?? from);
  while (cursor && (!schedule.endDate || cursor <= schedule.endDate)) {
    yield cursor;
    cursor = stepAfter(schedule, cursor);
  }
}

/**
 * 옮기기 전 회차의 실제 날짜. 건너뛰는 회차는 null 이다 (`RecurringHolidayRule`).
 */
function actualDate(schedule: RecurringSchedule, nominal: string): string | null {
  const rule = schedule.holidayRule ?? 'none';
  if (rule === 'none') return nominal;

  const holidays = schedule.publicHolidays;
  const isPublic = (date: string) => holidays?.has(date) ?? false;
  const isOff = (date: string) => isWeekend(date) || isPublic(date);
  if (rule === 'skip') {
    if (schedule.frequency === 'daily') return isOff(nominal) ? null : nominal;
    if (schedule.frequency === 'weekly') return isPublic(nominal) ? null : nominal;
    return nominal;
  }

  if (!movesOnHoliday(schedule)) return nominal;
  const step = rule === 'before' ? -1 : 1;
  let date = nominal;
  for (let moved = 0; isOff(date); moved += 1) {
    // 표가 잘못되어 한 달 내내 휴일로 나와도 멈춘다. 그때는 원래 날로 만든다.
    if (moved >= MAX_SHIFT_DAYS) return nominal;
    date = addDays(date, step);
  }
  return date;
}

/**
 * `from`~`to` 사이 회차의 실제 날짜들. 이른 날이 앞이고 겹치지 않는다.
 *
 * 옮긴 날로 거르지 않는다 -- 창 앞뒤로 더 본 것을 부르는 쪽이 자기 창으로 자른다.
 */
function occurrencesBetween(schedule: RecurringSchedule, from: string, to: string): string[] {
  const found = new Set<string>();
  let steps = 0;
  for (const nominal of nominalDates(schedule, from)) {
    if (nominal > to || steps++ >= MAX_WINDOW_STEPS) break;
    const date = actualDate(schedule, nominal);
    if (date) found.add(date);
  }
  return [...found].sort();
}

/** `floor` 이후(그 날 포함)의 첫 회차. 옮기기 전의 날이다. */
function firstOnOrAfter(schedule: RecurringSchedule, floor: string): string | null {
  if (schedule.frequency === 'weekly') {
    const days = new Set(schedule.weekdays ?? []);
    if (days.size === 0) return null;
    for (let offset = 0; offset < 7; offset += 1) {
      const date = addDays(floor, offset);
      if (days.has(weekdayOf(date))) return date;
    }
    return null;
  }

  if (schedule.frequency === 'daily') {
    const step = Math.max(1, Number(schedule.everyDays ?? 1));
    const start = parseKey(schedule.startDate);
    const from = parseKey(floor);
    if (!start || !from) return null;

    /*
     * 시작일에서 몇 걸음 떨어진 자리인가.
     *
     * 하루씩 세지 않는다 -- 2년 전에 시작한 매일 반복이면 700번을 돌게 된다.
     * 걸음 수를 나눗셈으로 구해 한 번에 뛴다.
     */
    const gap = daysBetween(schedule.startDate, floor);
    if (gap <= 0) return schedule.startDate;
    const steps = Math.ceil(gap / step);
    return addDays(schedule.startDate, steps * step);
  }

  if (schedule.frequency === 'monthly') {
    const day = Number(schedule.dayOfMonth ?? 1);
    const from = parseKey(floor);
    if (!from) return null;

    // 이 달의 회차가 아직 오지 않았으면 그것이고, 지났으면 다음 달이다.
    const thisMonth = onDayOfMonth(from.year, from.month, day);
    if (thisMonth >= floor) return thisMonth;
    const next = from.month === 12 ? { year: from.year + 1, month: 1 } : { year: from.year, month: from.month + 1 };
    return onDayOfMonth(next.year, next.month, day);
  }

  const month = Number(schedule.month ?? 1);
  const day = Number(schedule.dayOfMonth ?? 1);
  const from = parseKey(floor);
  if (!from) return null;

  const thisYear = onDayOfMonth(from.year, month, day);
  return thisYear >= floor ? thisYear : onDayOfMonth(from.year + 1, month, day);
}

/** 그 회차 바로 다음 회차. */
function stepAfter(schedule: RecurringSchedule, current: string): string | null {
  if (schedule.frequency === 'daily') {
    return addDays(current, Math.max(1, Number(schedule.everyDays ?? 1)));
  }
  return firstOnOrAfter(schedule, addDays(current, 1));
}

/**
 * 그 달의 며칟날. 그 달에 없는 날은 마지막 날로 당긴다.
 *
 * 매월 31일로 둔 반복이 2월에는 28일(윤년이면 29일)에 만들어진다. 건너뛰지 않는다 --
 * 월세나 구독료는 그 달에도 나가고, 사용자가 적으려던 것은 "그 달의 그 무렵"이다.
 */
function onDayOfMonth(year: number, month: number, day: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return formatKey(year, month, Math.min(Math.max(1, day), last));
}

interface DateParts {
  year: number;
  month: number;
  day: number;
}

/** "YYYY-MM-DD" 를 숫자 셋으로. 모양이 어긋나면 null 이다. */
function parseKey(key: string | null | undefined): DateParts | null {
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;

  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function formatKey(year: number, month: number, day: number): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * 날짜에 며칠을 더한다. 음수면 뺀다.
 *
 * UTC 로 셈한다. 달력 날짜만 다루므로 서머타임이 끼어들 자리가 없다.
 */
export function addDays(key: string, days: number): string {
  const parts = parseKey(key);
  if (!parts) return key;

  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + days);
  return formatKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** 두 날짜 사이의 일수 (뒤 - 앞). */
function daysBetween(from: string, to: string): number {
  const one = parseKey(from);
  const other = parseKey(to);
  if (!one || !other) return 0;

  const start = Date.UTC(one.year, one.month - 1, one.day);
  const end = Date.UTC(other.year, other.month - 1, other.day);
  return Math.round((end - start) / 86_400_000);
}

/** 날짜 문자열은 사전순 비교가 곧 날짜 비교다 (같은 자릿수 고정 형식). */
function latest(keys: Array<string | null | undefined>): string | null {
  const valid = keys.filter((key): key is string => Boolean(parseKey(key)));
  return valid.length > 0 ? valid.reduce((one, other) => (other > one ? other : one)) : null;
}

function earliest(keys: Array<string | null | undefined>): string | null {
  const valid = keys.filter((key): key is string => Boolean(parseKey(key)));
  return valid.length > 0 ? valid.reduce((one, other) => (other < one ? other : one)) : null;
}

/** 반복이 담을 수 있는 갈래. 잔액 조정은 사람이 적는 것이 아니라 여기 없다. */
export const RECURRING_KINDS = ['expense', 'income', 'transfer', 'card_payment'] as const;

/** 일정과 시각. 저장 모양을 만들 때 쓴다 (시각은 셈에 쓰이지 않는다). */
export type RecurringScheduleWithTime = RecurringSchedule & { timeOfDay?: string | null };

/**
 * 일정 칸만 골라 저장 모양으로. 갈래에 뜻이 없는 칸은 비운다. 서버와 기기 사본이 함께 쓴다.
 *
 * **시각까지 함께 내놓는다.** 부르는 쪽은 그것을 빠뜨린 채로 주면 안 된다 -- 여기서
 * `?? null` 로 읽히므로 적어 둔 시각이 조용히 지워진다.
 */
export function recurringScheduleFields(schedule: RecurringScheduleWithTime) {
  const frequency = schedule.frequency;
  return {
    frequency,
    everyDays: frequency === 'daily' ? Math.max(1, Number(schedule.everyDays ?? 1)) : null,
    // 주별이 아니면 요일은 뜻이 없다. 남겨 두면 주기를 바꾼 뒤에도 표에 남는다.
    weekdays:
      frequency === 'weekly' ? [...new Set(schedule.weekdays ?? [])].sort((a, b) => a - b) : [],
    holidayRule: schedule.holidayRule ?? 'none',
    // 주기가 없으면 셋 다 비운다. 저절로 오는 날이 없어 정할 것이 없다.
    dayOfMonth:
      frequency === 'monthly' || frequency === 'yearly' ? Number(schedule.dayOfMonth) : null,
    month: frequency === 'yearly' ? Number(schedule.month) : null,
    startDate: schedule.startDate,
    endDate: schedule.endDate ?? null,
    /*
     * 시각은 정해진 날의 몇 시로 담을지다. 주기가 없으면 그 날이 없다 -- 사람이
     * 누르는 그 순간의 시각으로 담기므로(core 의 `manualDraftItem`) 적어 둔 값을
     * 아무도 보지 않는다. 남겨 두면 표에 쓰이지 않는 값이 남는다.
     */
    timeOfDay: frequency === 'none' ? null : (schedule.timeOfDay ?? null),
  };
}

/**
 * 반복 등록의 필드가 쓰는 시계 (`mergeFields` 의 `clockOf`).
 *
 * 함께 검사하는 칸은 시계 하나를 나눠 쓴다.
 *
 *   - **일정**(주기·요일·날짜·시각·시작과 끝). 셈하는 함수가 한 덩어리로 본다. 한 기기가
 *     월별 25일로, 다른 기기가 주별 월요일로 고쳤는데 칸마다 이기고 지면 "주별, 요일 없음"
 *     같은 어느 쪽도 적지 않은 일정이 되고 재생이 거절된다.
 *   - **갈래와 결제수단**(갈래·통장·받는 통장·카드·분류·할부·수수료). 갈래에 따라 어느
 *     칸이 뜻이 있는지가 바뀐다 (이체면 카드·분류가 없다).
 *
 * 나머지(켜기·금액·통화·이름·가맹점·사람·태그)는 칸마다 따로다.
 */
const RECURRING_CLOCK_GROUPS: Readonly<Record<string, string>> = {
  frequency: 'schedule',
  everyDays: 'schedule',
  weekdays: 'schedule',
  holidayRule: 'schedule',
  dayOfMonth: 'schedule',
  month: 'schedule',
  startDate: 'schedule',
  endDate: 'schedule',
  timeOfDay: 'schedule',
  kind: 'payment',
  accountId: 'payment',
  toAccountId: 'payment',
  cardId: 'payment',
  categoryId: 'payment',
  installmentMonths: 'payment',
  feeAmount: 'payment',
  feeCategoryId: 'payment',
};

export function recurringClockOf(field: string): string {
  return RECURRING_CLOCK_GROUPS[field] ?? field;
}

/** 이 필드들을 쓰면 시계를 찍어야 할 자리. 줄을 가리키는 값(id·projectId)은 뺀다. */
export function recurringClockKeys(fields: Iterable<string>): string[] {
  const keys = new Set<string>();
  for (const field of fields) {
    if (field === 'id' || field === 'projectId') continue;
    keys.add(recurringClockOf(field));
  }
  return [...keys];
}

/**
 * 수정 요청에서 일정 칸만. 준 것만 담아 지금 규칙에 합칠 수 있게 한다.
 *
 * 시각도 여기 담는다. 셈하는 함수는 그 값을 보지 않지만 저장 모양을 만드는
 * `recurringScheduleFields` 는 본다.
 */
export function recurringSchedulePatch(dto: {
  timeOfDay?: string | null;
  frequency?: RecurringFrequency;
  everyDays?: number | null;
  weekdays?: number[] | null;
  holidayRule?: RecurringHolidayRule | null;
  dayOfMonth?: number | null;
  month?: number | null;
  startDate?: string;
  endDate?: string | null;
}): Partial<RecurringScheduleWithTime> {
  const patch: Partial<RecurringScheduleWithTime> = {};
  if ('timeOfDay' in dto) patch.timeOfDay = dto.timeOfDay ?? null;
  if ('frequency' in dto && dto.frequency) patch.frequency = dto.frequency;
  if ('everyDays' in dto) patch.everyDays = dto.everyDays ?? null;
  if ('weekdays' in dto) patch.weekdays = dto.weekdays ?? [];
  if ('holidayRule' in dto) patch.holidayRule = dto.holidayRule ?? 'none';
  if ('dayOfMonth' in dto) patch.dayOfMonth = dto.dayOfMonth ?? null;
  if ('month' in dto) patch.month = dto.month ?? null;
  if ('startDate' in dto && dto.startDate) patch.startDate = dto.startDate;
  if ('endDate' in dto) patch.endDate = dto.endDate ?? null;
  return patch;
}
