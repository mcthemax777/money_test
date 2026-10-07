/**
 * 분석 탭의 값과 상태. 웹과 앱이 같은 훅을 쓴다. 거래 탭 년월 줄의 분석 아이콘이 여는 보기도
 * 같은 것이다 -- 거래 탭의 검색·단위·세는 방식과 그 줄의 기간으로 연다 (`AnalysisInitial`).
 *
 * 거래 탭과 짜임이 같다 -- 머리글의 검색·더보기(묶는 단위·세는 방식)와 걸어 둔 조건 알약은
 * 거래 탭의 것을 그대로 쓰고(`useTransactions`), 날짜별·분류별·수단별 탭 자리에 합계·지출·
 * 수입 탭이, 기간 줄과 거래내역 자리에 한 기간의 분석이 선다.
 *
 * 여기서 정하는 것은 셋이다.
 *
 *   1. **보는 기간.** 거래 목록이 기간을 끊는 규칙(`grouping`)으로 오늘이 든 기간에서 연다.
 *      검색 기간을 정했으면 그 기간 한 줄이고, 오늘이 기간 밖이면 기간 쪽 끝으로 당긴다.
 *      묶는 단위나 끊는 자리, 검색 기간을 바꾸면 다시 오늘에서 연다 -- 옛 단위의 열쇠는
 *      새 단위로 옮길 수 없다.
 *   2. **그 기간의 수입·지출·순수입.** 합계 탭의 요약이 적는다. 거래 탭의 기간 줄에 적히는
 *      값과 같은 조회(기간 줄 목록)에서 꺼낸다 -- 두 탭이 같은 기간에 다른 금액을 말하면
 *      어느 쪽도 믿을 수 없다.
 *   3. **분석 구간.** 보는 기간을 검색 기간과 겹치는 날로 자른다 (`analysisPeriodOf`).
 */
import { useCallback, useMemo, useState } from 'react';
import {
  isCalendarMonthKey,
  periodDayRange,
  periodKeyOf,
  rangePeriodKey,
  shiftPeriodKey,
  unitOfKey,
} from '@money/types';

import type { ReportPeriod } from '../lib/api-client';
import { dayRangeQuery, periodLabel } from '../lib/datetime';
import { toNumber } from '../lib/money';
import { useProjectTimeZone } from '../store/project';
import {
  useTransactions,
  type PeriodGrouping,
  type SearchRange,
  type TransactionSearch,
} from './useTransactions';
import type { EntryBasis, EntryPeriodUnit } from '@money/types';

/** 분석 탭. 합계는 순수입(수입 - 지출)이다. */
export type AnalysisKind = 'net' | 'expense' | 'income';

/**
 * 분석 탭의 보기 한 벌. 앱에서 거래내역으로 건너갔다가 ← 로 돌아올 때 되살린다
 * (`entry-focus` 의 쪽지에 실려 간다).
 *
 * `periodBasis` 는 그 기간을 고를 때의 끊는 규칙이다. 되살린 검색·단위가 같은 규칙을 다시
 * 만들면 고른 기간이 그대로 선다 (`useAnalysis` 의 chosen 주석).
 */
export interface AnalysisSnapshot {
  search: TransactionSearch;
  unit: EntryPeriodUnit;
  basis: EntryBasis;
  kind: AnalysisKind;
  periodKey: string;
  periodBasis: string;
}

/** 그 기간의 수입·지출·순수입. 기간 줄 목록이 오기 전에는 null 이다. */
export interface AnalysisTotals {
  income: number;
  expense: number;
  net: number;
}

/**
 * 분석이 보는 구간. 달이 통째로 기간 안이면 달 이름으로(앞선 두 달 겹쳐 그리기가 선다), 반만
 * 걸치면 겹치는 날로, 전혀 겹치지 않으면 null 이다.
 */
export function analysisPeriodOf(periodKey: string, range: SearchRange | null): ReportPeriod | null {
  const whole = periodDayRange(periodKey);
  // 달 이름으로 줄 수 있는 것은 달력의 달뿐이다. 시작일을 붙인 달은 날짜 구간으로 준다.
  const isMonth = isCalendarMonthKey(periodKey);

  const startKey =
    range?.startKey && range.startKey > whole.startKey ? range.startKey : whole.startKey;
  const endKey = range?.endKey && range.endKey < whole.endKey ? range.endKey : whole.endKey;
  if (startKey > endKey) return null;
  // 달을 통째로 보면 달 이름으로 준다. 앞선 두 달을 겹쳐 그리는 것은 달 이름일 때만 선다.
  if (isMonth && startKey === whole.startKey && endKey === whole.endKey) {
    return { yearMonth: periodKey };
  }
  return { startDate: startKey, endDate: endKey };
}

