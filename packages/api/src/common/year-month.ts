import { BadRequestException } from '@nestjs/common';

/**
 * "YYYY-MM" 검증.
 *
 * 월 집계는 이 문자열을 `zonedMonthRange`에 그대로 넘긴다. 그 함수는 JS Date의
 * 월 넘김을 그대로 쓰므로 "2026-99"가 조용히 2034년 3월이 된다. 오류 대신
 * 엉뚱한 달의 숫자가 나오는 편이 더 나쁘다.
 *
 * 적용 기간 비교(`isBudgetApplicable`)도 문자열 그대로 하므로 형식이 어긋나면
 * 순서가 뒤집힌다. "2026-9"는 "2026-10"보다 크다.
 */
export function assertYearMonth(value: string, label = '연월'): string {
  const text = value?.trim() ?? '';
  const match = /^(\d{4})-(\d{2})$/.exec(text);
  const month = match ? Number(match[2]) : 0;

  if (!match || month < 1 || month > 12) {
    throw new BadRequestException(`${label}: YYYY-MM 형식이어야 합니다.`);
  }

  return text;
}

/** 경로 파라미터로 따로 들어오는 연/월. 숫자로 바꾸고 범위를 확인한다. */
export function assertYearMonthParts(
  year: string | number,
  month: string | number,
  label = '연월',
): { year: number; month: number } {
  const y = Number(year);
  const m = Number(month);

  if (!Number.isInteger(y) || y < 1900 || y > 9999 || !Number.isInteger(m) || m < 1 || m > 12) {
    throw new BadRequestException(`${label}: 연도와 월이 올바르지 않습니다.`);
  }

  return { year: y, month: m };
}

/**
 * "YYYY-MM-DD" 달력 날짜.
 *
 * 기간 조회의 양끝에 쓴다. Date 로 파싱해 검사하지 않는 이유는 "2026-02-31"
 * 같은 값을 Date 가 3월 3일로 조용히 옮기기 때문이다. 형식과 범위를 직접 본다.
 */
export function assertDateKey(value: string, label = '날짜'): string {
  const text = value?.trim() ?? '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const month = match ? Number(match[2]) : 0;
  const day = match ? Number(match[3]) : 0;

  if (!match || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new BadRequestException(`${label}: YYYY-MM-DD 형식이어야 합니다.`);
  }

  return text;
}
