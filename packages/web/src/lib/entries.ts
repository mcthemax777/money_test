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

/**
 * 일별 누적 그래프 데이터. 지출 기준으로 쌓는다.
 *
 * 달 단위가 아니라 구간(startKey ~ endKey, "YYYY-MM-DD", 양끝 포함)을 받는다.
 * 가계 화면이 달을 넘는 기간도 보여 주기 때문이다. 거래가 없는 날도 점을 만들어
 * 선이 끊기지 않게 한다.
 *
 * x축 라벨은 한 달 안이면 "5일", 달을 넘으면 "8/5"다. 달을 넘는 구간에서 날짜만
 * 찍으면 8월 5일과 9월 5일이 같은 이름으로 두 번 나온다.
 */
export function buildDailyCumulative(
  entries: EntryListItem[],
  startKey: string,
  endKey: string,
  timeZone: string,
): Array<{ label: string; amount: number; cumulative: number }> {
  const byDay = new Map<string, number>();
  for (const entry of entries) {
    const amount = expenseAmountOf(entry);
    if (amount === 0) continue;
    // 며칠에 속하는지는 프로젝트 타임존 기준이다 (UTC로 읽으면 하루 밀린다).
    const key = dateKeyOf(entry.date, timeZone);
    byDay.set(key, (byDay.get(key) ?? 0) + amount);
  }

  const sameMonth = startKey.slice(0, 7) === endKey.slice(0, 7);
  const result: Array<{ label: string; amount: number; cumulative: number }> = [];
  let cumulative = 0;

  // 날짜 계산은 달력 날짜끼리만 한다. 타임존은 위에서 이미 반영했다.
  const [startYear, startMonth, startDay] = startKey.split('-').map(Number);
  const cursor = new Date(Date.UTC(startYear, startMonth - 1, startDay));
  const last = (() => {
    const [year, month, day] = endKey.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  })();

  while (cursor.getTime() <= last) {
    const month = cursor.getUTCMonth() + 1;
    const day = cursor.getUTCDate();
    const key = `${cursor.getUTCFullYear()}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const amount = byDay.get(key) ?? 0;
    cumulative += amount;
    result.push({ label: sameMonth ? `${day}일` : `${month}/${day}`, amount, cumulative });
    cursor.setUTCDate(day + 1);
  }

  return result;
}

/** 그 달의 첫날과 말일 ("YYYY-MM-DD"). 달 단위 화면이 위 함수에 넘길 값이다. */
export function monthDateKeys(year: number, month: number): { startKey: string; endKey: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    startKey: `${year}-${pad(month)}-01`,
    endKey: `${year}-${pad(month)}-${pad(lastDay)}`,
  };
}
