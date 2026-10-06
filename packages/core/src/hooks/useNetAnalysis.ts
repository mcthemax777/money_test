/**
 * 분석 탭의 합계(순수입) 보기.
 *
 * 따로 조회를 만들지 않는다. 지출 탭과 수입 탭이 그리는 것(`useCategoryDetail` 의 전체 지출·
 * 전체 수입)을 같은 조건으로 둘 다 받아 합친다. 그래야 합계에 그린 지출 막대가 지출 탭의
 * 막대와, 수입 막대가 수입 탭의 막대와 같은 값이다 -- 따로 세면 세 탭이 서로 다른 말을 할
 * 틈이 생긴다.
 *
 * 합치는 것은 둘이다 (2026-10-06 사용자 요청으로 수입·지출 막대와 구성비 원형은 뺐다).
 *
 *   1. **일별 누적 순수입.** 날마다 쌓인 수입에서 쌓인 지출을 뺀다. 달로 보면 앞선 두 달도
 *      같은 방법으로 겹친다.
 *   2. **기간별 순수입.** 같은 기간 칸의 수입에서 지출을 뺀 막대다. 지출 탭의 월별 사용금액과
 *      같은 막대 그래프로 그리고, 적자인 기간은 0 아래로 내려간다.
 */
import { unitOfKey, type EntryPeriodUnit } from '@money/types';

import type { BarPoint } from '../lib/usage-pattern';

import type { DailyCumulativePoint, CumulativeSeries } from '../lib/entries';
import type { MessageKey } from '../lib/i18n';
import {
  TOTAL_EXPENSE_ID,
  TOTAL_INCOME_ID,
  useCategoryDetail,
  type CategoryDetailInput,
} from './useCategoryDetail';


/** 추이 제목과 빈 안내. 막대가 서는 단위를 따른다 (`useCategoryDetail` 의 TREND_BY_UNIT 과 같은 수). */
const TREND_LABELS: Record<EntryPeriodUnit, { title: MessageKey; empty: MessageKey }> = {
  month: { title: 'analysis.net.monthlyTrend', empty: 'analysis.net.noMonths' },
  week: { title: 'analysis.net.weeklyTrend', empty: 'analysis.net.noWeeks' },
  year: { title: 'analysis.net.yearlyTrend', empty: 'analysis.net.noYears' },
};

/** 같은 날짜끼리 수입 누적에서 지출 누적을 뺀다. 두 줄은 같은 날짜 칸으로 온다. */
function netPoints(
  income: DailyCumulativePoint[],
  expense: DailyCumulativePoint[],
): DailyCumulativePoint[] {
  const length = Math.max(income.length, expense.length);
  return Array.from({ length }, (_, index) => ({
    label: income[index]?.label ?? expense[index]?.label ?? '',
    amount: (income[index]?.amount ?? 0) - (expense[index]?.amount ?? 0),
    cumulative: (income[index]?.cumulative ?? 0) - (expense[index]?.cumulative ?? 0),
  }));
}

export interface NetAnalysis {
  isLoading: boolean;
  isOffline: boolean;
  /** 기간별 순수입. 마지막 칸이 보고 있는 기간이다. */
  trend: BarPoint[];
  trendTitle: MessageKey;
  trendEmpty: MessageKey;
  /** 추이에 수입이나 지출이 한 칸이라도 있는가. 없으면 그래프 대신 안내를 적는다. */
  hasTrend: boolean;
  daily: DailyCumulativePoint[];
  comparisons: CumulativeSeries[];
  currentMonthName?: string;
  throughDay?: number;
  /** 이 기간(이나 겹쳐 그릴 앞선 달)에 수입·지출이 하나라도 있는가. */
  hasDaily: boolean;
}

export function useNetAnalysis(input: Omit<CategoryDetailInput, 'categoryId'>): NetAnalysis {
  const expense = useCategoryDetail({ ...input, categoryId: TOTAL_EXPENSE_ID });
  const income = useCategoryDetail({ ...input, categoryId: TOTAL_INCOME_ID });

  /*
   * 두 추이는 같은 조건(끝 기간·칸 수·자르기)으로 받아 같은 칸에 같은 기간이 선다. 한쪽이
   * 아직 오지 않았거나(오프라인) 비었으면 그쪽은 0 으로 둔다.
   */
  const length = Math.max(expense.monthly.length, income.monthly.length);
  const trend: BarPoint[] = Array.from({ length }, (_, index) => ({
    label: expense.monthly[index]?.label ?? income.monthly[index]?.label ?? '',
    amount: (income.monthly[index]?.amount ?? 0) - (expense.monthly[index]?.amount ?? 0),
  }));

  const daily = netPoints(income.daily, expense.daily);
  /* 앞선 달도 같은 차례(전전달, 지난달)로 온다. 이름은 두 쪽이 같다. */
  const comparisons: CumulativeSeries[] = expense.comparisons.map((series, index) => ({
    name: series.name,
    points: netPoints(income.comparisons[index]?.points ?? [], series.points),
  }));

  const trendUnit = input.trendPeriod ? unitOfKey(input.trendPeriod) : 'month';
  const labels = TREND_LABELS[trendUnit === 'range' ? 'month' : trendUnit];

  return {
    isLoading: expense.isLoading || income.isLoading,
    isOffline: expense.isOffline || income.isOffline,
    trend,
    trendTitle: labels.title,
    trendEmpty: labels.empty,
    hasTrend: expense.hasMonthlyAmount || income.hasMonthlyAmount,
    daily,
    comparisons,
    currentMonthName: expense.currentMonthName,
    throughDay: expense.throughDay,
    hasDaily: expense.hasDailyAmount || income.hasDailyAmount,
  };
}
