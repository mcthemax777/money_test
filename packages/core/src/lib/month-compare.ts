import {
  installmentEntryViews,
  parseEntryBasis,
  periodDayRange,
  shiftPeriodKey,
  unitOfKey,
  type EntryDto,
  type EntryListItem,
} from '@money/types';

import { homeDataPort } from '../data/home-port';
import { dayRangeQuery, formatMonthShort, formatYearOnly, todayKey } from '../lib/datetime';
import { analysisDated, buildDailyCumulative, type CumulativeSeries } from './entries';

/**
 * 앞선 기간을 몇 개나 겹쳐 그릴지.
 *
 * 지난 기간 하나만 겹치면 그 기간이 유난했던 것인지 알 수 없다. 홈의 지출 그래프와
 * 같은 수다.
 */
const COMPARE_PERIODS = 2;

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
 * 기간 열쇠의 짧은 이름. 추이 막대 밑과 일별 누적 선의 범례가 같은 이름을 쓴다.
 *
 *   달 "8월", 주 "9/13"(그 주의 첫날), 해 "2026년"
 *
 * 시작일을 붙인 달("2026-08@14")은 시작하는 날 "8/14" 로, 시작 월을 붙인 해("2026@03")는
 * 시작하는 해로 적는다. 막대 밑은 좁아 구간 전체를 적을 자리가 없다.
 */
export function periodShortName(key: string): string {
  const unit = unitOfKey(key);
  const [base, anchor] = key.split('@');
  if (unit === 'year') return formatYearOnly(Number(base));
  const [, month, day] = base.split('-').map(Number);
  if (unit === 'month' && anchor) {
    // 그 달에 시작일이 없으면 말일에 시작한다. 실제로 시작하는 날을 적는다.
    const [, startMonth, startDay] = periodDayRange(key).startKey.split('-').map(Number);
    return `${startMonth}/${startDay}`;
  }
  if (unit === 'month') return formatMonthShort(month);
  return `${month}/${day}`;
}

/**
 * 앞선 기간을 겹쳐 그릴 수 있는 열쇠. 없으면 null 이다.
 *
 * 달력의 달(`{ yearMonth }`)은 그 달이다. 날짜 구간이면 그 구간이 추이 막대의 기간
 * (`trendPeriod` -- 주, 해, 시작일을 붙인 달) **한 칸과 꼭 같을 때만** 그 열쇠다. 검색 기간에
 * 걸려 반만 보는 기간이나 직접 정한 기간은 앞선 기간이 무엇인지 정해지지 않는다 -- 열흘짜리
 * 구간의 "지난 기간"이 한 달인지 같은 열흘인지 알 수 없다.
 */
export function comparablePeriodKey(
  period: { yearMonth?: string; startDate?: string; endDate?: string },
  trendPeriod?: string,
): string | null {
  if (period.yearMonth) return period.yearMonth;
  if (!trendPeriod || unitOfKey(trendPeriod) === 'range') return null;
  const whole = periodDayRange(trendPeriod);
  return whole.startKey === period.startDate && whole.endKey === period.endDate ? trendPeriod : null;
}

/**
 * 그 기간의 선을 며칠째까지 그을지. 오늘이 든 기간이면 오늘까지, 지난 기간이면 끝까지,
 * 아직 오지 않은 기간이면 0 이다. 달력의 달이면 `throughDayOf` 와 같은 값이다.
 */
export function throughDayOfPeriod(periodKey: string, timeZone: string): number {
  const { startKey, endKey } = periodDayRange(periodKey);
  const today = todayKey(timeZone);
  if (today < startKey) return 0;
  const until = today > endKey ? endKey : today;
  // 달력 날짜끼리만 센다. 타임존은 오늘을 정할 때 이미 반영했다.
  const dayOf = (key: string) => {
    const [year, month, day] = key.split('-').map(Number);
    return Date.UTC(year, month - 1, day) / 86_400_000;
  };
  return dayOf(until) - dayOf(startKey) + 1;
}

/**
 * 보고 있는 기간의 앞선 두 기간을 같은 조건으로 받아 일별 누적으로 만든다.
 *
 * 달력의 달이면 앞선 두 달이고, 주·해·시작일을 붙인 달이면 같은 단위로 앞선 두 칸이다
 * (`shiftPeriodKey`, 2026-10-08 사용자 요청 -- 묶는 단위가 있으면 달처럼 견준다). 선은
 * 기간 첫날부터 n 일째로 겹친다(`buildCumulativeRows`).
 *
 * 서버에는 분류별·수단별 "날짜별 합계"가 없다(/reports/daily-expense는 전체 지출
 * 하나뿐이다). 그래서 이 기간을 그릴 때와 똑같이 거래를 받아 화면에서 쌓는다.
 * 조건이 하나라도 달라지면 이번 기간 선과 견줄 수 없는 선이 그려지므로, 부르는 쪽이
 * 쓰던 조회 조건(query)을 날짜만 바꿔 그대로 다시 쓴다.
 *
 * 오래된 기간부터 돌려준다(전전, 전).
 */
export async function loadPreviousPeriods(
  periodKey: string,
  query: EntryDto.ListQuery,
  projectId: string | null | undefined,
  timeZone: string,
  /** 무엇을 쌓을지. 이번 기간 선과 같은 값이어야 한다. */
  type: 'income' | 'expense' = 'expense',
): Promise<CumulativeSeries[]> {
  // 직접 정한 기간은 옮길 차례가 없다 (`shiftPeriodKey` 가 그대로 돌려준다).
  if (unitOfKey(periodKey) === 'range') return [];
  const keys = Array.from({ length: COMPARE_PERIODS }, (_, index) =>
    shiftPeriodKey(periodKey, -(COMPARE_PERIODS - index)),
  );

  return Promise.all(
    keys.map(async (key) => {
      const { startKey, endKey } = periodDayRange(key);
      const { startDate, endDate } = dayRangeQuery(startKey, endKey, timeZone);
      // 이번 기간 선과 같은 세는 방식으로 받는다. 회차 기준이면 할부를 그 기간의 회차로 옮긴다.
      const rows = await loadEntriesByBasis({ ...query, startDate, endDate }, projectId, timeZone);

      // 분석 기준으로 받았으면 페이백도 원거래 날짜로 쌓는다. 이번 기간 선과 같은 규칙이다.
      const counted = query.dateBasis === 'analysis' ? analysisDated(rows) : rows;
      return {
        name: periodShortName(key),
        // 앞선 기간도 이번 기간과 같은 몫을 세야 선끼리 견줄 수 있다.
        points: buildDailyCumulative(counted, startKey, endKey, timeZone, type),
      };
    }),
  );
}
