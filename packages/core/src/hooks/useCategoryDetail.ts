/**
 * 분류 하나(또는 그 유형 전체)의 상세.
 *
 * 웹의 가계 > 분류별 오른쪽 패널과 앱의 분류 상세 화면이 함께 쓴다. 받아 오는 것은
 * 넷이다 -- 구성비 조각(원형차트), 12개월 추이, 일별 누적, 그 구간의 거래 목록.
 * 요일별·시간대별 평균과 수단별 합계는 그 거래 목록에서 센다 (`usage-pattern.ts`).
 *
 * 두 화면이 같은 값을 보게 하려고 여기에 두었다. 조회 조건이 조금이라도 갈라지면
 * 웹과 앱이 같은 분류를 눌렀는데 다른 금액을 말하게 된다. 그리는 일(원형·막대·선)만
 * 각자 맡는다 -- 웹은 recharts, 앱은 react-native-svg 라 컴포넌트를 나눌 수 없다.
 */
import { useEffect, useMemo, useState } from 'react';
import type { EntryDto, EntryFilterQuery, EntryListItem } from '@money/types';

import { useMirrorVersion } from './useMirrorVersion';
import { homeDataPort } from '../data/home-port';
import { apiClient, type ReportPeriod } from '../lib/api-client';
import { dayRangeQuery, formatMonthShort, throughDayOf, todayKey } from '../lib/datetime';
import {
  buildDailyCumulative,
  monthDateKeys,
  type CumulativeSeries,
  type DailyCumulativePoint,
} from '../lib/entries';
import { activeLocale, translate, type MessageKey } from '../lib/i18n';
import { toNumber } from '../lib/money';
import { loadPreviousMonths } from '../lib/month-compare';
import { isOfflineError } from '../lib/offline-error';
import type { Category } from '../lib/types';
import { buildUsagePattern, type BarPoint, type UsagePattern } from '../lib/usage-pattern';
import { useProjectTimeZone } from '../store/project';
import { useWeekStart } from '../store/week-start';

/** 합계를 가리키는 가짜 분류 id. 실제 분류 id 와 섞이지 않는 값이다. */
export const TOTAL_EXPENSE_ID = 'total-expense';
export const TOTAL_INCOME_ID = 'total-income';

/** 그 유형 전체를 가리키는 id. 지출·수입 탭이 각자의 합계를 고를 때 쓴다. */
export function totalIdOf(type: 'income' | 'expense'): string {
  return type === 'expense' ? TOTAL_EXPENSE_ID : TOTAL_INCOME_ID;
}

/**
 * 그래프 제목과 안내 문구. 수입 분류는 "사용금액" 대신 "수입금액"으로 적는다.
 * 웹과 앱이 같은 말을 고르도록 여기서 정한다.
 */
export interface DetailLabels {
  monthly: MessageKey;
  /** 12개월 막대 툴팁의 이름 */
  amount: MessageKey;
  noYear: MessageKey;
  daily: MessageKey;
  /** 일별 누적 툴팁의 이름 */
  cumulative: MessageKey;
  /** 이 구간에 센 것이 없을 때. 일별 누적과 요일·시간대·수단이 함께 쓴다. */
  noPeriod: MessageKey;
  weekday: MessageKey;
  hour: MessageKey;
  method: MessageKey;
}

const DETAIL_LABELS: Record<'income' | 'expense', DetailLabels> = {
  expense: {
    monthly: 'detail.monthlyUsage',
    amount: 'detail.usage',
    noYear: 'detail.noYearUsage',
    daily: 'detail.dailyCumulative',
    cumulative: 'detail.cumulativeUsage',
    noPeriod: 'detail.noMonthUsage',
    weekday: 'detail.weekdayAverage',
    hour: 'detail.hourAverage',
    method: 'detail.methodUsage',
  },
  income: {
    monthly: 'detail.monthlyIncome',
    amount: 'detail.income',
    noYear: 'detail.noYearIncome',
    daily: 'detail.dailyCumulativeIncome',
    cumulative: 'detail.cumulativeIncome',
    noPeriod: 'detail.noMonthIncome',
    weekday: 'detail.weekdayAverageIncome',
    hour: 'detail.hourAverageIncome',
    method: 'detail.methodIncome',
  },
};

