/**
 * 카드 마감일/결제일용 "매월 N일" 옵션.
 *
 * 서버는 그 달에 없는 날짜를 말일로 자른다(`statement-period.ts`의 clampDayOfMonth).
 * 31일을 고르면 2월에는 28일(윤년 29일)이 마감일이 되므로 라벨로 그 의도를 밝힌다.
 * 29·30일도 2월에는 같은 규칙이 적용되므로 안내 문구를 셀렉트 옆에 함께 둔다.
 */
export const DAY_OF_MONTH_OPTIONS: Array<{ day: number; label: string }> = Array.from(
  { length: 31 },
  (_, index) => {
    const day = index + 1;
    return { day, label: day === 31 ? '31일 (말일)' : `${day}일` };
  },
);

/** 셀렉트 아래에 붙이는 안내. clamp 규칙을 사용자에게 알린다. */
export const DAY_OF_MONTH_HINT = '그 달에 없는 날짜는 말일로 처리합니다.';

/**
 * 카드를 새로 만들 때의 마감일·결제일 기본값.
 *
 * 마감일 31은 "말일"이다. 그 달에 없는 날짜는 서버가 말일로 자르므로(clampDayOfMonth)
 * 31을 고르면 2월에는 28일(윤년 29일)이 마감일이 된다. 카드를 고쳐 만든 값은
 * 건드리지 않고, 추가 폼의 시작값에만 쓴다.
 */
export const DEFAULT_STATEMENT_CLOSING_DAY = 31;
export const DEFAULT_PAYMENT_DUE_DAY = 14;
