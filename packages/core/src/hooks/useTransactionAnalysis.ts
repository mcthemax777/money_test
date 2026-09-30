import { useMemo, useState } from 'react';
import type { EntryScopeQuery } from '@money/types';

import type { ReportPeriod } from '../lib/api-client';
import { currentYearMonth, dayRangeQuery } from '../lib/datetime';
import { monthDateKeys } from '../lib/entries';
import { useProjectTimeZone } from '../store/project';
import { totalIdOf } from './useCategoryDetail';
import type { SearchRange, TransactionSearch } from './useTransactions';

/**
 * 거래 화면의 분석 창. 목록과 **같은 조건**(사람 필터 + 검색 + 세는 방식)으로 그래프를 그린다.
 *
 * 그리는 일은 가계 분류별의 상세와 같은 것을 쓴다 (`useCategoryDetail` 의 전체 지출·수입).
 * 여기서 정하는 것은 셋이다.
 *
 *   1. **보는 달.** 창 안에서 옮긴다. 거래 목록은 모든 달을 늘어놓지만, 일별 누적과 요일·시간대
 *      그래프는 한 구간이어야 뜻이 있다.
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
}: {
  search: TransactionSearch;
  range: SearchRange | null;
  scope: EntryScopeQuery;
}) {
  const timeZone = useProjectTimeZone();

  /*
   * 처음 여는 달. 이번 달을 검색 기간 안으로 당긴다 -- 기간이 지난 일이면 그 끝 달, 앞날이면
   * 그 첫 달이다. 기간 밖의 달로 열면 빈 창부터 보게 된다.
   */
  const [yearMonth, setYearMonth] = useState(() => {
    const today = currentYearMonth(timeZone);
    let month = `${today.year}-${String(today.month).padStart(2, '0')}`;
    const endMonth = range?.endKey?.slice(0, 7);
    const startMonth = range?.startKey?.slice(0, 7);
    if (endMonth && month > endMonth) month = endMonth;
    if (startMonth && month < startMonth) month = startMonth;
    return month;
  });

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
    const [year, month] = yearMonth.split('-').map(Number);
    const whole = monthDateKeys(year, month);
    if (!range) return { yearMonth };

    const startKey =
      range.startKey && range.startKey > whole.startKey ? range.startKey : whole.startKey;
    const endKey = range.endKey && range.endKey < whole.endKey ? range.endKey : whole.endKey;
    if (startKey > endKey) return null;
    if (startKey === whole.startKey && endKey === whole.endKey) return { yearMonth };
    return { startDate: startKey, endDate: endKey };
  }, [yearMonth, range]);

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
    yearMonth,
    setYearMonth,
    type,
    setType,
    /** 분석 대상. 그 유형 전체다 -- 좁히는 일은 filter(검색)가 한다. */
    categoryId: totalIdOf(type),
    period,
    trendClip,
    filter: scope,
  };
}
