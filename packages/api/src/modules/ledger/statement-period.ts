import { clampDayOfMonth, zonedParts } from '@money/types';

/**
 * 신용카드 청구 주기 계산.
 *
 * 마감일(statementClosingDay)과 결제일(paymentDueDay)은 "매월 N일" 형태로 저장되지만
 * 달마다 말일이 다르므로 실제 날짜로 바꿀 때 clamp가 필요하다.
 * 예: 마감일 31일 + 2월 -> 2월 28일(윤년이면 29일)
 *
 * 거래일이 어느 주기에 속하는지는 **프로젝트 타임존의 달력 날짜**로 판단한다.
 * 거래는 UTC 인스턴트로 저장되므로, UTC 기준으로 날짜를 읽으면 한국의
 * 00:00~09:00 거래가 하루 앞 주기로 밀린다.
 *
 * 반환하는 세 값은 인스턴트가 아니라 **달력 날짜 표시자**다. CardStatement의
 * periodStart/periodEnd/dueDate 컬럼이 `@db.Date`라 날짜만 저장되므로,
 * 해당 날짜의 UTC 자정을 담은 Date로 돌려준다.
 */

/** 달력 날짜 표시자. `@db.Date` 컬럼에 그대로 넣는다. */
function dateMarker(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/** month(1~12)에 delta를 더한 연/월. 12월을 넘으면 해가 바뀐다. */
function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = month - 1 + delta;
  return {
    year: year + Math.floor(index / 12),
    month: ((index % 12) + 12) % 12 + 1,
  };
}

export interface StatementPeriod {
  periodStart: Date;
  periodEnd: Date; // 마감일
  dueDate: Date; // 결제일
}

/**
 * 거래일이 속하는 청구 주기를 구한다.
 *
 * 마감일이 15일인 카드라면
 *   8/16 ~ 9/15 사용분이 9/15에 마감되고, 그 다음 결제일에 청구된다.
 * 결제일은 "마감일 이후 처음 돌아오는 결제일"로 정의한다.
 * 카드사마다 규칙이 다르지만, 마감보다 앞선 결제일은 존재할 수 없으므로 이 규칙이 안전하다.
 */
export function resolveStatementPeriod(
  transactionDate: Date,
  closingDay: number,
  dueDay: number,
  timeZone: string,
): StatementPeriod {
  const { year, month, day } = zonedParts(transactionDate, timeZone);

  // 거래일이 이번 달 마감일보다 늦으면 다음 달 마감분에 속한다.
  const closingThisMonth = clampDayOfMonth(year, month, closingDay);
  const end =
    day <= closingThisMonth ? { year, month } : shiftMonth(year, month, 1);
  const endDay = clampDayOfMonth(end.year, end.month, closingDay);

  // 직전 마감일 다음 날이 주기 시작일
  const previous = shiftMonth(end.year, end.month, -1);
  const previousClosing = dateMarker(
    previous.year,
    previous.month,
    clampDayOfMonth(previous.year, previous.month, closingDay),
  );
  const periodStart = new Date(previousClosing.getTime() + 24 * 60 * 60 * 1000);

  // 마감일 이후 처음 돌아오는 결제일
  const dueThisMonth = clampDayOfMonth(end.year, end.month, dueDay);
  const due = dueThisMonth > endDay ? end : shiftMonth(end.year, end.month, 1);
  const dueDate = dateMarker(due.year, due.month, clampDayOfMonth(due.year, due.month, dueDay));

  return {
    periodStart,
    periodEnd: dateMarker(end.year, end.month, endDay),
    dueDate,
  };
}
