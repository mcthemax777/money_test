import { clampDayOfMonth, zonedParts } from './tz';

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
 *
 * 이 파일은 원래 서버(api/modules/ledger)에 있었다. 순수 계산이고 기기도 오프라인에서
 * 청구 주기를 그려야 해서 @money/types 로 옮겼다. 새 의존성은 없다 -- 옮기기 전에도
 * 이 패키지의 clampDayOfMonth 와 zonedParts 만 쓰고 있었다.
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
 * 마감 연월으로 주기 하나를 만든다.
 *
 * 마감일이 15일이고 마감 연월이 2026-09면 8/16 ~ 9/15 주기가 된다.
 * 결제일은 "마감일 이후 처음 돌아오는 결제일"로 정의한다. 카드사마다 규칙이 다르지만,
 * 마감보다 앞선 결제일은 존재할 수 없으므로 이 규칙이 안전하다.
 */
export function periodForClosingMonth(
  year: number,
  month: number,
  closingDay: number,
  dueDay: number,
): StatementPeriod {
  const endDay = clampDayOfMonth(year, month, closingDay);

  // 직전 마감일 다음 날이 주기 시작일
  const previous = shiftMonth(year, month, -1);
  const previousClosing = dateMarker(
    previous.year,
    previous.month,
    clampDayOfMonth(previous.year, previous.month, closingDay),
  );
  const periodStart = new Date(previousClosing.getTime() + 24 * 60 * 60 * 1000);

  const dueThisMonth = clampDayOfMonth(year, month, dueDay);
  const due = dueThisMonth > endDay ? { year, month } : shiftMonth(year, month, 1);

  return {
    periodStart,
    periodEnd: dateMarker(year, month, endDay),
    dueDate: dateMarker(due.year, due.month, clampDayOfMonth(due.year, due.month, dueDay)),
  };
}

/** 거래일(또는 임의의 날짜)이 속하는 주기의 마감 연월 */
export function closingMonthOf(
  date: Date,
  closingDay: number,
  timeZone: string,
): { year: number; month: number } {
  const { year, month, day } = zonedParts(date, timeZone);
  // 마감일보다 늦게 쓴 건 다음 달 마감분에 속한다.
  return day <= clampDayOfMonth(year, month, closingDay) ? { year, month } : shiftMonth(year, month, 1);
}

/** 거래일이 속하는 청구 주기를 구한다. */
export function resolveStatementPeriod(
  transactionDate: Date,
  closingDay: number,
  dueDay: number,
  timeZone: string,
): StatementPeriod {
  const { year, month } = closingMonthOf(transactionDate, closingDay, timeZone);
  return periodForClosingMonth(year, month, closingDay, dueDay);
}

/** 마감 연월에 delta를 더한다. 할부 회차를 다음 주기로 밀 때 쓴다. */
export function shiftClosingMonth(
  closing: { year: number; month: number },
  delta: number,
): { year: number; month: number } {
  return shiftMonth(closing.year, closing.month, delta);
}

/** 마감 연월을 정렬·비교할 수 있는 키로 만든다 */
export function closingMonthKey(closing: { year: number; month: number }): string {
  return `${closing.year}-${String(closing.month).padStart(2, '0')}`;
}
