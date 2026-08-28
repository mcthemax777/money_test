'use client';

import { useEffect, useMemo, useState } from 'react';
import type { BudgetDto, CardDto, EntryFilterQuery, ReportDto } from '@money/types';

import { apiClient } from '@/lib/api-client';
import { currentYearMonth, dateMarkerKey, shiftYearMonth, todayKey } from '@/lib/datetime';
import { sumNetWorth } from '@/lib/net-worth';
import type { Person } from '@/lib/types';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { usePersonFilterSync } from '@/hooks/usePersonFilterSync';
import { useProjectGuard } from '@/hooks/useProjectGuard';
import { useMyPersonId, useProjectTimeZone } from '@/store/project';
import { useUserFilter } from '@/store/user-filter';
import AssetHistoryChart from '@/components/AssetHistoryChart';
import AssetTypeSummary from '@/components/AssetTypeSummary';
import CategoryDonutChart from '@/components/CategoryDonutChart';
import CumulativeExpenseChart, {
  type ExpenseField,
} from '@/components/CumulativeExpenseChart';
import EntryFeed from '@/components/EntryFeed';
import MonthlyBudgetSummary from '@/components/MonthlyBudgetSummary';
import PageHeader from '@/components/PageHeader';
import PersonScopeTitle from '@/components/PersonScopeTitle';
import SpendingMethodCarousel, {
  type SpendingMethod,
} from '@/components/SpendingMethodCarousel';

/** 누적 지출 그래프 세 장. 넓은 쪽에서 좁은 쪽으로 늘어놓는다. */
const EXPENSE_CHARTS: Array<{ field: ExpenseField; title: string }> = [
  { field: 'total', title: '전체 지출' },
  { field: 'normal', title: '일반 지출' },
  { field: 'extra', title: '과소비' },
];

/** 카드 줄에 세우는 순서. 사용자가 말한 순서 그대로다. */
const METHOD_ORDER: Record<SpendingMethod['kind'], number> = {
  credit_card: 0,
  debit_card: 1,
};

