'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BudgetDto, CardDto, EntryFilterQuery, ReportDto } from '@money/types';
import type { Account, Card, Category, Person } from '@money/core/lib/types';

import { apiClient } from '@money/core/lib/api-client';
import {
  currentYearMonth,
  dateMarkerKey,
  formatMonthShort,
  monthQueryRange,
  shiftYearMonth,
  throughDayOf,
} from '@money/core/lib/datetime';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import { sumNetWorth } from '@money/core/lib/net-worth';
import { useHomeData } from '@money/core/hooks/useHomeData';
import { useProjectGuard } from '@/hooks/useProjectGuard';
import { useProjectDisplayCurrency, useProjectTimeZone } from '@money/core/store/project';
import { useUserFilter } from '@money/core/store/user-filter';
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
import ScrollRow from '@/components/ScrollRow';
import PersonScopeTitle from '@/components/PersonScopeTitle';
import SpendingMethodCarousel from '@/components/SpendingMethodCarousel';

/** 보고 있는 것. 달 아래 탭이 이 둘을 오간다. */
type EntryType = 'income' | 'expense';

/**
 * 지출은 빨강, 수입은 초록.
 *
 * 금액 색과 고른 탭의 색을 같은 값에서 뽑는다. 탭 밑줄만 파랑으로 두면 빨간
 * 금액 아래에 파란 줄이 그어져 두 색이 무엇을 뜻하는지 흐려진다. 가계 화면
 * 머리글의 수입 초록·지출 빨강과도 같은 색이다.
 */
const TYPE_TABS: Array<{ type: EntryType; labelKey: MessageKey; text: string; border: string }> = [
  { type: 'expense', labelKey: 'home.tab.expense', text: 'text-red-600', border: 'border-red-600' },
  {
    type: 'income',
    labelKey: 'home.tab.income',
    text: 'text-green-600',
    border: 'border-green-600',
  },
];

/**
 * 누적 그래프 세 장. 넓은 쪽에서 좁은 쪽으로 늘어놓는다.
 *
 * 수입도 같은 세 장이다. 과소비에 해당하는 것이 수입에서는 추가 수입이고, 서버가
 * 두 유형을 같은 모양(normal/extra)으로 주므로 그리는 방법이 다르지 않다.
 */