/** 원형차트 조각 하나 */
export interface CategorySlice {
  name: string;
  value: number;
  /** 소분류를 가진 대분류만 갖는다. 이 값이 없으면 더 파고들 수 없는 조각이다. */
  id?: string;
}

/** 12개월 추이의 한 점. label 은 "8월"이다. 요일·시간대 막대와 같은 모양이다. */
export type MonthlyPoint = BarPoint;

interface BreakdownRow {
  categoryId: string;
  categoryName: string;
  parentCategoryId: string | null;
  amount: string;
}

/**
 * 대분류 하나의 구성비 조각을 만든다.
 *
 * 소분류 행과 함께, 소분류 없이 그 대분류에 바로 기록된 금액을 '미분류'로 넣는다.
 * 이것을 빼면 조각 합계가 위에 보이는 사용액보다 적어져서 돈이 사라진 것처럼 보인다.
 * '미분류'에는 id를 주지 않는다. 실제 분류가 아니므로 눌러도 내려갈 곳이 없다.
 *
 * 소분류가 아예 없는 대분류는 빈 배열을 준다. '미분류' 한 조각만 100%로 그리면
 * 쪼개 보여 주는 것이 없으면서 분류가 빠진 듯한 오해만 준다. 이때는 원형차트를 걸러야 한다.
 */
export function buildSubcategoryStats(rows: BreakdownRow[], parentId: string): CategorySlice[] {
  const stats: CategorySlice[] = rows
    .filter((item) => item.parentCategoryId === parentId)
    .map((item) => ({ id: item.categoryId, name: item.categoryName, value: toNumber(item.amount) }));

  if (stats.length === 0) return [];

  const direct = rows.find((item) => item.categoryId === parentId);
  const directAmount = direct ? toNumber(direct.amount) : 0;
  if (directAmount > 0) {
    // 훅 밖의 순수 함수라 지금 언어를 직접 읽는다.
    stats.push({ name: translate(activeLocale(), 'category.uncategorized'), value: directAmount });
  }

  return stats.sort((a, b) => b.value - a.value);
}

/**
 * categoryId 가 무엇을 가리키는지.
 *
 * 'total-expense'/'total-income' 은 그 유형 전체, 그 외는 실제 분류다. 소분류와
 * "미분류"는 더 쪼갤 것이 없어 원형차트를 그리지 않는다(isLeaf).
 */
function resolveTarget(categoryId: string, categories: Category[], exactCategory: boolean) {
  if (categoryId === TOTAL_EXPENSE_ID) {
    return { scope: 'total' as const, type: 'expense' as const, isLeaf: false };
  }
  if (categoryId === TOTAL_INCOME_ID) {
    return { scope: 'total' as const, type: 'income' as const, isLeaf: false };
  }

  const category = categories.find((item) => item.id === categoryId);
  return {
    scope: 'category' as const,
    type: (category?.type ?? 'expense') as 'income' | 'expense',
    isLeaf: Boolean(category?.parentId) || exactCategory,
  };
}

export interface CategoryDetailInput {
  /** 실제 분류 id, 또는 'total-expense'/'total-income'. 비우면 아무것도 받지 않는다. */
  categoryId: string;
  /** 대분류·소분류 판별에 쓴다. */
  categories: Category[];
  /** 볼 구간. 한 달(`{ yearMonth }`)이거나 임의 기간(`{ startDate, endDate }`)이다. */
  period: ReportPeriod;
  /** categoryId 를 그 분류로만 본다(소분류 제외). 목록의 "미분류"를 눌렀을 때 켠다. */
  exactCategory?: boolean;
  projectId?: string | null;
  /** 가계 화면의 사람 필터. 위쪽 합계와 같은 조건을 써야 한다. */
  filter?: EntryFilterQuery;
  /** 값이 바뀌면 다시 받는다. 부모 화면에서 거래를 고쳤을 때 쓴다. */
  reloadToken?: number;
  /** 꺼져 있으면 받지 않는다. 닫힌 팝업이 쓴다. */
  enabled?: boolean;
}