/** 추이를 자를 구간 (ISO). 끝은 그다음 날 0시다 -- 서버가 [from, to) 로 읽는다. */
export function trendClipOf(
  range: SearchRange | null,
  timeZone: string,
): { from?: string; to?: string } | undefined {
  if (!range) return undefined;
  return {
    ...(range.startKey
      ? { from: dayRangeQuery(range.startKey, range.startKey, timeZone).startDate }
      : {}),
    ...(range.endKey
      ? {
          to: new Date(
            Date.parse(dayRangeQuery(range.endKey, range.endKey, timeZone).endDate) + 1,
          ).toISOString(),
        }
      : {}),
  };
}

/**
 * 처음 여는 탭. 검색이 수입만 골랐으면 수입, 지출만 골랐으면 지출이다 -- 걸러 낸 쪽만 있는
 * 합계는 한쪽이 늘 0 이다. 유형을 거르지 않았으면 합계다.
 */
function initialKindOf(search: TransactionSearch): AnalysisKind {
  const { kinds } = search;
  if (kinds.length > 0 && kinds.every((kind) => kind === 'income')) return 'income';
  if (kinds.length > 0 && kinds.every((kind) => kind === 'expense')) return 'expense';
  return 'net';
}

/**
 * 처음 여는 기간. 검색 기간을 정했으면 그 한 줄이고, 아니면 오늘이 든 기간을 검색 기간
 * 안으로 당긴다 -- 기간이 지난 일이면 그 끝, 앞날이면 그 처음이다.
 */
function defaultPeriodKey(
  grouping: PeriodGrouping,
  rangeKey: string | null,
  range: SearchRange | null,
  timeZone: string,
): string {
  if (rangeKey) return rangeKey;
  const { unit, weekStart, anchor } = grouping;
  // 달력 날짜 하나를 그날 정오로 읽는다. 자정으로 읽으면 타임존에 따라 전날이 된다.
  const keyOf = (dateKey: string) =>
    periodKeyOf(`${dateKey}T12:00:00Z`, 'UTC', unit, weekStart, anchor);
  let key = periodKeyOf(new Date(), timeZone, unit, weekStart, anchor);
  if (range?.endKey && key > keyOf(range.endKey)) key = keyOf(range.endKey);
  if (range?.startKey && key < keyOf(range.startKey)) key = keyOf(range.startKey);
  return key;
}

/**
 * 거래 탭의 분석 아이콘이 여는 보기의 처음 값. 거래 탭의 검색·묶는 단위·세는 방식과 그 줄의
 * 기간 열쇠다. 없으면 분석 탭이다 -- 빈 검색으로 오늘이 든 기간에서 연다.
 */
export interface AnalysisInitial {
  search: TransactionSearch;
  unit: EntryPeriodUnit;
  basis: EntryBasis;
  periodKey: string;
}

