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

/** 얼마나 자주. */
export type RecurringFrequency = 'daily' | 'monthly' | 'yearly';

/**
 * 반복의 일정 부분. 무엇을 적을지(금액·분류)는 여기 없다.
 *
 * 날짜는 전부 "YYYY-MM-DD" 다.
 */
export interface RecurringSchedule {
  frequency: RecurringFrequency;
  /** daily: 며칠마다. 1 이면 매일이다. */
  everyDays?: number | null;
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
 * 오늘까지 밀린 회차의 날짜들. 이른 날이 앞이다.
 *
 * 기기가 후보를 만들 때 부른다(core 의 `recurring-drafts`). 이미 만든 날을
 * `lastMadeOn` 에 주면 그 뒤부터 이어진다.
 */
export function dueOccurrences(
  schedule: RecurringSchedule,
  todayKey: string,
  options: { catchUpDays?: number; limit?: number } = {},
): string[] {
  const catchUpDays = options.catchUpDays ?? RECURRING_CATCH_UP_DAYS;
  const limit = options.limit ?? RECURRING_MAX_PER_RUN;

  const today = parseKey(todayKey);
  if (!today) return [];

  /*
   * 어디부터 셀지.
   *
   * 시작일과 "이미 만든 날 다음날", 그리고 따라잡기 한계 중 가장 늦은 날이다.
   * 마지막 것이 없으면 오래된 반복을 켜는 순간 지난 회차가 쏟아진다.
   */
  const floor = latest([
    schedule.startDate,
    schedule.lastMadeOn ? addDays(schedule.lastMadeOn, 1) : null,
    addDays(todayKey, -catchUpDays),
  ]);
  if (!floor) return [];

  const ceiling = schedule.endDate ? earliest([todayKey, schedule.endDate]) : todayKey;
  if (!ceiling || ceiling < floor) return [];

  const dates: string[] = [];
  let cursor: string | null = firstOnOrAfter(schedule, floor);

  /*
   * 창 안의 회차를 모두 세고 **마지막 것부터** 상한만큼 남긴다.
   *
   * 앞에서 자르면 오늘 것이 잘려 나간다 -- 32일치가 밀렸는데 31개만 만들면 오늘 것이
   * 빠지고, 사용자는 "오늘 것이 왜 없지"를 먼저 본다. 오래된 회차를 버리는 편이 낫다.
   */
  while (cursor && cursor <= ceiling && dates.length < MAX_WINDOW_STEPS) {
    dates.push(cursor);
    cursor = stepAfter(schedule, cursor);
  }

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
  const floor = latest([
    schedule.startDate,
    schedule.lastMadeOn ? addDays(schedule.lastMadeOn, 1) : null,
    todayKey,
  ]);
  if (!floor) return null;

  const next = firstOnOrAfter(schedule, floor);
  if (!next) return null;
  if (schedule.endDate && next > schedule.endDate) return null;
  return next;
}

/** 일정이 어긋난 자리. 화면이 그 칸에 표시를 켠다. */
export interface RecurringViolation {
  code:
    | 'FREQUENCY_INVALID'
    | 'EVERY_DAYS_INVALID'
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
  if (!['daily', 'monthly', 'yearly'].includes(schedule.frequency)) {
    return { code: 'FREQUENCY_INVALID' };
  }
  if (!parseKey(schedule.startDate)) return { code: 'START_DATE_INVALID' };
  if (schedule.endDate && !parseKey(schedule.endDate)) return { code: 'END_DATE_INVALID' };
  if (schedule.endDate && schedule.endDate < schedule.startDate) {
    return { code: 'END_BEFORE_START' };
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

/** `floor` 이후(그 날 포함)의 첫 회차. */
function firstOnOrAfter(schedule: RecurringSchedule, floor: string): string | null {
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