export interface CategoryDetail {
  isLoading: boolean;
  /** 보고 있는 분류의 유형에 맞춘 제목과 안내 문구 */
  labels: DetailLabels;
  /** 12개월 추이 */
  monthly: MonthlyPoint[];
  /** 이 구간의 일별 누적 */
  daily: DailyCumulativePoint[];
  /** 겹쳐 그릴 앞선 두 달. 달 단위로 볼 때만 찬다. */
  comparisons: CumulativeSeries[];
  /** 이 구간의 거래. 일별 누적과 같은 조회에서 온다. */
  entries: EntryListItem[];
  /** 요일별·시간대별 하루 평균과 수단별 합계. 위 거래 목록에서 센다. */
  pattern: UsagePattern;
  /** 이 구간에 센 금액이 있는지. 없으면 세 그래프 자리에 안내를 적는다. */
  hasPatternAmount: boolean;
  /** 지금 그릴 원형차트 조각. 파고든 상태면 그 대분류의 소분류들이다. */
  slices: CategorySlice[];
  /** 조각을 눌러 파고든 대분류. null 이면 첫 단계다. */
  drilledId: string | null;
  /** 조각을 눌러 한 단 내려간다. 소분류가 없는 조각은 아무 일도 하지 않는다. */
  drill: (categoryId: string) => void;
  /** 첫 단계로 되돌린다. */
  resetDrill: () => void;
  /** 이번 달 선에 붙일 이름("8월"). 달 단위로 볼 때만 있다. */
  currentMonthName?: string;
  /** 이번 달 선을 그 달의 며칠까지 그을지. 달 단위로 볼 때만 있다. */
  throughDay?: number;
  /** 12개월 중 한 달이라도 금액이 있는지. 없으면 그래프 대신 안내를 적는다. */
  hasMonthlyAmount: boolean;
  /** 이 달이나 앞선 달에 쌓인 것이 있는지. */
  hasDailyAmount: boolean;
  /**
   * 서버에서만 오는 값(12개월 추이·일별 누적·앞선 달·거래)을 받지 못했는가.
   * 원형차트는 사본에서도 나오므로 그것만 그려지고, 나머지 자리에 안내를 적는다.
   */
  isOffline: boolean;
}

