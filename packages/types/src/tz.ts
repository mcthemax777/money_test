/**
 * 프로젝트 기준 타임존으로 달력 경계를 계산한다.
 *
 * 거래 시각은 전부 UTC 인스턴트로 저장하지만, "8월 가계부"의 경계는 사람이 사는
 * 타임존의 벽시계 기준이어야 한다. Asia/Seoul이면 2026년 8월은
 * 2026-07-31T15:00:00Z 부터 2026-08-31T15:00:00Z 까지다.
 * UTC 기준으로 자르면 그 지역의 00:00~09:00 거래가 전월로 넘어간다.
 *
 * 별도 라이브러리 없이 Intl(ICU)로 계산한다. DST가 있는 타임존도 그 시점의
 * 실제 오프셋을 쓰므로 함께 처리된다. 서버와 웹이 같은 규칙을 써야 하므로
 * 여기 한 곳에만 둔다.
 */

/** 프로젝트에 타임존이 지정되지 않았을 때 쓰는 기본값 */
export const DEFAULT_TIME_ZONE = 'Asia/Seoul';

/**
 * 사용자가 거래에 넣을 수 있는 가장 앞선 날짜 ("YYYY-MM-DD").
 *
 * 화면의 날짜 입력 하한(min)으로 쓴다. 1970년(유닉스 에포크)을 쓰면 그 이전
 * 날짜를 거래로 넣을 수 있어 기초잔액보다 앞서는 거래가 생긴다.
 */
export const LEDGER_MIN_ENTRY_DATE_KEY = '1900-01-01';

/**
 * 기초잔액 전표를 두는 날짜 (UTC). 원장의 하드 하한이기도 하다.
 *
 * 거래 입력 하한보다 1년 앞이다. 화면이 고른 날짜는 프로젝트 타임존으로 해석해
 * UTC로 저장하므로 최대 하루가량 앞으로 밀린다(KST 1900-01-01 = 1899-12-31T15:00Z).
 * 여유를 두면 어떤 타임존에서도 기초잔액이 모든 거래보다 앞선다.
 */
export const LEDGER_OPENING_DATE_KEY = '1899-01-01';

/** `LEDGER_OPENING_DATE_KEY`의 인스턴트. 호출마다 새 Date를 만든다(공유 객체 변조 방지). */
export function ledgerOpeningDate(): Date {
  return new Date(`${LEDGER_OPENING_DATE_KEY}T00:00:00.000Z`);
}

/**
 * 거래 날짜의 상한. 오늘로부터 이만큼 뒤까지만 받는다.
 *
 * 상한이 없던 시절에는 연도 오타 하나가 조용히 통과했다. 2026을 2926으로 잘못
 * 치면 그 금액이 곧바로 순자산에 들어가고, 카드 청구 주기는 지금부터 그 달까지를
 * 전부 만들어 응답이 1.5MB(주기 10,806개)가 됐다. 9999년이면 9만 개가 넘는다.
 *
 * 예약 거래 기능이 없으므로 5년이면 실제 입력을 막지 않으면서 오타는 걸러 낸다.
 */
export const LEDGER_MAX_ENTRY_YEARS_AHEAD = 5;

/** 지금 기준 거래 날짜 상한. 그 해 말일까지 허용해 연말 경계에서 잘리지 않게 한다. */
export function ledgerMaxEntryDate(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear() + LEDGER_MAX_ENTRY_YEARS_AHEAD, 11, 31, 23, 59, 59, 999),
  );
}

/** 날짜 입력의 max 속성에 쓰는 "YYYY-MM-DD" */
export function ledgerMaxEntryDateKey(now: Date = new Date()): string {
  return `${now.getUTCFullYear() + LEDGER_MAX_ENTRY_YEARS_AHEAD}-12-31`;
}

/** 벽시계 기준 달력 값. month는 1~12 (JS의 0~11이 아니다). */
export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;

  // Intl.DateTimeFormat 생성은 비싸다. 타임존은 몇 개뿐이므로 캐시한다.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

