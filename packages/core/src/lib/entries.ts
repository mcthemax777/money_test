import type { EntryListItem } from '@money/types';

import { activeLocale, translate, type MessageKey } from '../lib/i18n';
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
  // 이체 금액은 소비가 아니다. 붙은 수수료만 지출이다.
  if (entry.kind === 'transfer') return toNumber(entry.feeAmount);
  return 0;
}

/**
 * 설명이 빈 줄의 이름으로 쓰는 분류. "대분류 > 소분류" 를 다 적는다.
 *
 * 소분류가 없으면 대분류 하나, 분류 자체가 없으면 빈 글자다 (부르는 쪽이 "(내용 없음)"
 * 으로 받는다). 이름 자리에서는 계층을 좁히지 않는다 -- 그 줄에서 유일하게 무슨 거래인지
 * 말하는 글자이기 때문이다. 곁말에 적는 분류는 이와 달리 잎사귀 하나만 적는다.
 *
 * 거래 목록 한 줄과 자산 상세의 원장 한 줄이 함께 쓴다. 웹과 앱까지 넷이 같은 규칙으로
 * 읽혀야 해서 여기 둔다.
 */
export function categoryTitleOf(row: {
  categoryName: string | null;
  parentCategoryName: string | null;
}): string {
  if (!row.categoryName) return '';
  return row.parentCategoryName ? `${row.parentCategoryName} > ${row.categoryName}` : row.categoryName;
}

/**
 * 목록 한 줄이 곁말에 적는 "쓴 자산". 카드로 냈으면 카드, 아니면 통장이다.
 *
 * 제목에 이미 선 이름은 다시 적지 않는다. 이체는 제목이 곧 "보낸 곳 -> 받은 곳"이라
 * 통장 이름이 한 줄에 두 번 서고, 카드 대금은 카드 이름이 제목이므로 여기서는 돈이
 * 빠져나간 통장을 적는다. 잔액 조정은 제목이 "잔액 조정" 뿐이라 상대가 있으면 그
 * 흐름을, 없으면 조정한 계좌 하나를 적는다.
 *
 * `flow` 는 부르는 쪽이 만든 "A -> B" 글자다. 잔액 조정에만 쓰인다.
 *
 * 웹과 앱의 거래 한 줄이 같은 규칙으로 읽혀야 해서 여기 둔다.
 */
export function entryAssetName(entry: EntryListItem, flow: string): string {
  if (entry.kind === 'transfer') return '';
  if (entry.kind === 'adjustment') return flow || entry.accountName || '';
  if (entry.kind === 'card_payment') return entry.accountName ?? '';
  return entry.cardName ?? entry.accountName ?? '';
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
): DailyCumulativePoint[] {
  const byDay = new Map<string, number>();
  for (const entry of entries) {
    const amount = expenseAmountOf(entry);
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

/** 가계 첫 문장이 다루는 갈래. 지출과 수입 둘뿐이다. */
export type LedgerKindKey = 'expense' | 'income';

/**
 * 가계 첫 문장 아래에 놓는 갈래 상자.
 *
 * 자산 화면의 `ASSET_TYPE_GROUPS` 와 같은 자리다 (lib/net-worth). 그쪽이 계좌 유형을
 * 빠짐없이 나눈 넷이라면 이쪽은 돈의 방향 둘이고, 둘을 다 켜면 문장의 금액이 순수입이 된다.
 */
export const LEDGER_KIND_GROUPS: Array<{ key: LedgerKindKey; labelKey: MessageKey }> = [
  { key: 'expense', labelKey: 'tx.kind.expense' },
  { key: 'income', labelKey: 'tx.kind.income' },
];

/**
 * 첫 문장 금액이 어느 쪽 돈인가. 화면이 색을 고르는 데 쓴다.
 *
 * **부호만으로는 정할 수 없다.** 지출만 켜면 금액이 양수인데(부호를 뒤집지 않는다)
 * 그것은 나간 돈이라, 양수를 초록으로 적으면 "지출은 30만 원입니다"가 돈이 들어온
 * 것처럼 읽힌다. 그래서 낱말을 정하는 이 자리에서 방향까지 함께 정한다.
 */
export type LedgerTone = 'positive' | 'negative' | 'neutral';

/**
 * 켜 둔 갈래로 첫 문장의 낱말과 금액, 그 금액의 방향을 정한다.
 *
 *   둘 다 켜면   순수입 (수입 - 지출). 더 썼으면 음수다.
 *   수입만 켜면  수입
 *   지출만 켜면  지출. 부호를 뒤집지 않는다 -- "지출은 30만 원입니다"로 읽혀야 한다.
 *   둘 다 끄면   더할 것이 없어 순수입 0.
 *
 * 낱말을 열쇠로 돌려주는 이유는 언어다. 문장을 여기서 만들면 조사와 어순이 한국어로
 * 굳는다 (영어 사전은 조사 자리를 비워 둔다).
 */
export function ledgerHeadline(
  selectedKeys: readonly string[],
  totals: { incomeTotal: number; expenseTotal: number },
): { nounKey: MessageKey; amount: number; tone: LedgerTone } {
  const income = selectedKeys.includes('income');
  const expense = selectedKeys.includes('expense');

  if (income && expense) {
    const amount = totals.incomeTotal - totals.expenseTotal;
    return { nounKey: 'ledgerSummary.net', amount, tone: toneOfSign(amount) };
  }
  if (income) {
    return {
      nounKey: 'tx.kind.income',
      amount: totals.incomeTotal,
      tone: toneOfSign(totals.incomeTotal),
    };
  }
  if (expense) {
    return {
      nounKey: 'tx.kind.expense',
      amount: totals.expenseTotal,
      // 양수여도 나간 돈이다. 0 원만 어느 쪽도 아니다.
      tone: totals.expenseTotal === 0 ? 'neutral' : 'negative',
    };
  }
  return { nounKey: 'ledgerSummary.net', amount: 0, tone: 'neutral' };
}

/** 순수입처럼 부호가 곧 방향인 금액. 0 은 어느 쪽도 아니다. */
function toneOfSign(amount: number): LedgerTone {
  if (amount > 0) return 'positive';
  if (amount < 0) return 'negative';
  return 'neutral';
}

/** 그 갈래의 상자에 적을 금액. 지출도 양수 그대로 적는다. */
export function ledgerKindAmount(
  key: LedgerKindKey,
  totals: { incomeTotal: number; expenseTotal: number },
): number {
  return key === 'income' ? totals.incomeTotal : totals.expenseTotal;
}