export function useCategoryDetail({
  categoryId,
  categories,
  period,
  exactCategory = false,
  projectId,
  filter,
  reloadToken,
  enabled = true,
}: CategoryDetailInput): CategoryDetail {
  // 구간 경계와 "오늘까지"는 프로젝트 타임존 기준이다 (서버의 합계와 같은 규칙).
  const timeZone = useProjectTimeZone();
  // 남이 고친 거래도 이 상세에 들어와야 한다. reloadToken 은 이 화면의 편집만 센다.
  const mirrorVersion = useMirrorVersion();
  // 요일별 평균의 차례. 달력 머리글과 같은 요일에서 시작한다.
  const weekStart = useWeekStart();

  /*
   * 구간을 세 형태로 쓴다.
   *   dayKeys  : 일별 누적의 x축 (달력 날짜)
   *   endMonth : 12개월 추이의 마지막 달
   *   periodKey: 구간이 바뀌었는지 볼 값 (객체는 렌더마다 새로 만들어진다)
   */
  const dayKeys = period.yearMonth
    ? monthDateKeys(Number(period.yearMonth.slice(0, 4)), Number(period.yearMonth.slice(5, 7)))
    : { startKey: period.startDate!, endKey: period.endDate! };
  const endMonth = dayKeys.endKey.slice(0, 7);
  const periodKey = `${dayKeys.startKey}~${dayKeys.endKey}`;
  /* 객체는 렌더마다 새로 만들어진다. 의존성에는 값을 쓴다. */
  const filterKey = JSON.stringify(filter ?? {});

  const target = resolveTarget(categoryId, categories, exactCategory);

  const [isLoading, setIsLoading] = useState(false);
  const [monthly, setMonthly] = useState<MonthlyPoint[]>([]);
  const [daily, setDaily] = useState<DailyCumulativePoint[]>([]);
  const [comparisons, setComparisons] = useState<CumulativeSeries[]>([]);
  const [entries, setEntries] = useState<EntryListItem[]>([]);
  const [slices, setSlices] = useState<CategorySlice[]>([]);
  /** 대분류를 눌러 소분류로 내려갈 때 쓰는 평면 집계 (rollup=false) */
  const [flatBreakdown, setFlatBreakdown] = useState<BreakdownRow[]>([]);
  const [drilledId, setDrilledId] = useState<string | null>(null);
  const [drilledSlices, setDrilledSlices] = useState<CategorySlice[]>([]);
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    if (!enabled || !categoryId) return;

    let cancelled = false;
    // 대상이 바뀌면 파고든 자리는 의미가 없다. 남겨 두면 남의 소분류가 그려진다.
    setDrilledId(null);
    setDrilledSlices([]);
    setIsLoading(true);

    const load = async () => {
      /*
       * 서버에서만 오는 값은 닿지 못하면 비우고 표시만 남긴다.
       *
       * 하나가 실패했다고 전부 버리면 사본으로 그릴 수 있는 원형차트까지 사라진다.
       * 0원 그래프로 두면 "이 분류에 쓴 것이 없다"로 읽히므로 화면이 안내를 적는다.
       */
      let offline = false;
      const serverOnly = <T,>(promise: Promise<T>, empty: T): Promise<T> =>
        promise.catch((error) => {
          if (!isOfflineError(error)) throw error;
          offline = true;
          return empty;
        });

      try {
        // 구간 경계는 프로젝트 타임존 기준이다 (서버의 합계와 같은 규칙).
        const { startDate, endDate } = dayRangeQuery(dayKeys.startKey, dayKeys.endKey, timeZone);

        // 12개월 시계열은 서버가 계산한다.
        const trendPromise = serverOnly<unknown>(
          target.scope === 'total'
            ? apiClient.getTrend(
                'total',
                { type: target.type, endMonth, months: 12, ...filter },
                projectId,
              )
            : apiClient.getTrend(
                'category',
                { targetId: categoryId, endMonth, months: 12, exact: exactCategory, ...filter },
                projectId,
              ),
          [],
        );

        /*
         * 이 구간의 거래를 뽑는 조건. 날짜만 빼 둔다.
         *
         * 전체 지출은 kind='expense' 가 아니라 categoryType='expense' 로 뽑는다.
         * kind 로 걸면 수수료가 붙은 이체가 빠져서 12개월 그래프(수수료 포함)와
         * 어긋난다. 앞선 달을 겹쳐 그릴 때 날짜만 바꿔 이 조건을 그대로 다시 쓴다.
         */
        const entryQuery: EntryDto.ListQuery = {
          ...filter,
          ...(target.scope === 'category'
            ? { categoryId, ...(exactCategory ? { categoryExact: true } : {}) }
            : { categoryType: target.type }),
        };

        // 커서를 끝까지 따라간다. 한 페이지만 받으면 일별 누적이 12개월 그래프
        // (서버 집계, 전량)와 어긋난다.
        const entriesPromise = serverOnly<unknown>(
          apiClient.getAllEntries({ ...entryQuery, startDate, endDate }, projectId),
          [],
        );

        /*
         * 겹쳐 그릴 앞선 두 달.
         *
         * 기간을 직접 정했을 때는 받지 않는다. 열흘짜리 구간의 "지난달"이 한 달인지
         * 같은 열흘인지 정해지지 않아 견줄 대상이 없다.
         */
        const comparisonPromise = period.yearMonth
          ? serverOnly(loadPreviousMonths(period.yearMonth, entryQuery, projectId, timeZone, target.type), [])
          : Promise.resolve([] as CumulativeSeries[]);

        // 원형차트: 전체면 대분류별, 대분류를 보고 있으면 소분류별.
        // 파고들기(대분류 -> 소분류)에도 같은 평면 집계를 쓴다.
        // 창구를 거친다 -- 앱에서는 사본이 답하므로 오프라인에서도 그려진다.
        const port = homeDataPort();
        const flatPromise = target.isLeaf
          ? Promise.resolve([] as BreakdownRow[])
          : port.getCategoryBreakdown(period, target.type, projectId, {
              rollup: false,
              ...filter,
            });
        const breakdownPromise =
          target.scope === 'total'
            ? port.getCategoryBreakdown(period, target.type, projectId, { ...filter })
            : flatPromise;

        const [trendRes, entriesRes, breakdownRes, flatRes, comparisonRes] = await Promise.all([
          trendPromise,
          entriesPromise,
          breakdownPromise,
          flatPromise,
          comparisonPromise,
        ]);
        if (cancelled) return;

        setIsOffline(offline);
        setFlatBreakdown((flatRes ?? []) as BreakdownRow[]);

        const trend = (trendRes ?? []) as Array<{ yearMonth: string; amount: string }>;
        setMonthly(
          trend.map((point) => ({
            label: formatMonthShort(Number(point.yearMonth.split('-')[1])),
            amount: toNumber(point.amount),
          })),
        );

        const rows = (entriesRes ?? []) as EntryListItem[];
        setEntries(rows);
        // 일별 누적. 수입 분류는 수입을, 지출은 지출을 쌓는다 (이체는 수수료만).
        setDaily(
          buildDailyCumulative(rows, dayKeys.startKey, dayKeys.endKey, timeZone, target.type),
        );
        setComparisons(comparisonRes);

        const breakdown = (breakdownRes ?? []) as BreakdownRow[];
        setSlices(
          target.scope === 'category'
            ? buildSubcategoryStats(breakdown, categoryId)
            : breakdown.map((item) => ({
                id: item.categoryId,
                name: item.categoryName,
                value: toNumber(item.amount),
              })),
        );
      } catch (error) {
        console.error('분류별 상세 데이터를 불러오지 못했습니다:', error);
        if (cancelled) return;
        // 앞 구간의 값이 남아 있으면 틀린 숫자를 보게 되므로 비운다.
        setIsOffline(false);
        setMonthly([]);
        setDaily([]);
        setComparisons([]);
        setEntries([]);
        setSlices([]);
        setFlatBreakdown([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    categoryId,
    periodKey,
    exactCategory,
    projectId,
    timeZone,
    filterKey,
    reloadToken,
    mirrorVersion,
    // categories 배열 자체를 넣으면 부모가 새로 만들 때마다 다시 받는다. 판별 결과만 본다.
    target.scope,
    target.type,
    target.isLeaf,
  ]);

  /*
   * 거래 목록에서 세는 세 그래프. 목록이 바뀔 때만 다시 센다 -- 거래마다 타임존 변환을
   * 두 번 하므로 렌더마다 돌리기에는 무겁다. "오늘"은 날이 바뀌어도 목록을 다시 받을
   * 때 따라온다.
   */
  const pattern = useMemo(
    () =>
      buildUsagePattern({
        entries,
        type: target.type,
        startKey: dayKeys.startKey,
        endKey: dayKeys.endKey,
        todayKey: todayKey(timeZone),
        timeZone,
        weekStart,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, target.type, periodKey, timeZone, weekStart],
  );

  const drill = (id: string) => {
    // 서버가 이미 계산한 평면 집계를 쓴다. 대분류를 직접 볼 때와 같은 규칙이어야 한다.
    const next = buildSubcategoryStats(flatBreakdown, id);
    if (next.length === 0) return;

    setDrilledSlices(next);
    setDrilledId(id);
  };

  const resetDrill = () => {
    setDrilledId(null);
    setDrilledSlices([]);
  };

  return {
    isLoading,
    labels: DETAIL_LABELS[target.type],
    monthly,
    daily,
    comparisons,
    entries,
    pattern,
    hasPatternAmount: pattern.methods.length > 0,
    slices: drilledId ? drilledSlices : slices,
    drilledId,
    drill,
    resetDrill,
    /*
     * 달 단위로 볼 때만 쓰는 값. 이번 달 선의 이름과, 그 선을 며칠까지 그을지다.
     * 기간 보기에서는 견줄 달이 없어 둘 다 필요 없다.
     */
    currentMonthName: period.yearMonth
      ? formatMonthShort(Number(period.yearMonth.slice(5)))
      : undefined,
    throughDay: period.yearMonth ? throughDayOf(period.yearMonth, timeZone) : undefined,
    hasMonthlyAmount: monthly.some((point) => point.amount > 0),
    isOffline,
    /*
     * 이 달에 쓴 것이 없어도 앞선 달에 있으면 그린다. "지난달에는 여기에 이만큼
     * 썼는데 이번 달은 0"이 그림으로 보여야 한다.
     */
    hasDailyAmount:
      daily.some((point) => point.cumulative > 0) ||
      comparisons.some((series) => series.points.some((point) => point.cumulative > 0)),
  };
}
