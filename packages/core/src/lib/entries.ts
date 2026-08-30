import type { EntryFilterQuery, EntryListItem } from '@money/types';

import { activeLocale, translate } from '../lib/i18n';
import { dateKeyOf } from './datetime';
import { toNumber } from './money';

/** buildDailyCumulative 한 점 */
export interface DailyCumulativePoint {
  label: string;
  amount: number;
  cumulative: number;
}

/** 겹쳐 그릴 앞선 달 하나 */
export interface CumulativeSeries {
  /** 범례에 적을 이름. "7월" */
  name: string;
  points: DailyCumulativePoint[];
}

/**
 * 일반/과소비 중 어느 몫을 세는지. undefined면 거래 금액 전부다.
 *
 * 한 거래가 둘로 나뉜다(3,000원 중 2,000원이 과소비). 일반만 보는 화면에서 그
 * 거래를 통째로 세면 서버가 주는 합계(1,000원)와 어긋난다.
 */
export type CountedShare = 'normal' | 'extra' | undefined;

/**
 * 거래를 날짜별로 묶는다. 열쇠는 프로젝트 타임존 기준의 "YYYY-MM-DD" 다.
 *
 * 거래마다 한 번만 타임존 변환을 한다. 달력처럼 날짜 칸이 42개인 화면에서 칸마다
 * 전체 목록을 훑으면 같은 변환을 거래 수 × 42번 하게 된다. 그 변환은 Intl 을 거치는
 * 값비싼 일이라, 거래 120건이면 5천 번이 넘어 탭을 옮길 때마다 화면이 굳는다.
 */
export function groupEntriesByDate<T extends { date: string | Date }>(
  entries: T[],
  timeZone: string,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();

  for (const entry of entries) {
    const key = dateKeyOf(entry.date, timeZone);
    const list = grouped.get(key);
    if (list) list.push(entry);
    else grouped.set(key, [entry]);
  }

  return grouped;
}

/** 조회 필터에서 셀 몫을 읽는다. 둘 다 골랐거나 필터가 없으면 전부다. */
export function countedShare(filter?: EntryFilterQuery): CountedShare {
  const types = filter?.extraTypes;
  if (types === undefined) return undefined;

  const wantsNormal = types.includes('normal');
  const wantsExtra = types.includes('extra');
  if (wantsNormal === wantsExtra) return undefined;

  return wantsExtra ? 'extra' : 'normal';
}

/** 거래 금액 중 세어야 할 몫. 서버의 normalAmount/extraAmount와 같은 규칙이다. */
function shareOf(total: number, entry: EntryListItem, share: CountedShare): number {
  if (share === undefined) return total;

  const extra = Math.min(toNumber(entry.extraAmount), total);
  return share === 'extra' ? extra : total - extra;
}

/**
 * 전표 하나가 "지출"에 얼마를 보태는지.
 *
 * 이체 금액 자체는 소비가 아니라 계좌 사이의 이동이므로 0이고, 붙은 수수료만 지출이다.
 * 카드대금 결제도 부채 상환이라 0이다 (사용 시점에 이미 지출로 잡혔다).
 *
 * 서버의 "지출 = 지출 카테고리 posting의 합"과 같은 기준이다.
 * 날짜별 합계, 일별 누적, 목록 소계가 전부 이 함수를 쓰므로 화면끼리 어긋나지 않는다.
 */
export function expenseAmountOf(entry: EntryListItem, share?: CountedShare): number {
  if (entry.kind === 'expense') return shareOf(toNumber(entry.amount), entry, share);
  // 이체는 수수료만 지출이고, 과소비도 그 수수료에 붙는다.
  if (entry.kind === 'transfer') return shareOf(toNumber(entry.feeAmount), entry, share);
  return 0;
}

/** 전표 하나가 "수입"에 보태는 금액 */
export function incomeAmountOf(entry: EntryListItem, share?: CountedShare): number {
  return entry.kind === 'income' ? shareOf(toNumber(entry.amount), entry, share) : 0;
}

/** 날짜별 수입/지출 소계 */
export function sumEntries(entries: EntryListItem[], share?: CountedShare) {
  let incomeTotal = 0;
  let expenseTotal = 0;
  for (const entry of entries) {
    incomeTotal += incomeAmountOf(entry, share);
    expenseTotal += expenseAmountOf(entry, share);
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
  share?: CountedShare,
): DailyCumulativePoint[] {
  const byDay = new Map<string, number>();
  for (const entry of entries) {
    const amount = expenseAmountOf(entry, share);
    if (amount === 0) continue;
    // 며칠에 속하는지는 프로젝트 타임존 기준이다 (UTC로 읽으면 하루 밀린다).
    const key = dateKeyOf(entry.date, timeZone);
    byDay.set(key, (byDay.get(key) ?? 0) + amount);
  }

  const sameMonth = startKey.slice(0, 7) === endKey.slice(0, 7);
  const result: DailyCumulativePoint[] = [];
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
    result.push({
      label: sameMonth ? translate(activeLocale(), 'chart.dayTick', { day }) : `${month}/${day}`,
      amount,
      cumulative,
    });
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
