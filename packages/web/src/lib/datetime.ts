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
import { zonedDateKey, zonedMonthRange, zonedTimeKey } from '@money/types';

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
  return new Date(instant).toLocaleDateString('ko-KR', { timeZone });
}

/** 상세에 쓰는 날짜(+시각) 표기. 시간을 입력하지 않은 거래는 날짜만 보여준다. */
export function formatDateTime(instant: string | Date, timeZone: string): string {
  const hasTime = timeInputOf(instant, timeZone) !== '';
  return new Date(instant).toLocaleString('ko-KR', {
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
  return new Date(marker).toLocaleDateString('ko-KR', { timeZone: 'UTC' });
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
