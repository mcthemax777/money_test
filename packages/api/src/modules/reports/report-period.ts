/**
 * 리포트 조회의 기간 읽기 (reports.service.ts 에서 떼어 냄, 2026-10-26).
 *
 * 날짜는 프로젝트 타임존의 달력 날짜이고 **양끝을 포함한다**. 끝날을 그대로 상한으로 쓰면
 * 그날 0시 이후의 거래가 전부 빠지므로 다음 날 0시를 상한으로 삼는다.
 */
import { BadRequestException } from '@nestjs/common';
import {
  ReportDto,
  zonedDateKey,
  zonedDateStringToUtc,
  zonedDayStart,
  zonedMonthRange,
} from '@money/types';
import { assertDateKey, assertYearMonth } from '@/common/year-month';

/** 그 날짜 다음 날 0시. Date 생성자가 월·연 넘김을 처리하므로 말일을 따로 보지 않는다. */
function nextDayStart(dateKey: string, timeZone: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number);
  return zonedDayStart(year, month, day + 1, timeZone);
}

/**
 * 집계 구간을 정한다.
 *
 * startDate/endDate 를 주면 그 구간을, 아니면 yearMonth 의 한 달을 본다.
 * 끝날은 다음 날 0시를 상한으로 삼는다 (entryScope 가 `date < end` 로 거른다).
 */
export function resolvePeriod(
  query: ReportDto.PeriodQuery,
  timeZone: string,
): { start: Date; end: Date } {
  const { startDate, endDate } = query;

  if (!startDate && !endDate) {
    return zonedMonthRange(assertYearMonth(query.yearMonth ?? '', '조회 월'), timeZone);
  }
  if (!startDate || !endDate) {
    throw new BadRequestException('기간은 시작일과 종료일을 함께 지정해야 합니다.');
  }

  const start = assertDateKey(startDate, '시작일');
  const end = assertDateKey(endDate, '종료일');
  if (start > end) {
    throw new BadRequestException('시작일이 종료일보다 뒤입니다.');
  }

  return {
    start: zonedDateStringToUtc(start, timeZone),
    end: nextDayStart(end, timeZone),
  };
}

/**
 * 기간을 받을 수도 있고 안 받을 수도 있는 조회의 구간.
 *
 * `resolvePeriod` 와 규칙이 같다 -- 달력 날짜, 양끝 포함, 끝날은 다음 날 0시를
 * 상한으로 삼는다. 다른 점은 **없어도 된다**는 것과 **한쪽만 와도 된다**는 것이다.
 *
 * 한쪽만 온 것은 열린 구간이다. 시작일만 적으면 그날부터 끝까지, 종료일만 적으면
 * 처음부터 그날까지다. "이 날 이후에 쓴 것"은 반쪽짜리 입력이 아니라 그 자체로
 * 사용자가 묻는 것이라, 나머지 칸을 채우게 하는 대신 그대로 건다.
 */
export function resolveWindow(
  query: { startDate?: string; endDate?: string },
  timeZone: string,
): { gte?: Date; lt?: Date } | null {
  const { startDate, endDate } = query;
  if (!startDate && !endDate) return null;

  const start = startDate ? assertDateKey(startDate, '시작일') : undefined;
  const end = endDate ? assertDateKey(endDate, '종료일') : undefined;
  if (start && end && start > end) {
    throw new BadRequestException('시작일이 종료일보다 뒤입니다.');
  }

  const window: { gte?: Date; lt?: Date } = {};
  if (start) window.gte = zonedDateStringToUtc(start, timeZone);
  if (end) window.lt = nextDayStart(end, timeZone);
  return window;
}

/** 응답에 실을 구간 표시. 한 달을 본 경우에는 yearMonth 도 함께 준다. */
export function periodLabel(
  query: ReportDto.PeriodQuery,
  range: { start: Date; end: Date },
  timeZone: string,
) {
  return {
    startDate: zonedDateKey(range.start, timeZone),
    // end 는 다음 날 0시라 하루를 빼야 사용자가 고른 종료일이 된다.
    endDate: zonedDateKey(new Date(range.end.getTime() - 1), timeZone),
    ...(query.startDate && query.endDate ? {} : { yearMonth: query.yearMonth }),
  };
}
