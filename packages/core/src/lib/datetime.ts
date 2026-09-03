/**
 * 날짜/시각 표시와 입력 변환.
 *
 * 서버는 거래 시각을 UTC 인스턴트로 저장하고, 월 합계 경계는 프로젝트 타임존의
 * 벽시계로 계산한다(`@money/types`의 tz 헬퍼). 화면도 같은 기준을 써야 한다.
 * 브라우저 로컬 타임존으로 읽으면 프로젝트 타임존과 다른 사용자에게 날짜가 하루씩
 * 밀린다.
 *
 * 두 종류를 구분해야 한다.
 *   - 인스턴트: JournalEntry.date 처럼 시각까지 있는 값. 프로젝트 타임존으로 읽는다.
 *   - 달력 날짜 표시자: CardStatement.periodEnd 처럼 `@db.Date`로 저장된 값.
 *     날짜만 의미가 있고 UTC 자정으로 내려오므로 UTC 필드를 그대로 읽는다.
 */
import { activeLocaleTag } from '../lib/i18n';
import {
  zonedDateKey,
  zonedDateStringToUtc,
  zonedDayStart,
  zonedMonthRange,
  zonedTimeKey,
} from '@money/types';

/**
 * 실재하는 달력 날짜 'YYYY-MM-DD' 인가.
 *
 * 모양만 보아서는 모자란다. `'2026-02-31'` 은 정규식을 통과하지만 `new Date` 에 넣으면
 * 3월 3일로 넘어간다. 그런 값이 조회 구간이나 거래 날짜로 들어가면, 오류는 나지 않고
 * 결과만 조용히 어긋난다.
 *
 * 거래 입력과 거래 화면의 기간 검색이 함께 쓴다. 둘 다 앱에서는 글자로 받는다
 * (리액트 네이티브에 달력 입력이 없다).
 */
