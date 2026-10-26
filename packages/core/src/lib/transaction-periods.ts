/**
 * 거래 화면의 기간 줄이 조회에 싣는 구간.
 *
 * 기간 줄 하나(달·주·해, 또는 검색으로 정한 기간)를 서버와 사본이 받는 조건으로 바꾸고, 검색이
 * 고른 기간과 겹치는 자리만 잘라 낸다. 순수한 계산이라 `useTransactions` 밖에 둔다 (2026-10-26).
 */
import type { ReportDto } from '@money/types';
import {
  Dec,
  isCalendarMonthKey,
  periodDayRange,
  rangePeriodKey,
  zonedMonthRange,
  type EntryPeriodUnit,
  type PeriodAnchor,
  type WeekStart,
} from '@money/types';

import { dayRangeQuery } from './datetime';
import type { SearchRange } from './transaction-search';

/**
 * 목록이 기간을 나누는 규칙. 분석 화면이 같은 규칙으로 오늘이 든 기간을 연다.
 *
 * `rangeKey` 는 검색에서 기간을 정해 목록이 그 한 줄일 때의 열쇠다.
 */
export interface PeriodGrouping {
  unit: EntryPeriodUnit;
  weekStart: WeekStart;
  anchor: PeriodAnchor;
  rangeKey: string | null;
}

/**
 * 한 달을 가리키는 조회 조건.
 *
 * **달 이름을 그대로 넘긴다.** 예전에는 `-01 ~ -31` 구간을 만들어 넘겼는데 두 가지가
 * 어긋났다.
 *
 *   ① `new Date('2026-11-31')` 은 오류가 아니라 **2026-12-01 로 넘어간다**(2월은 3월
 *      3일까지). 그래서 30일 이하인 달을 고르면 다음 달 초하루가 함께 골라졌다 --
 *      그 달이 "일부 선택"으로 보이는 것이 그 흔적이다.
 *   ② UTC 자정은 한국의 오전 9시다. 그 앞 아홉 시간의 거래가 목록에서 빠지는데 월
 *      합계는 그것을 세고 있었다.
 *
 * 경계를 만드는 일은 각자 아는 쪽이 한다. 서버는 프로젝트 타임존으로, 기기는 동기화할
 * 때 박아 둔 `yearMonth` 컬럼으로.
 *
 * **기간 검색을 켜면 이야기가 달라진다.** 그 달이 구간에 반만 걸치면 달 이름으로는
 * 그 반을 가리킬 수 없다. 그때만 구간을 만들어 넘긴다 (아래 `clipMonth`).
 */
export const monthRange = (yearMonth: string) => ({ yearMonth });

/**
 * 그 기간을 통째로 가리키는 조회 조건.
 *
 * **달은 이름을 그대로 넘긴다.** 경계를 만드는 일을 서버와 사본이 각자 아는 방법으로
 * 하게 두는 것이 위의 규칙이고, 그 길이 가장 잘 닳아 있다. 해와 주는 그 이름이 없어
 * 달력 날짜 두 개로 적는다 -- 양끝을 이 자리에서 만드는 것은 `periodDayRange` 가
 * 서버·사본과 같은 함수이기 때문이다.
 */
export function wholePeriod(key: string) {
  if (isCalendarMonthKey(key)) return monthRange(key);
  const { startKey, endKey } = periodDayRange(key);
  return { startDate: startKey, endDate: endKey };
}

/**
 * 그 기간과 고른 기간이 겹치는 자리.
 *
 * 통째로 덮이면 null 이다. 그때는 기간을 통째로 가리키는 조건을 쓴다 (`wholePeriod`).
 */
export function clipMonth(
  yearMonth: string,
  range: SearchRange | null,
): { startKey: string; endKey: string } | null {
  if (!range) return null;

  const { startKey: first, endKey: last } = periodDayRange(yearMonth);
  /*
   * 달력 키는 0을 채운 문자열이라 사전순 비교가 곧 날짜 비교다.
   *
   * 열린 쪽은 그 달의 끝으로 채운다. 달이 이미 구간을 막고 있어, 그 달 안에서는
   * "끝까지"와 "말일까지"가 같은 말이다.
   */
  const startKey = range.startKey && range.startKey > first ? range.startKey : first;
  const endKey = range.endKey && range.endKey < last ? range.endKey : last;

  if (startKey === first && endKey === last) return null;
  return { startKey, endKey };
}

