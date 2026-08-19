/**
 * 신용카드 청구 주기 계산.
 *
 * 마감일(statementClosingDay)과 결제일(paymentDueDay)은 "매월 N일" 형태로 저장되지만
 * 달마다 말일이 다르므로 실제 날짜로 바꿀 때 clamp가 필요하다.
 * 예: 마감일 31일 + 2월 -> 2월 28일(윤년이면 29일)
 */

/** 해당 연월에서 dayOfMonth를 그 달의 말일로 잘라낸 Date (UTC 자정) */
export function clampDayOfMonth(year: number, monthIndex: number, dayOfMonth: number): Date {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, monthIndex, Math.min(dayOfMonth, lastDay)));
}

export interface StatementPeriod {
  periodStart: Date;
  periodEnd: Date; // 마감일
  dueDate: Date;   // 결제일
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
): StatementPeriod {
  const year = transactionDate.getUTCFullYear();
  const monthIndex = transactionDate.getUTCMonth();

  const closingThisMonth = clampDayOfMonth(year, monthIndex, closingDay);

  // 거래일이 이번 달 마감일보다 늦으면 다음 달 마감분에 속한다.
  const periodEnd =
    transactionDate.getTime() <= closingThisMonth.getTime()
      ? closingThisMonth
      : clampDayOfMonth(year, monthIndex + 1, closingDay);

  // 직전 마감일 다음 날이 주기 시작일
  const previousClosing = clampDayOfMonth(
    periodEnd.getUTCFullYear(),
    periodEnd.getUTCMonth() - 1,
    closingDay,
  );
  const periodStart = new Date(previousClosing.getTime() + 24 * 60 * 60 * 1000);

  // 마감일 이후 처음 돌아오는 결제일
  let dueDate = clampDayOfMonth(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth(), dueDay);
  if (dueDate.getTime() <= periodEnd.getTime()) {
    dueDate = clampDayOfMonth(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth() + 1, dueDay);
  }

  return { periodStart, periodEnd, dueDate };
}
