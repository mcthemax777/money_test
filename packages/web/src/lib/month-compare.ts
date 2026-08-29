import type { EntryDto } from '@money/types';

import { apiClient } from '@/lib/api-client';
import type { EntryListItem } from '@/components/TransactionItem';
import { dayRangeQuery, shiftYearMonth } from '@/lib/datetime';
import { buildDailyCumulative, monthDateKeys } from '@/lib/entries';
import type { CumulativeSeries } from '@/components/DailyCumulativeChart';

/**
 * 앞선 달을 몇 개나 겹쳐 그릴지.
 *
 * 지난달 하나만 겹치면 그 달이 유난했던 것인지 알 수 없다. 홈의 지출 그래프와
 * 같은 수다.
 */
const COMPARE_MONTHS = 2;

/**
 * 보고 있는 달의 앞선 두 달을 같은 조건으로 받아 일별 누적으로 만든다.
 *
 * 서버에는 분류별·수단별 "날짜별 합계"가 없다(/reports/daily-expense는 전체 지출
 * 하나뿐이다). 그래서 이 달을 그릴 때와 똑같이 거래를 받아 화면에서 쌓는다.
 * 조건이 하나라도 달라지면 이번 달 선과 견줄 수 없는 선이 그려지므로, 부르는 쪽이
 * 쓰던 조회 조건(query)을 날짜만 바꿔 그대로 다시 쓴다.
 *
 * 오래된 달부터 돌려준다(전전달, 지난달).
 */
export async function loadPreviousMonths(
  yearMonth: string,
  query: EntryDto.ListQuery,
  projectId: string | null | undefined,
  timeZone: string,
): Promise<CumulativeSeries[]> {
  const months = Array.from({ length: COMPARE_MONTHS }, (_, index) =>
    shiftYearMonth(yearMonth, -(COMPARE_MONTHS - index)),
  );

  return Promise.all(
    months.map(async (month) => {
      const { startKey, endKey } = monthDateKeys(
        Number(month.slice(0, 4)),
        Number(month.slice(5, 7)),
      );
      const { startDate, endDate } = dayRangeQuery(startKey, endKey, timeZone);
      const rows = (await apiClient.getAllEntries(
        { ...query, startDate, endDate },
        projectId,
      )) as EntryListItem[];

      return {
        name: `${Number(month.slice(5))}월`,
        points: buildDailyCumulative(rows ?? [], startKey, endKey, timeZone),
      };
    }),
  );
}
