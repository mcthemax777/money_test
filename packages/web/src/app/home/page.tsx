'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BudgetDto, CardDto, EntryFilterQuery, ReportDto } from '@money/types';
import type { Account, Card, Category, Person } from '@/lib/types';

import { apiClient } from '@/lib/api-client';
import {
  currentYearMonth,
  dateMarkerKey,
  monthQueryRange,
  shiftYearMonth,
  throughDayOf,
} from '@/lib/datetime';
import { formatCurrency, toNumber } from '@/lib/money';
import { sumNetWorth } from '@/lib/net-worth';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useDragScroll } from '@/hooks/useDragScroll';
import { usePersonFilterSync } from '@/hooks/usePersonFilterSync';
import { useProjectGuard } from '@/hooks/useProjectGuard';
import {
  useMyPersonId,
  useProjectDisplayCurrency,
  useProjectTimeZone,
} from '@/store/project';
import { useUserFilter } from '@/store/user-filter';
import AssetTypeSummary from '@/components/AssetTypeSummary';
import CategoryDonutChart from '@/components/CategoryDonutChart';
import CumulativeExpenseChart, {
  type ExpenseField,
} from '@/components/CumulativeExpenseChart';
import EntryFeed from '@/components/EntryFeed';
import CardSettlementPanel from '@/components/CardSettlementPanel';
import EntryEditor, {
  type EntryEditorHandle,
  type ReferenceDataPatch,
} from '@/components/EntryEditor';
import Modal from '@/components/Modal';
import MonthHeader from '@/components/MonthHeader';
import MonthlyBudgetSummary from '@/components/MonthlyBudgetSummary';
import PersonScopeTitle from '@/components/PersonScopeTitle';
import SpendingMethodCarousel, {
  type SpendingMethod,
} from '@/components/SpendingMethodCarousel';

/** 보고 있는 것. 달 아래 탭이 이 둘을 오간다. */
type EntryType = 'income' | 'expense';

/**
 * 지출은 빨강, 수입은 초록.
 *
 * 금액 색과 고른 탭의 색을 같은 값에서 뽑는다. 탭 밑줄만 파랑으로 두면 빨간
 * 금액 아래에 파란 줄이 그어져 두 색이 무엇을 뜻하는지 흐려진다. 가계 화면
 * 머리글의 수입 초록·지출 빨강과도 같은 색이다.
 */
const TYPE_TABS: Array<{ type: EntryType; label: string; text: string; border: string }> = [
  { type: 'expense', label: '지출', text: 'text-red-600', border: 'border-red-600' },
  { type: 'income', label: '수입', text: 'text-green-600', border: 'border-green-600' },
];

/**
 * 누적 그래프 세 장. 넓은 쪽에서 좁은 쪽으로 늘어놓는다.
 *
 * 수입도 같은 세 장이다. 과소비에 해당하는 것이 수입에서는 추가 수입이고, 서버가
 * 두 유형을 같은 모양(normal/extra)으로 주므로 그리는 방법이 다르지 않다.
 */