export function useAnalysis(
  projectId: string | null,
  { initial }: { initial?: AnalysisInitial } = {},
) {
  const timeZone = useProjectTimeZone();
  const tx = useTransactions(projectId, { periodsOnly: true, initial });
  const { grouping, range, months, isLoadingMonths } = tx;

  /*
   * 검색 기간의 열쇠. 양끝을 다 정했으면 목록을 기다리지 않고 바로 만든다 -- 목록은 조건을
   * 바꿀 때마다 잠시 비어, 그 사이 오늘의 기간으로 한 번 그렸다가 되돌아가게 된다. 한쪽이
   * 열려 있으면 그 끝은 걸린 거래가 정하므로 목록이 합친 줄의 열쇠를 쓴다.
   */
  const rangeKey = range
    ? range.startKey && range.endKey
      ? rangePeriodKey(range.startKey, range.endKey)
      : grouping.rangeKey
    : null;
  /** 기간이 열려 있고 목록을 기다리는 중이면 아직 볼 기간을 정할 수 없다. */
  const isPeriodPending = range !== null && rangeKey === null && isLoadingMonths;

  /*
   * 사용자가 옮긴 기간. 그때의 끊는 규칙과 함께 적어 둔다 -- 규칙이 바뀌면 그 열쇠는 새
   * 규칙의 것이 아니라 버리고 오늘에서 다시 연다.
   */
  const basis = JSON.stringify([grouping.unit, grouping.weekStart, grouping.anchor, range, rangeKey]);
  /*
   * 거래 탭에서 열었으면 그 줄의 기간을 첫 그림의 규칙과 함께 적어 둔다. 검색·단위가 처음부터
   * 거래 탭의 것이라(`useTransactions` 의 initial) 규칙도 거래 탭의 것과 같다. 끝이 열린 검색
   * 기간이면 목록이 와서 규칙이 바뀌는데, 그때 서는 기간 줄의 열쇠가 곧 그 줄의 열쇠다.
   */
  const [chosen, setChosen] = useState<{ basis: string; key: string } | null>(() =>
    initial ? { basis, key: initial.periodKey } : null,
  );
  const periodKey =
    chosen && chosen.basis === basis
      ? chosen.key
      : defaultPeriodKey(grouping, rangeKey, range, timeZone);
  const setPeriodKey = (key: string) => setChosen({ basis, key });

  const [kind, setKind] = useState<AnalysisKind>(() =>
    initial ? initialKindOf(initial.search) : 'net',
  );

  const { search, unit, basis: countBasis, setSearch, changeUnit, setBasis } = tx;
  /** 지금 보기를 한 벌로 뜬다. */
  const snapshot = (): AnalysisSnapshot => ({
    search,
    unit,
    basis: countBasis,
    kind,
    periodKey,
    periodBasis: basis,
  });
  /**
   * 뜬 보기를 되살린다. 기간은 그때의 끊는 규칙과 함께 적어 둔다 -- 검색·단위가 다음 그림에서
   * 같은 규칙을 만들면 그 기간이 서고, 목록을 기다리는 동안 잠시 다르면 오늘이 섰다가 돌아온다.
   */
  const restore = useCallback(
    (saved: AnalysisSnapshot) => {
      setSearch(saved.search);
      changeUnit(saved.unit);
      setBasis(saved.basis);
      setKind(saved.kind);
      setChosen({ basis: saved.periodBasis, key: saved.periodKey });
    },
    [setSearch, changeUnit, setBasis],
  );

  /*
   * 그 기간의 금액. 거래 탭의 기간 줄과 같은 값이다. 목록에 없는 기간은 걸린 거래가 없는 기간이라
   * 0 이다. 목록이 오는 중이면 null -- 0 을 적으면 "이 달은 쓴 것이 없다"로 읽힌다.
   */
  const totals = useMemo<AnalysisTotals | null>(() => {
    if (isLoadingMonths || isPeriodPending) return null;
    const row = months.find((month) => month.yearMonth === periodKey);
    const income = toNumber(row?.income);
    const expense = toNumber(row?.expense);
    return { income, expense, net: income - expense };
  }, [isLoadingMonths, isPeriodPending, months, periodKey]);

  const period = useMemo(() => analysisPeriodOf(periodKey, range), [periodKey, range]);
  const trendClip = useMemo(() => trendClipOf(range, timeZone), [range, timeZone]);

  return {
    /** 검색·알약·단위·세는 방식·고를 목록. 거래 탭과 같은 것이다. */
    tx,
    kind,
    setKind,
    snapshot,
    restore,
    totals,
    /** 보는 기간의 열쇠. 해 "2026", 달 "2026-09", 주 "2026-09-13", 기간 "A~B". */
    periodKey,
    setPeriodKey,
    /** 같은 단위로 delta 칸 옮긴다. */
    shift: (delta: number) => setPeriodKey(shiftPeriodKey(periodKey, delta)),
    /** 보는 기간의 갈래. 직접 정한 기간('range')은 옮길 앞뒤가 없다. */
    unit: unitOfKey(periodKey),
    /** 달 고르기가 있는 머리를 쓸 수 있는가. 달력의 달일 때만이다. */
    isCalendarMonth: isCalendarMonthKey(periodKey),
    label: periodLabel(periodKey),
    isPeriodPending,
    /** 분석 구간. 검색 기간 밖이면 null 이다. */
    period,
    trendClip,
    /** 추이 막대의 마지막 기간. 막대가 이 단위로 선다. */
    trendPeriod: periodKey,
    /** 분석 조회에 싣는 조건 (사람 + 검색 + 세는 방식). 거래 목록과 같은 것이다. */
    filter: tx.scope,
  };
}