export function isDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1) return false;

  // 그 달의 말일. UTC 로 세어도 되는 것은 "며칠까지 있는가"만 보기 때문이다.
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 그 달의 말일. 'YYYY-MM' 을 받아 28~31 을 돌려준다. */
export function lastDayOfMonth(yearMonth: string): number {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 인스턴트가 속한 "YYYY-MM-DD" (프로젝트 타임존 기준) */
export function dateKeyOf(instant: string | Date, timeZone: string): string {
  return zonedDateKey(new Date(instant), timeZone);
}

/**
 * 거래 시각의 "HH:mm". 그 타임존의 자정이면 빈 문자열.
 *
 * 시간을 입력하지 않은 거래는 그 지역의 하루 시작으로 저장되므로, 자정을
 * "시간 없음"으로 되돌린다. 수정 폼의 시간 칸이 이 값을 쓴다.
 */
export function timeInputOf(instant: string | Date, timeZone: string): string {
  const time = zonedTimeKey(new Date(instant), timeZone);
  return time === '00:00' ? '' : time;
}

/** 목록/상세에 쓰는 날짜 표기 */
export function formatDate(instant: string | Date, timeZone: string): string {
  return new Date(instant).toLocaleDateString(activeLocaleTag(), { timeZone });
}

/**
 * 목록 카드에 쓰는 시각 표기 "오후 3:20". 시간을 입력하지 않은 거래는 빈 문자열.
 *
 * 카드는 날짜별로 묶인 목록 안에 있어 날짜는 머리글에 이미 있다. 카드에는 그날
 * 안에서의 순서를 알려 주는 시각만 남긴다. 자정으로 저장된 "시간 없음" 거래를
 * "오전 12:00"으로 보여 주면 입력하지 않은 값을 입력한 것처럼 읽히므로 비운다.
 */
export function formatTime(instant: string | Date, timeZone: string): string {
  if (timeInputOf(instant, timeZone) === '') return '';

  return new Date(instant).toLocaleTimeString(activeLocaleTag(), {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** 상세에 쓰는 날짜(+시각) 표기. 시간을 입력하지 않은 거래는 날짜만 보여준다. */
export function formatDateTime(instant: string | Date, timeZone: string): string {
  const hasTime = timeInputOf(instant, timeZone) !== '';
  return new Date(instant).toLocaleString(activeLocaleTag(), {
    timeZone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    ...(hasTime ? { hour: '2-digit' as const, minute: '2-digit' as const } : {}),
  });
}

/** `@db.Date` 값(달력 날짜 표시자)의 "YYYY-MM-DD" */
export function dateMarkerKey(marker: string | Date): string {
  const date = new Date(marker);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

/**
 * 카드 만료일처럼 월까지만 의미가 있는 값을 `<input type="month">`의 "YYYY-MM"으로.
 *
 * 저장된 값은 UTC 자정 인스턴트다. 로컬 타임존으로 읽으면 달이 하나 밀 수 있어
 * UTC 필드를 그대로 쓴다.
 */
export function monthInputOf(value: string | Date | null | undefined): string {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * "YYYY-MM"을 저장용 ISO 문자열로. 형식이 어긋나면 null.
 *
 * 그 달의 말일로 잡는다. 카드는 만료 월의 마지막 날까지 쓸 수 있다.
 */
export function monthInputToIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;

  // month는 1-based다. 다음 달의 0일 = 이 달의 말일.
  return new Date(Date.UTC(year, month, 0)).toISOString();
}

/** `@db.Date` 값의 표시용 날짜. 청구 기간·결제일이 여기에 해당한다. */
export function formatDateMarker(marker: string | Date): string {
  return new Date(marker).toLocaleDateString(activeLocaleTag(), { timeZone: 'UTC' });
}

/**
 * 달 이름 표기. 언어마다 적는 법이 달라 사전이 아니라 Intl이 만든다.
 *
 *   ko "2026년 8월" · en "August 2026" · ja "2026年8月"
 *
 * 사전에 "{year}년 {month}월" 같은 틀을 두면 영어의 "August"를 숫자로 적게 된다.
 * 달 이름과 차례는 표준이 이미 아는 값이다.
 *
 * UTC 자정으로 만들어 UTC로 읽는다. 여기서 다루는 것은 특정 시각이 아니라 달력의
 * 달이라, 브라우저 타임존으로 읽으면 달이 하나 밀릴 수 있다.
 */
function monthDate(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1));
}

/** "2026년 8월" / "August 2026" / "2026年8月" */
export function formatYearMonth(year: number, month: number): string {
  return new Intl.DateTimeFormat(activeLocaleTag(), {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(monthDate(year, month));
}

/** 달 하나. 달 고르는 표와 그래프 범례처럼 좁은 자리에 쓴다. "8월" / "Aug" / "8月" */
export function formatMonthShort(month: number): string {
  return new Intl.DateTimeFormat(activeLocaleTag(), {
    month: 'short',
    timeZone: 'UTC',
  }).format(monthDate(2000, month));
}

/** "2026년" / "2026" / "2026年" */
export function formatYearOnly(year: number): string {
  return new Intl.DateTimeFormat(activeLocaleTag(), {
    year: 'numeric',
    timeZone: 'UTC',
  }).format(monthDate(year, 1));
}

/**
 * 일요일부터 시작하는 요일 이름 일곱.
 *
 * 달력 머리글이 쓴다. 사전에 적어 두면 언어마다 일곱 줄이 늘어나는데, 요일 이름은
 * 표준이 이미 아는 값이다. 2024-01-07이 일요일이라 그날부터 이레를 센다.
 */
export function weekdayNames(): string[] {
  const format = new Intl.DateTimeFormat(activeLocaleTag(), {
    weekday: 'short',
    timeZone: 'UTC',
  });

  return Array.from({ length: 7 }, (_, index) =>
    format.format(new Date(Date.UTC(2024, 0, 7 + index))),
  );
}

/** 오늘 날짜의 "YYYY-MM-DD" (프로젝트 타임존 기준). 날짜 입력의 기본값. */
export function todayKey(timeZone: string): string {
  return zonedDateKey(new Date(), timeZone);
}

/** 프로젝트 타임존 기준 오늘의 연/월. 화면의 기본 표시 월이 된다. */
export function currentYearMonth(timeZone: string): { year: number; month: number } {
  const key = todayKey(timeZone);
  return { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) };
}

/** 현재 시각의 "HH:mm" (프로젝트 타임존 기준). 시간 입력의 기본값. */
export function nowTimeKey(timeZone: string): string {
  return zonedTimeKey(new Date(), timeZone);
}

/**
 * 거래 조회용 한 달 구간.
 *
 * 서버의 endDate는 포함(lte) 조건이라 다음 달 시작을 그대로 주면 1일치가 겹친다.
 * 1밀리초를 빼서 그 달의 마지막 순간으로 만든다.
 */
/**
 * 임의 기간의 목록 조회 구간.
 *
 * 달력 날짜 두 개("YYYY-MM-DD", 양끝 포함)를 받아 목록 API가 쓰는 인스턴트로 바꾼다.
 * 끝날은 그날 23:59:59.999 다. 그날 0시로 자르면 종료일 하루가 통째로 빠진다.
 * 월 단위는 monthQueryRange 가 같은 일을 한다.
 */
export function dayRangeQuery(
  startKey: string,
  endKey: string,
  timeZone: string,
): { startDate: string; endDate: string } {
  const [year, month, day] = endKey.split('-').map(Number);
  // 다음 날 0시에서 1밀리초를 뺀다. Date 생성자가 월·연 넘김을 처리한다.
  const endExclusive = zonedDayStart(year, month, day + 1, timeZone);

  return {
    startDate: zonedDateStringToUtc(startKey, timeZone).toISOString(),
    endDate: new Date(endExclusive.getTime() - 1).toISOString(),
  };
}

export function monthQueryRange(
  year: number,
  month: number,
  timeZone: string,
): { startDate: string; endDate: string } {
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  const { start, end } = zonedMonthRange(yearMonth, timeZone);
  return {
    startDate: start.toISOString(),
    endDate: new Date(end.getTime() - 1).toISOString(),
  };
}

/**
 * "YYYY-MM"에서 delta개월 옮긴 "YYYY-MM".
 *
 * 월은 항상 두 자리로 채운다. 서버가 예산 적용 기간을 문자열 비교로 따지므로
 * ("2026-9" > "2026-10"이 되어 버린다) 자리수가 어긋나면 안 된다.
 */
export function shiftYearMonth(yearMonth: string, delta: number): string {
  const [year, month] = yearMonth.split('-').map(Number);
  const index = month - 1 + delta;
  const shiftedYear = year + Math.floor(index / 12);
  const shiftedMonth = (((index % 12) + 12) % 12) + 1;
  return `${shiftedYear}-${String(shiftedMonth).padStart(2, '0')}`;
}

/**
 * 그 달의 선을 며칠까지 그을지.
 *
 * 지난 달은 말일까지 다 그린다. 이번 달은 오늘까지다. 아직 오지 않은 날을 0으로
 * 이어 그리면 선이 평평해져 "여기서 멈췄다"로 읽힌다. 앞날의 달은 하루도 지나지
 * 않았으므로 0이다.
 *
 * 이번 달인지도 프로젝트 타임존으로 따진다. 브라우저 로컬로 읽으면 자정 전후로
 * 달이 밀린다.
 */
export function throughDayOf(yearMonth: string, timeZone: string): number {
  const { year, month } = currentYearMonth(timeZone);
  const thisYearMonth = `${year}-${String(month).padStart(2, '0')}`;

  if (yearMonth === thisYearMonth) return Number(todayKey(timeZone).slice(8, 10));
  if (yearMonth > thisYearMonth) return 0;

  const [viewYear, viewMonth] = yearMonth.split('-').map(Number);
  // month는 1-based다. 다음 달의 0일 = 이 달의 말일.
  return new Date(Date.UTC(viewYear, viewMonth, 0)).getUTCDate();
}
