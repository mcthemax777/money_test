import { useMemo, useState } from 'react';
import {
  isCalendarMonthKey,
  periodDayRange,
  shiftPeriodKey,
  unitOfKey,
  type EntryScopeQuery,
} from '@money/types';

import type { ReportPeriod } from '../lib/api-client';
import { dayRangeQuery, periodLabel } from '../lib/datetime';
import { useProjectTimeZone } from '../store/project';
import { totalIdOf } from './useCategoryDetail';
import type { SearchRange, TransactionSearch } from './useTransactions';

/**
 * 거래 화면의 분석 창. 목록과 **같은 조건**(사람 필터 + 검색 + 세는 방식)으로 그래프를 그린다.
 *
 * 그리는 일은 가계 분류별의 상세와 같은 것을 쓴다 (`useCategoryDetail` 의 전체 지출·수입).
 * 여기서 정하는 것은 셋이다.
 *
 *   1. **보는 기간.** 해·달·주 중 하나이고, 창 안에서 같은 단위로 옮긴다. 거래 목록은 모든
 *      기간을 늘어놓지만, 일별 누적과 요일·시간대 그래프는 한 구간이어야 뜻이 있다. 년월 줄의
 *      분석 아이콘이 그 줄의 기간으로 연다. 추이 막대도 그 단위로 선다 (`trendPeriod`).
 *   2. **지출·수입.** 검색이 수입만 골랐으면 수입부터 연다.
 *   3. **검색 기간으로 자르기.** 기간을 걸었으면 보는 달을 그 기간과 겹치는 날로만 줄이고,
 *      12개월 추이도 그 기간 밖의 돈은 세지 않는다. 겹치는 날이 없는 달은 비어 있다고 알린다.
 *
 * 웹과 앱이 같은 규칙을 쓰도록 여기 둔다.
 */
export function useTransactionAnalysis({
  search,
  range,
  scope,
  initialKey,
}: {
  search: TransactionSearch;
  range: SearchRange | null;
  scope: EntryScopeQuery;
  /** 처음 여는 기간. 분석은 년월 줄의 아이콘으로만 열리고, 그 줄의 기간 열쇠가 온다. */
  initialKey: string;
}) {
  const timeZone = useProjectTimeZone();

  /* 보는 기간. 창 안의 앞뒤 단추가 같은 단위로 옮긴다. */
  const [periodKey, setPeriodKey] = useState(initialKey);

  /* 수입만 골랐으면 수입부터. 그 밖(지출을 골랐거나 유형을 거르지 않았으면)은 지출이다. */
  const [type, setType] = useState<'income' | 'expense'>(() =>
    search.kinds.length > 0 && search.kinds.every((kind) => kind === 'income')
      ? 'income'
      : 'expense',
  );

  /**
   * 보는 구간. 달이 통째로 기간 안이면 달 이름으로(앞선 두 달 겹쳐 그리기가 선다), 반만
   * 걸치면 겹치는 날로, 전혀 겹치지 않으면 null 이다.
   */
  const period = useMemo<ReportPeriod | null>(() => {
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
  }, [periodKey, range]);

  /** 12개월 추이를 자를 구간 (ISO). 끝은 그다음 날 0시다 -- 서버가 [from, to) 로 읽는다. */
  const trendClip = useMemo(() => {
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
  }, [range, timeZone]);

  return {
    /** 보는 기간의 열쇠. 해 "2026", 달 "2026-09", 주 "2026-09-13". */
    periodKey,
    setPeriodKey,
    /** 같은 단위로 delta 칸 옮긴다. */
    shift: (delta: number) => setPeriodKey((key) => shiftPeriodKey(key, delta)),
    /** 보는 기간의 갈래(해·달·주·직접 정한 기간). 열쇠의 생김새가 정한다. */
    unit: unitOfKey(periodKey),
    /** 달 고르기가 있는 머리를 쓸 수 있는가. 달력의 달일 때만이다. */
    isCalendarMonth: isCalendarMonthKey(periodKey),
    /** 보는 기간의 이름 ("2026년", "2026년 9월", "2026년 9월 2주"). */
    label: periodLabel(periodKey),
    /** 추이 막대의 마지막 기간. 막대가 이 단위로 선다. */
    trendPeriod: periodKey,
    type,
    setType,
    /** 분석 대상. 그 유형 전체다 -- 좁히는 일은 filter(검색)가 한다. */
    categoryId: totalIdOf(type),
    period,
    trendClip,
    filter: scope,
  };
}
