import { useState } from 'react';
import { Text, View } from 'react-native';

import { useHomeData } from '@money/core/hooks/useHomeData';
import { currentYearMonth, formatMonthShort, monthQueryRange } from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import { useProjectDisplayCurrency, useProjectTimeZone } from '@money/core/store/project';
import { useUserFilter } from '@money/core/store/user-filter';
import { useProject } from '@money/core/store/project';

import AssetTypeSummary from '../components/AssetTypeSummary';
import EntryFeed from '../components/EntryFeed';
import MonthHeader from '../components/MonthHeader';
import MonthlyBudgetSummary from '../components/MonthlyBudgetSummary';
import PersonScopeTitle from '../components/PersonScopeTitle';
import SpendingMethodCarousel from '../components/SpendingMethodCarousel';
import TypeTabs, { type EntryType } from '../components/TypeTabs';

/**
 * 로그인하면 처음 보는 화면. 웹의 홈과 같은 차례로 늘어놓는다.
 *
 * 자산 → 실적 구간 카드 → 달 → 지출·수입 탭 → 예산 → 그 달의 거래.
 * 그래프 자리는 아직 비어 있다 (웹은 recharts 로 그린다).
 */
export default function HomeScreen() {
  const { t } = useTranslation();
  const timeZone = useProjectTimeZone();
  const displayCurrency = useProjectDisplayCurrency();
  const selectedProjectId = useProject((state) => state.selectedProjectId);
  const togglePersonId = useUserFilter((state) => state.togglePersonId);

  /*
   * 보고 있는 달. 아래 예산과 거래 목록이 이 달을 따른다.
   *
   * 위쪽 자산과 실적 구간 카드는 따라가지 않는다. 자산은 "지금 얼마인가"이고
   * 실적은 카드사가 지금 세고 있는 구간이라, 지난 달을 펴 보는 것과 뜻이 다르다.
   */
  const { year: thisYear, month: thisMonth } = currentYearMonth(timeZone);
  const [view, setView] = useState({ year: thisYear, month: thisMonth });
  const { year, month } = view;
  const thisYearMonth = `${thisYear}-${String(thisMonth).padStart(2, '0')}`;
  const monthRange = monthQueryRange(year, month, timeZone);

  /* 아래 예산이 지출을 볼지 수입을 볼지. 지출부터 본다. */
  const [type, setType] = useState<EntryType>('expense');

  const home = useHomeData({ projectId: selectedProjectId, year, month, thisYearMonth });

  return (
    <View className="gap-6">
      {home.hasError ? (
        <View className="rounded-lg bg-red-50 p-3">
          <Text className="text-sm text-red-800">{t('home.loadFailed')}</Text>
        </View>
      ) : null}

      {home.peopleLoaded && home.people.length === 0 ? (
        <Text className="text-gray-600">{t('home.noPeople')}</Text>
      ) : null}

      {/* 화면의 첫 줄이자 제목이다. 이름을 누르면 자산주인을 고른다. */}
      <AssetTypeSummary
        byType={home.netWorth?.byType}
        hasNoScope={home.hasNoScope}
        scopeTitle={
          <PersonScopeTitle
            noun={t('home.assetsNoun')}
            people={home.people}
            myPersonId={home.myPersonId}
            selectedPersonIds={home.selectedPersonIds}
            onTogglePerson={togglePersonId}
          />
        }
      />

      <View className="gap-2">
        <Text className="font-semibold text-gray-900">{t('home.performanceTitle')}</Text>
        {home.isLoading && home.methods.length === 0 ? (
          <Text className="text-sm text-gray-600">{t('common.loading')}</Text>
        ) : (
          <SpendingMethodCarousel methods={home.methods} />
        )}
      </View>

      <View className="gap-3">
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
          지출/수입 탭. 두 합계를 탭에 함께 적는다. 고르지 않은 쪽도 숫자는 보여야
          "이 달에 얼마 벌어 얼마 썼나"를 눌러 보지 않고도 알 수 있다.
        */}
        <TypeTabs
          type={type}
          onChange={setType}
          expenseTotal={formatCurrency(toNumber(home.summary?.expense), displayCurrency)}
          incomeTotal={formatCurrency(toNumber(home.summary?.income), displayCurrency)}
        />

        {/* 그래프 자리. 웹은 분류별 원형과 누적 선 셋을 그린다. */}
        <View className="rounded-lg border border-gray-200 bg-white p-4">
          <Text className="text-sm text-gray-600">{t('home.chartComingSoon')}</Text>
        </View>

        <MonthlyBudgetSummary budgets={home.budgets} type={type} />
      </View>

      <View className="gap-2">
        {/*
          맨 아래 거래 목록. 서버가 날짜 내림차순으로 주므로 앞날에 걸어 둔 거래가
          먼저 온다.
        */}
        <Text className="font-semibold text-gray-900">
          {t('home.entriesTitle', { month: formatMonthShort(month) })}
        </Text>
        <EntryFeed
          projectId={selectedProjectId}
          filter={home.filter}
          startDate={monthRange.startDate}
          endDate={monthRange.endDate}
          reloadToken={home.entryVersion}
        />
      </View>
    </View>
  );
}
