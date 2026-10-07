import { installmentEntryViews, parseEntryBasis, type EntryDto, type EntryListItem } from '@money/types';

import { homeDataPort } from '../data/home-port';
import { dayRangeQuery, formatMonthShort, shiftYearMonth } from '../lib/datetime';
import {
  analysisDated,
  buildDailyCumulative,
  monthDateKeys,
  type CumulativeSeries,
} from './entries';

/**
 * 앞선 달을 몇 개나 겹쳐 그릴지.
 *
 * 지난달 하나만 겹치면 그 달이 유난했던 것인지 알 수 없다. 홈의 지출 그래프와
 * 같은 수다.
 */
const COMPARE_MONTHS = 2;

/**
 * 분석 구간([startDate, endDate))의 거래를 조회 조건의 세는 방식대로 받는다.
 *
 * 목록 질의는 전표의 날짜로 자르고 basis 를 보지 않는다. 회차 기준이면 그대로 쌓을 때
 * 할부가 산 날에 전액으로 서고, 앞서 산 할부의 이 구간 회차는 빠진다 -- 같은 화면의 추이
 * 막대(리포트, 회차 기준)와 어긋난다. 그래서 거래 화면·가계 화면처럼 앞서 산 할부를
 * 따로 받아 합치고 구간에 서는 회차만 남긴다 (`installmentEntryViews`).
 *
 * 발생 기준이면 그 한 벌을 받지 않는다. 산 날에 전액을 세는 규칙이라 옮길 것이 없다.
 */
export async function loadEntriesByBasis(
  query: EntryDto.ListQuery & { startDate: string; endDate: string },
  projectId: string | null | undefined,
  timeZone: string,
): Promise<EntryListItem[]> {
  const port = homeDataPort();
  // 창구를 거친다. 앱에서는 사본이 답하므로 오프라인에서도 그려진다.
  if (parseEntryBasis(query.basis) !== 'installment') {
    return ((await port.getAllEntries(query, projectId)) ?? []) as EntryListItem[];
  }
  const [own, past] = await Promise.all([
    port.getAllEntries(query, projectId),
    port.getInstallmentRows(query, projectId),
  ]);
  const rows = [...((own ?? []) as EntryListItem[]), ...((past ?? []) as EntryListItem[])];
  return installmentEntryViews(rows, { timeZone, from: query.startDate, to: query.endDate });
}

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
  /** 무엇을 쌓을지. 이번 달 선과 같은 값이어야 한다. */
  type: 'income' | 'expense' = 'expense',
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
      // 이번 달 선과 같은 세는 방식으로 받는다. 회차 기준이면 할부를 그 달의 회차로 옮긴다.
      const rows = await loadEntriesByBasis({ ...query, startDate, endDate }, projectId, timeZone);

      // 분석 기준으로 받았으면 페이백도 원거래 날짜로 쌓는다. 이번 달 선과 같은 규칙이다.
      const counted = query.dateBasis === 'analysis' ? analysisDated(rows) : rows;
      return {
        name: formatMonthShort(Number(month.slice(5))),
        // 앞선 달도 이번 달과 같은 몫을 세야 선끼리 견줄 수 있다.
        points: buildDailyCumulative(counted, startKey, endKey, timeZone, type),
      };
    }),
  );
}