/**
 * 받은 기간 줄들을 검색 기간 한 줄로 합친다.
 *
 * 서버는 단위대로 나눠 주지만 각 줄은 이미 검색 기간으로 잘라 센 값이라, 더하면 기간
 * 전체의 합이다. 열린 쪽(시작일만, 종료일만)은 받은 줄의 처음·끝으로 채운다. 그 너머에는
 * 걸린 거래가 없다.
 */
export function collapseToRange(
  rows: ReportDto.EntryMonth[],
  range: SearchRange,
): ReportDto.EntryMonth[] {
  if (rows.length === 0) return rows;
  const spans = rows.map((row) => periodDayRange(row.yearMonth));
  const startKey =
    range.startKey ?? spans.reduce((min, span) => (span.startKey < min ? span.startKey : min), spans[0].startKey);
  const endKey =
    range.endKey ?? spans.reduce((max, span) => (span.endKey > max ? span.endKey : max), spans[0].endKey);
  const sum = (pick: (row: ReportDto.EntryMonth) => string) =>
    rows.reduce((total, row) => total.plus(pick(row)), Dec.of(0)).toString();
  return [
    {
      yearMonth: rangePeriodKey(startKey, endKey),
      income: sum((row) => row.income),
      expense: sum((row) => row.expense),
    },
  ];
}

/**
 * 구간 조회가 볼 기간. 달력 날짜다 (ReportDto.PeriodQuery 의 규칙).
 *
 * 기간이 그 달을 통째로 덮으면 달 이름을 그대로 넘긴다.
 */
export function reportPeriodOf(yearMonth: string, range: SearchRange | null) {
  const clipped = clipMonth(yearMonth, range);
  return clipped
    ? { startDate: clipped.startKey, endDate: clipped.endKey }
    : wholePeriod(yearMonth);
}

/**
 * 목록 조회가 볼 기간. **인스턴트다** (EntryDto.ListQuery 의 규칙).
 *
 * 같은 이름의 두 값이 뜻이 다르다. 목록 API 는 인스턴트를 받고 구간 조회는 달력
 * 날짜를 받는다. 달력 날짜를 그대로 목록에 넘기면 시작일은 그날 오전 9시부터가 되고
 * 종료일은 오전 9시에 잘린다(한국 기준). `dayRangeQuery` 가 그 변환을 안다.
 */
export function listRangeOf(yearMonth: string, range: SearchRange | null, timeZone: string) {
  const clipped = clipMonth(yearMonth, range);
  if (clipped) return dayRangeQuery(clipped.startKey, clipped.endKey, timeZone);
  /*
   * 달력의 달은 이름 하나로 끝난다. 해·주와 시작일을 옮긴 달, 직접 정한 기간은 그
   * 이름이 없어 인스턴트 구간으로 적는다.
   */
  if (isCalendarMonthKey(yearMonth)) return monthRange(yearMonth);
  const { startKey, endKey } = periodDayRange(yearMonth);
  return dayRangeQuery(startKey, endKey, timeZone);
}

/**
 * 그 기간 줄이 보는 구간. **인스턴트 두 개다.**
 *
 * 조회 조건(`listRangeOf`)은 달을 이름으로 넘기지만, 회차를 가릴 때는 실제 경계가
 * 있어야 한다 -- 지난달에 산 할부의 어느 회차가 이 달에 서는지를 시각으로 견준다.
 */
export function entryWindowOf(
  yearMonth: string,
  range: SearchRange | null,
  timeZone: string,
): { start: Date; end: Date } {
  const clipped = clipMonth(yearMonth, range);
  if (clipped) {
    const query = dayRangeQuery(clipped.startKey, clipped.endKey, timeZone);
    return { start: new Date(query.startDate), end: new Date(query.endDate) };
  }
  if (isCalendarMonthKey(yearMonth)) return zonedMonthRange(yearMonth, timeZone);
  const { startKey, endKey } = periodDayRange(yearMonth);
  const query = dayRangeQuery(startKey, endKey, timeZone);
  return { start: new Date(query.startDate), end: new Date(query.endDate) };
}