const CUMULATIVE_CHARTS: Record<EntryType, Array<{ field: ExpenseField; title: string }>> = {
  expense: [
    { field: 'total', title: '전체 지출' },
    { field: 'normal', title: '일반 지출' },
    { field: 'extra', title: '과소비' },
  ],
  income: [
    { field: 'total', title: '전체 수입' },
    { field: 'normal', title: '일반 수입' },
    { field: 'extra', title: '추가 수입' },
  ],
};

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
  const displayCurrency = useProjectDisplayCurrency();

  const [people, setPeople] = useState<Person[]>([]);
  /** 구성원 목록을 받아 봤는지. 아직이면 필터를 만들 수 없어 조회를 미룬다. */
  const [peopleLoaded, setPeopleLoaded] = useState(false);
  const [netWorth, setNetWorth] = useState<ReportDto.NetWorth | null>(null);
  const [methods, setMethods] = useState<SpendingMethod[]>([]);
  const [budgets, setBudgets] = useState<BudgetDto.MonthlyBudget[]>([]);
  /** 이 달 수입·지출 합계. 탭에 적는다. */
  const [summary, setSummary] = useState<ReportDto.Summary | null>(null);
  /*
   * 아래 예산과 그래프가 지출을 볼지 수입을 볼지.
   *
   * 지출부터 본다. 홈을 여는 까닭은 대개 "이 달에 얼마나 썼나"이고, 수입은 달마다
   * 크게 흔들리지 않는다.
   */
  const [type, setType] = useState<EntryType>('expense');
  /* 아래 셋은 모두 지금 고른 탭(type)의 값이다. */
  const [dailyPoints, setDailyPoints] = useState<ReportDto.DailyExpensePoint[]>([]);
  const [previousDailyPoints, setPreviousDailyPoints] = useState<
    ReportDto.DailyExpensePoint[]
  >([]);
  /** 전전달. 지난달 하나만으로는 그 달이 유난했던 것인지 알 수 없다. */
  const [earlierDailyPoints, setEarlierDailyPoints] = useState<
    ReportDto.DailyExpensePoint[]
  >([]);
  /** 그래프를 받는 중. 탭을 옮기면 다시 받는다. */
  const [isChartLoading, setIsChartLoading] = useState(true);
  /*
   * 그래프만 못 받았을 때.
   *
   * 위쪽 error와 나눠 둔다. 그쪽은 화면 맨 위 띠라, 그래프 하나가 실패했을 때
   * 띄우면 자산과 예산까지 못 받은 것처럼 보인다.
   */
  const [chartError, setChartError] = useState('');
  /*
   * 정산 팝업에 필요한 것들.
   *
   * 카드에는 결제 통장이 붙어 있고, 대금 전표에는 그 통장 주인을 달아야 한다.
   * 그래서 카드와 통장 목록을 함께 들고 있는다.
   */
  const [cards, setCards] = useState<Card[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  /** 거래 상세 팝업이 쓰는 목록. 분류를 보여 주고 고칠 때 고른다. */
  const [categories, setCategories] = useState<Category[]>([]);
  const [settlementCardId, setSettlementCardId] = useState<string | null>(null);
  /** 대금을 기록한 뒤 사용 현황을 다시 읽게 하는 표. */
  const [cardVersion, setCardVersion] = useState(0);
  /** 거래를 고친 뒤 목록을 처음부터 다시 받게 하는 표. */
  const [entryVersion, setEntryVersion] = useState(0);
  /** 거래 상세·수정 팝업. 가계·자산 화면과 같은 컴포넌트다. */
  const entryEditorRef = useRef<EntryEditorHandle>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // 이번 달 판단도 프로젝트 타임존 기준이다. 브라우저 로컬로 읽으면 자정 전후로 달이 밀린다.
  const { year: thisYear, month: thisMonth } = currentYearMonth(timeZone);

  /*
   * 보고 있는 달. 아래 예산·그래프·거래 목록이 모두 이 달을 따른다.
   *
   * 위쪽 자산과 실적 구간 카드는 따라가지 않는다. 자산은 "지금 얼마인가"이고
   * 실적은 카드사가 지금 세고 있는 구간이라, 지난 달을 펴 보는 것과 뜻이 다르다.
   */
  const [view, setView] = useState({ year: thisYear, month: thisMonth });
  const { year, month } = view;
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  const thisYearMonth = `${thisYear}-${String(thisMonth).padStart(2, '0')}`;
  const previousYearMonth = shiftYearMonth(yearMonth, -1);
  const earlierYearMonth = shiftYearMonth(yearMonth, -2);
  const monthRange = monthQueryRange(year, month, timeZone);

  /** 이번 달 선을 어디까지 그을지 (throughDayOf 주석 참고) */
  const throughDay = throughDayOf(yearMonth, timeZone);

  // 휠만 있는 마우스로도 그래프를 끌어서 넘길 수 있게 한다 (useDragScroll 주석 참고).
  const chartScrollRef = useDragScroll<HTMLDivElement>();

  useEffect(() => {
    if (!selectedProjectId) return;

    const loadReference = async () => {
      try {
        const [peopleData, cardsData, accountsData, categoryData] = await Promise.all([
          apiClient.getPeople(selectedProjectId),
          apiClient.getCards(selectedProjectId),
          apiClient.getAccountsV2(selectedProjectId),
          apiClient.getCategories(selectedProjectId),
        ]);
        // 저장된 자산주인 선택은 usePersonFilterSync 가 이 목록에 맞춘다.
        setPeople(peopleData || []);
        setCards(cardsData || []);
        setAccounts(accountsData || []);
        setCategories(categoryData || []);
        setPeopleLoaded(true);
      } catch (err) {
        console.error('구성원·카드 조회 실패:', err);
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

        const [netWorthData, budgetRows, summaryRow, currentMethods] = await Promise.all([
          apiClient.getNetWorth(selectedProjectId),
          apiClient.getBudgetForMonth(year, month, selectedProjectId, appliedFilter),
          // 탭에 적을 이 달 합계. 가계 화면의 머리글과 같은 값이다.
          apiClient.getSummary({ yearMonth }, selectedProjectId, appliedFilter),
          // 실적 구간 카드는 보고 있는 달과 무관하게 지금 달을 센다.
          apiClient.getPaymentMethods({ yearMonth: thisYearMonth }, selectedProjectId, appliedFilter),
        ]);

        setNetWorth(netWorthData ?? null);
        setBudgets(budgetRows ?? []);
        setSummary(summaryRow ?? null);

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
    thisYearMonth,
    // 거래를 고치면 합계도 함께 다시 받는다.
    entryVersion,
  ]);

  /*
   * 누적 그래프의 재료. 고른 탭의 세 달치를 받는다.
   *
   * 위 조회와 나누어 둔다. 탭을 옮길 때마다 자산과 카드 실적까지 다시 받으면
   * 카드 수만큼 요청이 더 나간다. 그 둘은 탭과 상관없는 값이다.
   */
  useEffect(() => {
    if (!selectedProjectId || !peopleLoaded || people.length === 0) return;

    let cancelled = false;
    setIsChartLoading(true);
    setChartError('');

    Promise.all(
      [yearMonth, previousYearMonth, earlierYearMonth].map((month) =>
        apiClient.getDailyExpense({ yearMonth: month }, type, selectedProjectId, appliedFilter),
      ),
    )
      .then(([currentRows, previousRows, earlierRows]) => {
        if (cancelled) return;
        setDailyPoints(currentRows ?? []);
        setPreviousDailyPoints(previousRows ?? []);
        setEarlierDailyPoints(earlierRows ?? []);
      })
      .catch((err) => {
        console.error('날짜별 합계 조회 실패:', err);
        if (cancelled) return;
        // 이전 탭의 선이 남으면 지출을 수입으로 읽게 된다. 비우고 안내를 띄운다.
        setDailyPoints([]);
        setPreviousDailyPoints([]);
        setEarlierDailyPoints([]);
        setChartError('그래프를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setIsChartLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    selectedProjectId,
    peopleLoaded,
    people.length,
    appliedFilter,
    type,
    yearMonth,
    previousYearMonth,
    earlierYearMonth,
    entryVersion,
  ]);

  /** 상세 팝업에서 거래를 고치거나 지운 뒤. 목록과 합계를 함께 다시 읽는다. */
  const handleEntryChange = useCallback(() => {
    setEntryVersion((version) => version + 1);
  }, []);

  /** 팝업 안에서 계좌·카드·분류·사람을 새로 만들었을 때. 화면의 목록에 반영한다. */
  const handleReferenceDataChange = useCallback((patch: ReferenceDataPatch) => {
    if (patch.accounts) setAccounts(patch.accounts);
    if (patch.cards) setCards(patch.cards);
    if (patch.categories) setCategories(patch.categories);
    if (patch.people) setPeople(patch.people);
  }, []);

  /*
   * 고른 자산주인의 총자산.
   *
   * 전원을 고른 때만 서버의 전체 값을 그대로 쓴다. 주인이 없는 계좌는 사람별 소계에
   * 들어가지 않아, 전체를 보면서 소계를 더하면 그만큼 빠진다. 자산 화면과 같은 규칙이다.
   */
  const netWorthByPerson = new Map(
    (netWorth?.byPerson ?? []).map((row) => [row.personId, row]),
  );
  /** 정산 팝업을 띄울 카드. 목록에 없으면(숨긴 카드 등) 팝업을 열지 않는다. */
  const settlementCard = cards.find((card) => card.id === settlementCardId);

  const scopedNetWorth = allPeopleSelected
    ? netWorth
    : sumNetWorth(selectedPersonIds.map((id) => netWorthByPerson.get(id)));

  return (
    <div className="space-y-6">
      {error && <div className="p-3 bg-red-50 text-red-800 text-sm rounded-lg">{error}</div>}

      {peopleLoaded && people.length === 0 && (
        <p className="text-gray-600">
          구성원이 없습니다. 자산 화면에서 자산주인을 먼저 만들어 주세요.
        </p>
      )}

      {/* 화면의 첫 줄이자 제목이다. 이름을 누르면 자산주인을 고른다. */}
      <AssetTypeSummary
        byType={scopedNetWorth?.byType}
        hasNoScope={people.length > 0 && selectedPersonIds.length === 0}
        scopeTitle={
          <PersonScopeTitle
            noun="자산"
            people={people}
            myPersonId={myPersonId}
            selectedPersonIds={selectedPersonIds}
            onTogglePerson={togglePersonId}
          />
        }
      />

      <section className="space-y-2">
        <h2 className="font-semibold text-gray-900">실적 구간 사용액</h2>
        {isLoading && methods.length === 0 ? (
          <p className="text-sm text-gray-600">로딩 중...</p>
        ) : (
          <SpendingMethodCarousel
            methods={methods}
            onSelect={(method) => setSettlementCardId(method.id)}
          />
        )}
      </section>

      <section className="space-y-3">
        {/*
          아래 칸들은 모두 이 달 기준이다. 어느 달인지 한 번만 적고, 여기서 달을 옮긴다.
          합계는 넘기지 않는다. 바로 아래 탭이 지출·수입을 각각 적는다.
        */}
        <MonthHeader
          year={year}
          month={month}
          incomeTotal={0}
          expenseTotal={0}
          onMonthChange={(nextYear, nextMonth) => setView({ year: nextYear, month: nextMonth })}
        />

        {/*
          지출/수입 탭.

          두 합계를 탭에 함께 적는다. 고르지 않은 쪽도 숫자는 보여야 "이 달에 얼마
          벌어 얼마 썼나"를 탭을 눌러 보지 않고도 알 수 있다. 아래 예산 요약과
          그래프가 고른 쪽을 따른다.
        */}
        <div className="flex border-b border-gray-200">
          {TYPE_TABS.map((tab) => (
            <button
              key={tab.type}
              type="button"
              onClick={() => setType(tab.type)}
              aria-pressed={type === tab.type}
              /*
                둘이 화면을 반씩 나눈다. 글자 길이대로 두면 금액 자리수에 따라
                누르는 자리가 달마다 움직인다.

                글자와 금액 모두 그 유형의 색이다. 고르지 않은 쪽을 회색으로
                내리면 색이 "고른 것"을 뜻하게 되어, 빨강·초록이 지출·수입을
                가리킨다는 것이 흐려진다. 무엇을 골랐는지는 밑줄과 굵기가 말한다.
              */
              className={`flex flex-1 items-baseline justify-center gap-2 px-4 py-2 transition ${tab.text} ${
                type === tab.type
                  ? `border-b-2 ${tab.border} font-semibold`
                  : 'font-medium hover:bg-gray-50'
              }`}
            >
              <span>{tab.label}</span>
              <span className="text-sm font-semibold tabular-nums">
                {formatCurrency(
                  toNumber(tab.type === 'income' ? summary?.income : summary?.expense),
                  displayCurrency,
                )}
              </span>
            </button>
          ))}
        </div>

        {/*
          셋을 한 줄에 늘어놓고 옆으로 넘겨 본다. 실적 구간 카드와 같은 방식이다.
          좁은 화면에서 세로로 쌓으면 비필수 지출이 한참 아래로 밀려, 세 그래프를
          견주려고 스크롤을 오르내리게 된다.
        */}
        <div ref={chartScrollRef} className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory">
          {/* 맨 앞은 "어디에 썼나". 그다음 셋이 "얼마나 빨리 쓰고 있나"다. */}
          <div className="snap-start shrink-0 w-[min(100%,30rem)]">
            <CategoryDonutChart
              title={type === 'income' ? '분류별 수입' : '분류별 지출'}
              type={type}
              period={{ yearMonth }}
              projectId={selectedProjectId}
              filter={appliedFilter}
            />
          </div>

          {/*
            받는 동안에는 세 장 대신 한 자리만 둔다. 빈 값으로 그리면 0에 붙은
            평평한 선이 나와, 아직 못 받은 것이 아니라 쓴 적이 없는 것으로 읽힌다.
          */}
          {isChartLoading || chartError ? (
            <div className="snap-start shrink-0 w-[min(100%,30rem)] rounded-lg border border-gray-200 bg-white p-4">
              {chartError ? (
                <p className="text-sm text-red-600">{chartError}</p>
              ) : (
                <p className="text-sm text-gray-600">로딩 중...</p>
              )}
            </div>
          ) : (
            CUMULATIVE_CHARTS[type].map((chart) => (
              <div
                key={chart.field}
                className="snap-start shrink-0 w-[min(100%,30rem)]"
              >
                <CumulativeExpenseChart
                  title={chart.title}
                  type={type}
                  field={chart.field}
                  yearMonth={yearMonth}
                  points={dailyPoints}
                  previousYearMonth={previousYearMonth}
                  previousPoints={previousDailyPoints}
                  earlierYearMonth={earlierYearMonth}
                  earlierPoints={earlierDailyPoints}
                  throughDay={throughDay}
                />
              </div>
            ))
          )}
        </div>

        {/*
          예산은 그래프 뒤에 둔다. 홈을 여는 까닭은 "이 달이 어떻게 흘러가고
          있나"라, 그림이 먼저 오고 분류별 진행률은 그다음에 들여다보는 것이다.
        */}
        <MonthlyBudgetSummary budgets={budgets} type={type} />
      </section>

      {/*
        카드를 누르면 정산 팝업. 가계 화면의 수단별 탭과 같은 컴포넌트를 쓴다.
        체크카드는 갚을 대금이 없어 그 사실만 적힌 팝업이 뜬다.
      */}
      {settlementCard && (
        <Modal
          isOpen
          onClose={() => setSettlementCardId(null)}
          title={`${settlementCard.name} 정산`}
        >
          <CardSettlementPanel
            card={settlementCard}
            paymentAccountOwnerId={
              accounts.find((account) => account.id === settlementCard.paymentAccountId)?.ownerId
            }
            reloadToken={cardVersion}
            onChange={() => setCardVersion((v) => v + 1)}
          />
        </Modal>
      )}

      <section className="space-y-2">
        {/*
          맨 아래 거래 목록. 서버가 날짜 내림차순으로 주므로 앞날에 걸어 둔 거래가
          먼저 온다. 누르면 가계·자산 화면과 같은 상세 팝업이 열린다.
        */}
        <h2 className="font-semibold text-gray-900">
          {month}월 거래 내역
        </h2>
        <EntryFeed
          projectId={selectedProjectId}
          filter={appliedFilter}
          startDate={monthRange.startDate}
          endDate={monthRange.endDate}
          onEntryClick={(entry) => entryEditorRef.current?.openDetail(entry)}
          reloadToken={entryVersion}
        />
      </section>

      {/* 거래 상세·수정 팝업. 가계·자산 화면이 쓰는 것과 같은 컴포넌트다. */}
      <EntryEditor
        ref={entryEditorRef}
        projectId={selectedProjectId}
        accounts={accounts}
        cards={cards}
        categories={categories}
        people={people}
        onReferenceDataChange={handleReferenceDataChange}
        onEntryChange={handleEntryChange}
      />
    </div>
  );
}
