import type { EntryListItem } from '@/components/TransactionItem';
import { dateKeyOf } from './datetime';
import { toNumber } from './money';

/**
 * 전표 하나가 "지출"에 얼마를 보태는지.
 *
 * 이체 금액 자체는 소비가 아니라 계좌 사이의 이동이므로 0이고, 붙은 수수료만 지출이다.
 * 카드대금 결제도 부채 상환이라 0이다 (사용 시점에 이미 지출로 잡혔다).
 *
 * 서버의 "지출 = 지출 카테고리 posting의 합"과 같은 기준이다.
 * 날짜별 합계, 일별 누적, 목록 소계가 전부 이 함수를 쓰므로 화면끼리 어긋나지 않는다.
 */
export function expenseAmountOf(entry: EntryListItem): number {
  if (entry.kind === 'expense') return toNumber(entry.amount);
  if (entry.kind === 'transfer') return toNumber(entry.feeAmount);
  return 0;
}

/** 전표 하나가 "수입"에 보태는 금액 */
export function incomeAmountOf(entry: EntryListItem): number {
  return entry.kind === 'income' ? toNumber(entry.amount) : 0;
}

/** 날짜별 수입/지출 소계 */
export function sumEntries(entries: EntryListItem[]) {
  let incomeTotal = 0;
  let expenseTotal = 0;
  for (const entry of entries) {
    incomeTotal += incomeAmountOf(entry);
    expenseTotal += expenseAmountOf(entry);
  }
  return { incomeTotal, expenseTotal };
}

/** 일별 누적 그래프 데이터. 지출 기준으로 쌓는다. */
export function buildDailyCumulative(
  entries: EntryListItem[],
  year: number,
  month: number,
  timeZone: string,
): Array<{ day: number; amount: number; cumulative: number }> {
  const byDay = new Map<number, number>();
  for (const entry of entries) {
    const amount = expenseAmountOf(entry);
    if (amount === 0) continue;
    // 며칠에 속하는지는 프로젝트 타임존 기준이다 (UTC로 읽으면 하루 밀린다).
    const day = Number(dateKeyOf(entry.date, timeZone).slice(8, 10));
    byDay.set(day, (byDay.get(day) ?? 0) + amount);
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  const result: Array<{ day: number; amount: number; cumulative: number }> = [];
  let cumulative = 0;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const amount = byDay.get(day) ?? 0;
    cumulative += amount;
    result.push({ day, amount, cumulative });
  }
  return result;
}