/** `@db.Date` 값의 "8/16". 카드 앞면은 좁아서 연도까지 적을 자리가 없다. */
function shortMarker(marker: string): string {
  const key = dateMarkerKey(marker);
  return `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
}

/**
 * 카드가 세고 있는 구간 표시. 신용카드만 달력의 달과 어긋난다.
 *
 * 날짜만 적는다. 카드 앞면에서 위는 이번 구간, 아래는 직전 구간 자리로 이미 갈려 있어
 * "마감 기준"·"직전" 같은 말을 붙이면 좁은 자리를 두 번 쓰는 셈이다.
 */
function periodLabelOf(performance: CardDto.PerformanceResponse, previous: boolean): string {
  const start = previous ? performance.previousPeriodStart : performance.periodStart;
  const end = previous ? performance.previousPeriodEnd : performance.periodEnd;

  if (performance.basis === 'month') {
    return `${Number(dateMarkerKey(end).slice(5, 7))}월`;
  }
  return `${shortMarker(start)} ~ ${shortMarker(end)}`;
}

/**
 * 로그인하면 처음 보는 화면.
 *
 * 다른 화면에 들어가 봐야 알 수 있던 것들을 한 자리에 모은다. 자산이 얼마인지,
 * 실적 구간에 카드를 얼마나 썼는지, 이 달 예산을 얼마나 썼는지.
 *
 * 여기서 고치는 것은 없다. 숫자를 누르러 가는 화면은 가계와 자산이고, 홈은
 * 그 화면들을 열기 전에 훑는 자리다.
 */
export default function HomePage() {
  const selectedProjectId = useProjectGuard();
  const { selectedPersonIds, togglePersonId } = useUserFilter();
  const myPersonId = useMyPersonId();
  const timeZone = useProjectTimeZone();

  const [people, setPeople] = useState<Person[]>([]);
  /** 구성원 목록을 받아 봤는지. 아직이면 필터를 만들 수 없어 조회를 미룬다. */
  const [peopleLoaded, setPeopleLoaded] = useState(false);
  const [netWorth, setNetWorth] = useState<ReportDto.NetWorth | null>(null);
  const [methods, setMethods] = useState<SpendingMethod[]>([]);
  const [budgets, setBudgets] = useState<BudgetDto.MonthlyBudget[]>([]);
  const [dailyExpense, setDailyExpense] = useState<ReportDto.DailyExpensePoint[]>([]);
  const [previousDailyExpense, setPreviousDailyExpense] = useState<
    ReportDto.DailyExpensePoint[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // 이번 달 판단도 프로젝트 타임존 기준이다. 브라우저 로컬로 읽으면 자정 전후로 달이 밀린다.
  const today = todayKey(timeZone);
  const { year, month } = currentYearMonth(timeZone);
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  const previousYearMonth = shiftYearMonth(yearMonth, -1);

  useEffect(() => {
    if (!selectedProjectId) return;

    const loadReference = async () => {
      try {
        const peopleData = await apiClient.getPeople(selectedProjectId);
        // 저장된 자산주인 선택은 usePersonFilterSync 가 이 목록에 맞춘다.
        setPeople(peopleData || []);
        setPeopleLoaded(true);
      } catch (err) {
        console.error('구성원 조회 실패:', err);
        setError('데이터 조회에 실패했습니다.');
        setIsLoading(false);
      }
    };

    loadReference();
  }, [selectedProjectId]);

  usePersonFilterSync(selectedProjectId, people);

  const allPeopleSelected = people.length > 0 && selectedPersonIds.length === people.length;

  /**
   * 서버로 보내는 필터.
   *
   * 전부 고른 경우만 파라미터를 빼서 서버가 필터 없는 경로를 타게 하고(주인이 없는
   * 계좌까지 담긴다), 하나도 고르지 않았으면 빈 값을 보내 "결과 없음"을 뜻하게 한다.
   * 가계·자산 화면과 같은 세 상태 규칙이다.
   */
  const entryFilter = useMemo<EntryFilterQuery>(
    () => (allPeopleSelected ? {} : { personIds: selectedPersonIds.join(',') }),
    [allPeopleSelected, selectedPersonIds],
  );
  const appliedFilter = useDebouncedValue(entryFilter, 250);

  useEffect(() => {
    if (!selectedProjectId || !peopleLoaded) return;
    /*
     * 구성원이 없는 프로젝트.
     *
     * 저장된 선택은 아직 다른 프로젝트 것일 수 있고(usePersonFilterSync가 맞출 대상이
     * 없어 그대로 둔다), 그 선택으로 조회하면 남의 프로젝트 id로 거른 결과가 나온다.
     * 조회하지 않고 아래에서 구성원을 만들라고 안내한다.
     */
    if (people.length === 0) {
      setIsLoading(false);
      return;
    }

    const loadPeriod = async () => {
      try {
        setIsLoading(true);
        setError('');

        const [netWorthData, budgetRows, dailyRows, previousDailyRows, currentMethods] =
          await Promise.all([
          apiClient.getNetWorth(selectedProjectId),
          apiClient.getBudgetForMonth(year, month, selectedProjectId, appliedFilter),
          apiClient.getDailyExpense({ yearMonth }, selectedProjectId, appliedFilter),
          apiClient.getDailyExpense(
            { yearMonth: previousYearMonth },
            selectedProjectId,
            appliedFilter,
          ),
          apiClient.getPaymentMethods({ yearMonth }, selectedProjectId, appliedFilter),
        ]);

        setNetWorth(netWorthData ?? null);
        setBudgets(budgetRows ?? []);
        setDailyExpense(dailyRows ?? []);
        setPreviousDailyExpense(previousDailyRows ?? []);

        const items: ReportDto.PaymentMethodItem[] = currentMethods ?? [];

        /*
         * 카드는 실적 구간을 카드마다 따로 계산한다(신용카드는 마감일 기준 주기).
         * 위의 결제수단 집계는 달력 월이라 그 값을 쓰면 마감일이 15일인 카드의
         * 실적이 실제 카드사 기준과 달라진다.
         */
        const cardItems = items.filter(
          (item): item is ReportDto.PaymentMethodItem & { kind: SpendingMethod['kind'] } =>
            item.kind !== 'account',
        );
        const performances = await Promise.all(
          cardItems.map((item) =>
            apiClient.getCardPerformance(item.id).catch((err: unknown) => {
              console.error('카드 실적 조회 실패:', err);
              return null;
            }),
          ),
        );

        const cardMethods: SpendingMethod[] = cardItems.flatMap((item, index) => {
          const performance = performances[index];
          if (!performance) return [];
          return [
            {
              id: item.id,
              kind: item.kind,
              color: item.color,
              name: item.name,
              ownerName: item.ownerName,
              currency: performance.currency,
              periodLabel: periodLabelOf(performance, false),
              usage: performance.usage,
              previousPeriodLabel: periodLabelOf(performance, true),
              previousUsage: performance.previousUsage,
              target: performance.target,
            },
          ];
        });

        setMethods(
          cardMethods.sort(
            (a, b) =>
              METHOD_ORDER[a.kind] - METHOD_ORDER[b.kind] || Number(b.usage) - Number(a.usage),
          ),
        );
      } catch (err) {
        console.error('홈 데이터 조회 실패:', err);
        setError('데이터 조회에 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    };

    loadPeriod();
  }, [
    selectedProjectId,
    peopleLoaded,
    people.length,
    appliedFilter,
    year,
    month,
    yearMonth,
    previousYearMonth,
  ]);

  /*
   * 고른 자산주인의 총자산.
   *
   * 전원을 고른 때만 서버의 전체 값을 그대로 쓴다. 주인이 없는 계좌는 사람별 소계에
   * 들어가지 않아, 전체를 보면서 소계를 더하면 그만큼 빠진다. 자산 화면과 같은 규칙이다.
   */
  const netWorthByPerson = new Map(
    (netWorth?.byPerson ?? []).map((row) => [row.personId, row]),
  );
  const scopedNetWorth = allPeopleSelected
    ? netWorth
    : sumNetWorth(selectedPersonIds.map((id) => netWorthByPerson.get(id)));

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <PersonScopeTitle
            noun="홈"
            people={people}
            myPersonId={myPersonId}
            selectedPersonIds={selectedPersonIds}
            onTogglePerson={togglePersonId}
          />
        }
      />

      {error && <div className="p-3 bg-red-50 text-red-800 text-sm rounded-lg">{error}</div>}

      {peopleLoaded && people.length === 0 && (
        <p className="text-gray-600">
          구성원이 없습니다. 자산 화면에서 자산주인을 먼저 만들어 주세요.
        </p>
      )}

      <AssetTypeSummary byType={scopedNetWorth?.byType} />

      {/*
        자산 화면과 같은 그래프다. 지금 얼마인지(위) 다음에 어떻게 왔는지를 보고,
        그다음에 이 구간에 얼마를 썼는지(아래)로 넘어간다.
        홈은 훑어보는 자리라 월을 눌러 일별로 내려가는 것은 끈다.
      */}
      <AssetHistoryChart
        variant="compact"
        // 홈은 오늘 근처를 본다. 달 단위는 이번 달 안에서 움직인 것이 한 점에 뭉친다.
        initialGranularity="day"
        drillable={false}
        projectId={selectedProjectId}
        ownerIds={allPeopleSelected ? undefined : selectedPersonIds}
      />

      <section className="space-y-2">
        <h2 className="font-semibold text-gray-900">실적 구간 사용액</h2>
        {isLoading && methods.length === 0 ? (
          <p className="text-sm text-gray-600">로딩 중...</p>
        ) : (
          <SpendingMethodCarousel methods={methods} />
        )}
      </section>

      <section className="space-y-3">
        {/* 아래 세 칸은 모두 이 달 기준이다. 어느 달인지 한 번만 적는다. */}
        <h2 className="text-xl font-bold text-gray-900">
          {year}년 {month}월
        </h2>

        <MonthlyBudgetSummary budgets={budgets} />

        {/*
          셋을 한 줄에 늘어놓고 옆으로 넘겨 본다. 실적 구간 카드와 같은 방식이다.
          좁은 화면에서 세로로 쌓으면 비필수 지출이 한참 아래로 밀려, 세 그래프를
          견주려고 스크롤을 오르내리게 된다.
        */}
        <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory">
          {/* 맨 앞은 "어디에 썼나". 그다음 셋이 "얼마나 빨리 쓰고 있나"다. */}
          <div className="snap-start shrink-0 w-[min(100%,30rem)]">
            <CategoryDonutChart
              title="분류별 지출"
              period={{ yearMonth }}
              projectId={selectedProjectId}
              filter={appliedFilter}
            />
          </div>

          {EXPENSE_CHARTS.map((chart) => (
            <div
              key={chart.field}
              className="snap-start shrink-0 w-[min(100%,30rem)]"
            >
              <CumulativeExpenseChart
                title={chart.title}
                field={chart.field}
                yearMonth={yearMonth}
                points={dailyExpense}
                previousYearMonth={previousYearMonth}
                previousPoints={previousDailyExpense}
                throughDay={Number(today.slice(8, 10))}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        {/*
          맨 아래 거래 목록. 서버가 날짜 내림차순으로 주므로 앞날에 걸어 둔 거래가
          먼저 온다. 홈에서는 누르지 않는다. 고치러 가는 자리는 가계 화면이다.
        */}
        <h2 className="font-semibold text-gray-900">거래 내역</h2>
        <EntryFeed projectId={selectedProjectId} filter={appliedFilter} />
      </section>
    </div>
  );
}
