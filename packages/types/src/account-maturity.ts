/**
 * 정기예금·적금의 만기일.
 *
 * 만기일은 시각이 아니라 달력의 날("YYYY-MM-DD")이다. 서버 칸·기기 사본·요청이 모두 같은
 * 문자열이라 타임존에 따라 하루가 밀리지 않는다. 남은 날(D-day)은 가계부 타임존의 오늘과
 * 견준다 (@money/core 의 asset-meta).
 */
import type { AccountType } from './entities';

/** 만기일을 갖는 유형. 다른 유형으로 바꾸면 만기일을 지운다. */
export const MATURITY_ACCOUNT_TYPES: readonly AccountType[] = ['time_deposit', 'savings'];

export function hasMaturity(type: string): boolean {
  return (MATURITY_ACCOUNT_TYPES as readonly string[]).includes(type);
}

/**
 * 실재하는 날 "YYYY-MM-DD" 인가. `2026-02-31` 처럼 모양만 맞는 값은 거른다 --
 * 그대로 두면 D-day 가 조용히 어긋난다.
 */
export function isMaturityDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}
