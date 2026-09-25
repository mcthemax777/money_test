/**
 * 한 주를 어느 요일에서 끊는가.
 *
 * 사람마다 다른 값이라 서버(User.weekStart)에 저장한다. 달력의 첫 칸과 거래 목록의
 * 주 묶음이 이 값을 함께 본다 -- 한 화면에서 주가 월요일에 시작하고 다른 화면에서
 * 일요일에 시작하면 같은 거래가 화면마다 다른 주에 들어간다.
 *
 * 언어와 같은 축이다(`locale`). 프로젝트의 통화·타임존은 원장이 무엇으로 어디의
 * 시계로 적히는지이고, 이 값은 그 원장을 누가 어떻게 읽는지다. 그래서 한 가계부를
 * 함께 쓰는 두 사람이 서로 다른 요일에서 주를 끊어도 된다.
 *
 * **숫자는 `Date.getDay()` 와 같다** -- 0 이 일요일, 6 이 토요일. 따로 이름을 두면
 * 달력이 요일을 셀 때마다 표를 한 번 거쳐야 한다.
 */

export const WEEK_START_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export type WeekStart = (typeof WEEK_START_DAYS)[number];

/** 고른 적이 없는 사용자와, 알 수 없는 값이 들어온 자리의 기본값. */
export const DEFAULT_WEEK_START: WeekStart = 0;

export function isWeekStart(value: unknown): value is WeekStart {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;
}

/**
 * 무엇이 오든 쓸 수 있는 시작 요일로.
 *
 * 질의 문자열은 숫자를 문자로 싣고("weekStart=1"), 옛 기기는 이 칸을 아예 보내지
 * 않는다. 조회 조건 하나가 어긋났다고 목록을 비우는 것보다 기본값(일요일)으로 세는
 * 편이 낫다 -- `unit` 을 읽는 규칙과 같다.
 *
 * 프로필 저장처럼 사용자가 고른 값을 받는 자리에서는 `isWeekStart` 로 막는다. 그쪽은
 * 조용히 다른 요일로 바꿔 두면 무엇이 잘못됐는지 알 수 없다.
 */
export function asWeekStart(value: unknown): WeekStart {
  if (isWeekStart(value)) return value;
  if (typeof value === 'string' && /^[0-6]$/.test(value)) return Number(value) as WeekStart;
  return DEFAULT_WEEK_START;
}

/**
 * 그 요일이 한 주에서 몇 번째 칸인가. 0 부터 6 이다.
 *
 * 달력이 첫 줄의 앞을 몇 칸 메울지, 마지막 줄의 뒤를 몇 칸 채울지가 모두 이 셈이다.
 * 시작 요일이 일요일이면 `getDay()` 를 그대로 돌려준다.
 */
export function weekdayOffset(day: number, weekStart: WeekStart): number {
  return (day - weekStart + 7) % 7;
}