/** 인스턴트를 그 타임존의 벽시계 값으로 바꾼다. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

/** 그 인스턴트에서 타임존의 UTC 오프셋 (밀리초). 동쪽이 양수. */
function offsetMs(instant: Date, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  // 벽시계에는 밀리초가 없으므로 비교 기준도 초 단위로 자른다.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * 벽시계 값을 UTC 인스턴트로 바꾼다.
 *
 * month는 1~12지만 범위를 벗어나도 된다 (13월 = 다음 해 1월). day도 같다.
 * 오프셋을 두 번 재는 이유: DST 전환일에는 추정 인스턴트의 오프셋과 실제
 * 결과 인스턴트의 오프셋이 다를 수 있다.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);
  const firstGuess = wallClock - offsetMs(new Date(wallClock), timeZone);
  const corrected = wallClock - offsetMs(new Date(firstGuess), timeZone);
  return new Date(corrected);
}

/** 그 타임존에서 해당 날짜가 시작하는 인스턴트 */
export function zonedDayStart(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  return zonedTimeToUtc(year, month, day, 0, 0, timeZone);
}

/** 그 타임존에서 해당 월이 시작하는 인스턴트 */
export function zonedMonthStart(year: number, month: number, timeZone: string): Date {
  return zonedDayStart(year, month, 1, timeZone);
}

/**
 * "YYYY-MM" 한 달의 인스턴트 구간. end는 포함하지 않는다 (다음 달 시작).
 * 서버의 모든 월 집계가 이 함수를 쓴다.
 */
export function zonedMonthRange(
  yearMonth: string,
  timeZone: string,
): { start: Date; end: Date } {
  const [year, month] = yearMonth.split('-').map(Number);
  return {
    start: zonedMonthStart(year, month, timeZone),
    end: zonedMonthStart(year, month + 1, timeZone),
  };
}

/** "YYYY-MM-DD" (날짜만) 문자열을 그 타임존의 하루 시작 인스턴트로 */
export function zonedDateStringToUtc(dateOnly: string, timeZone: string): Date {
  const [year, month, day] = dateOnly.split('-').map(Number);
  return zonedDayStart(year, month, day, timeZone);
}

/**
 * "YYYY-MM-DD"와 "HH:mm"을 UTC 인스턴트로. 시간을 생략하면 그 날의 시작.
 * 거래 입력 폼이 쓴다. 브라우저 로컬 타임존이 아니라 프로젝트 타임존으로 해석한다.
 */
export function zonedFormValueToUtc(
  dateOnly: string,
  time: string | undefined,
  timeZone: string,
): Date {
  const [year, month, day] = dateOnly.split('-').map(Number);
  if (!time) return zonedDayStart(year, month, day, timeZone);

  const [hour, minute] = time.split(':').map(Number);
  return zonedTimeToUtc(year, month, day, hour, minute, timeZone);
}

/** 인스턴트가 속한 "YYYY-MM" (그 타임존 기준) */
export function zonedYearMonth(instant: Date, timeZone: string): string {
  const { year, month } = zonedParts(instant, timeZone);
  return `${year}-${pad(month)}`;
}

/** 인스턴트가 속한 "YYYY-MM-DD" (그 타임존 기준) */
export function zonedDateKey(instant: Date, timeZone: string): string {
  const { year, month, day } = zonedParts(instant, timeZone);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** 인스턴트가 속한 "HH:mm" (그 타임존 기준) */
export function zonedTimeKey(instant: Date, timeZone: string): string {
  const { hour, minute } = zonedParts(instant, timeZone);
  return `${pad(hour)}:${pad(minute)}`;
}

/** 그 타임존의 오늘이 시작하는 인스턴트 */
export function zonedTodayStart(timeZone: string, now: Date = new Date()): Date {
  const { year, month, day } = zonedParts(now, timeZone);
  return zonedDayStart(year, month, day, timeZone);
}

/** 그 타임존 기준 이번 달 "YYYY-MM" */
export function zonedCurrentYearMonth(timeZone: string, now: Date = new Date()): string {
  return zonedYearMonth(now, timeZone);
}

/** 그 달의 마지막 날짜. month는 1~12. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * "매월 N일"을 그 달에 존재하는 날짜로 자른다.
 * 마감일 31일 + 2월이면 28일(윤년이면 29일)이 된다.
 */
export function clampDayOfMonth(year: number, month: number, dayOfMonth: number): number {
  return Math.min(dayOfMonth, daysInMonth(year, month));
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