const CUMULATIVE_CHARTS: Record<EntryType, Array<{ field: ExpenseField; titleKey: MessageKey }>> = {
  expense: [
    { field: 'total', titleKey: 'home.chart.expense.total' },
    { field: 'normal', titleKey: 'home.chart.expense.normal' },
    { field: 'extra', titleKey: 'home.chart.expense.extra' },
  ],
  income: [
    { field: 'total', titleKey: 'home.chart.income.total' },
    { field: 'normal', titleKey: 'home.chart.income.normal' },
    { field: 'extra', titleKey: 'home.chart.income.extra' },
  ],
};

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
  const { t } = useTranslation();
  const selectedProjectId = useProjectGuard();
  const { selectedPersonIds, togglePersonId } = useUserFilter();
  const timeZone = useProjectTimeZone();
  const displayCurrency = useProjectDisplayCurrency();

  /*
   * 보고 있는 달. 아래 예산·그래프·거래 목록이 모두 이 달을 따른다.
   *
   * 위쪽 자산과 실적 구간 카드는 따라가지 않는다. 자산은 "지금 얼마인가"이고
   * 실적은 카드사가 지금 세고 있는 구간이라, 지난 달을 펴 보는 것과 뜻이 다르다.
   */
  const { year: thisYear, month: thisMonth } = currentYearMonth(timeZone);
  const [view, setView] = useState({ year: thisYear, month: thisMonth });
  const { year, month } = view;
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  const thisYearMonth = `${thisYear}-${String(thisMonth).padStart(2, '0')}`;
  const previousYearMonth = shiftYearMonth(yearMonth, -1);
  const earlierYearMonth = shiftYearMonth(yearMonth, -2);
  const monthRange = monthQueryRange(year, month, timeZone);

  /*
   * 화면이 보는 값 전부. 앱의 홈 화면도 같은 훅을 쓴다.
   *
   * 그래프만 여기 남는다. 앱에는 아직 그래프가 없고, 탭을 옮길 때마다 자산과 카드
   * 실적까지 다시 받지 않도록 조회도 따로 두어야 한다.
   */
  const home = useHomeData({ projectId: selectedProjectId, year, month, thisYearMonth });
  const {
    people,
    peopleLoaded,
    cards,
    accounts,
    categories,
    myPersonId,
    netWorth: scopedNetWorth,
    budgets,
    summary,
    methods,
    filter: appliedFilter,
    isLoading,
    hasError,
    cardVersion,
    entryVersion,
  } = home;

  /*
   * 아래 예산과 그래프가 지출을 볼지 수입을 볼지.
   *
   * 지출부터 본다. 홈을 여는 까닭은 대개 "이 달에 얼마나 썼나"이고, 수입은 달마다
   * 크게 흔들리지 않는다.
   */
  const [type, setType] = useState<EntryType>('expense');
  /* 아래 셋은 모두 지금 고른 탭(type)의 값이다. */
  const [dailyPoints, setDailyPoints] = useState<ReportDto.DailyExpensePoint[]>([]);
  const [previousDailyPoints, setPreviousDailyPoints] = useState<ReportDto.DailyExpensePoint[]>([]);
  /** 전전달. 지난달 하나만으로는 그 달이 유난했던 것인지 알 수 없다. */
  const [earlierDailyPoints, setEarlierDailyPoints] = useState<ReportDto.DailyExpensePoint[]>([]);
  /** 그래프를 받는 중. 탭을 옮기면 다시 받는다. */
  const [isChartLoading, setIsChartLoading] = useState(true);
  /*
   * 그래프만 못 받았을 때.
   *
   * 위쪽 오류와 나눠 둔다. 그쪽은 화면 맨 위 띠라, 그래프 하나가 실패했을 때
   * 띄우면 자산과 예산까지 못 받은 것처럼 보인다.
   */
  const [chartError, setChartError] = useState('');
  /** 정산 팝업을 띄울 카드. */
  const [settlementCardId, setSettlementCardId] = useState<string | null>(null);
  /** 거래 상세·수정 팝업. 가계·자산 화면과 같은 컴포넌트다. */
  const entryEditorRef = useRef<EntryEditorHandle>(null);

  /** 이번 달 선을 어디까지 그을지 (throughDayOf 주석 참고) */
  const throughDay = throughDayOf(yearMonth, timeZone);


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
        setChartError(t('home.chartFailed'));
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
    t,
  ]);

  /** 정산 팝업을 띄울 카드. 목록에 없으면(숨긴 카드 등) 팝업을 열지 않는다. */
  const settlementCard = cards.find((card) => card.id === settlementCardId);

  return (
    <div className="space-y-6">
      {hasError && (
        <div className="p-3 bg-red-50 text-red-800 text-sm rounded-lg">{t('home.loadFailed')}</div>
      )}

      {peopleLoaded && people.length === 0 && (
        <p className="text-gray-600">{t('home.noPeople')}</p>
      )}

      {/* 화면의 첫 줄이자 제목이다. 이름을 누르면 자산주인을 고른다. */}
      <AssetTypeSummary
        byType={scopedNetWorth?.byType}
        hasNoScope={home.hasNoScope}
        scopeTitle={
          <PersonScopeTitle
            noun={t('home.assetsNoun')}
            people={people}
            myPersonId={myPersonId}
            selectedPersonIds={selectedPersonIds}
            onTogglePerson={togglePersonId}
          />
        }
      />

      <section className="space-y-2">
        <h2 className="font-semibold text-gray-900">{t('home.performanceTitle')}</h2>
        {isLoading && methods.length === 0 ? (
          <p className="text-sm text-gray-600">{t('common.loading')}</p>
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
              <span>{t(tab.labelKey)}</span>
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
        <ScrollRow className="gap-3 pb-2">
          {/* 맨 앞은 "어디에 썼나". 그다음 셋이 "얼마나 빨리 쓰고 있나"다. */}
          <div className="snap-start shrink-0 w-[min(100%,30rem)]">
            <CategoryDonutChart
              title={
                type === 'income'
                  ? t('home.categoryChart.income')
                  : t('home.categoryChart.expense')
              }
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
                <p className="text-sm text-gray-600">{t('common.loading')}</p>
              )}
            </div>
          ) : (
            CUMULATIVE_CHARTS[type].map((chart) => (
              <div
                key={chart.field}
                className="snap-start shrink-0 w-[min(100%,30rem)]"
              >
                <CumulativeExpenseChart
                  title={t(chart.titleKey)}
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
        </ScrollRow>

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
          title={t('home.settlementTitle', { card: settlementCard.name })}
        >
          <CardSettlementPanel
            card={settlementCard}
            paymentAccountOwnerId={
              accounts.find((account) => account.id === settlementCard.paymentAccountId)?.ownerId
            }
            reloadToken={cardVersion}
            onChange={home.reloadCards}
          />
        </Modal>
      )}

      <section className="space-y-2">
        {/*
          맨 아래 거래 목록. 서버가 날짜 내림차순으로 주므로 앞날에 걸어 둔 거래가
          먼저 온다. 누르면 가계·자산 화면과 같은 상세 팝업이 열린다.
        */}
        <h2 className="font-semibold text-gray-900">
          {t('home.entriesTitle', { month: formatMonthShort(month) })}
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
        onReferenceDataChange={home.applyReferencePatch}
        onEntryChange={home.reloadEntries}
      />
    </div>
  );
}
