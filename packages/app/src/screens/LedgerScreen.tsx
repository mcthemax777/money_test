import { useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import type { EntryListItem } from '@money/types';

import { useLedgerData, type ExtraType } from '@money/core/hooks/useLedgerData';
import { currentYearMonth } from '@money/core/lib/datetime';
import { sumEntries } from '@money/core/lib/entries';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { useProject, useProjectTimeZone } from '@money/core/store/project';
import { useUserFilter } from '@money/core/store/user-filter';

import CategoryBreakdown from '../components/CategoryBreakdown';
import MonthHeader from '../components/MonthHeader';
import PageHeader from '../components/PageHeader';
import PaymentMethodBreakdown from '../components/PaymentMethodBreakdown';
import PersonScopeTitle from '../components/PersonScopeTitle';
import TransactionCalendar from '../components/TransactionCalendar';
import TransactionListView from '../components/TransactionListView';

type ViewType = 'calendar' | 'category' | 'method';

/** 보기 방식. 웹의 가계 화면과 같은 셋이다. */
const VIEWS: Array<{ id: ViewType; labelKey: MessageKey }> = [
  { id: 'calendar', labelKey: 'ledger.tab.daily' },
  { id: 'category', labelKey: 'ledger.tab.category' },
  { id: 'method', labelKey: 'ledger.tab.method' },
];

/** 일반/과소비 필터. 둘 다 켜면 전체다. */
const EXTRA_OPTIONS: Array<{ value: ExtraType; labelKey: MessageKey }> = [
  { value: 'normal', labelKey: 'ledger.filterNormal' },
  { value: 'extra', labelKey: 'ledger.filterExtra' },
];

/**
 * 가계. 웹의 /dashboard 를 옮긴 것이다.
 *
 * 한 달(또는 고른 날)의 거래를 세 가지로 본다. 날짜별(달력 + 목록), 분류별, 수단별.
 * 기간 보기와 거래 추가·수정은 아직 웹에만 있다.
 */
export default function LedgerScreen() {
  const { t } = useTranslation();
  const timeZone = useProjectTimeZone();
  const selectedProjectId = useProject((state) => state.selectedProjectId);
  const togglePersonId = useUserFilter((state) => state.togglePersonId);

  const { year: thisYear, month: thisMonth } = currentYearMonth(timeZone);
  const [view, setView] = useState({ year: thisYear, month: thisMonth });
  const [viewType, setViewType] = useState<ViewType>('calendar');
  /*
   * 한 번 열어 본 보기는 그려 둔 채로 감춘다.
   *
   * 탭을 옮길 때마다 지우고 다시 만들면 달력을 새로 계산하고 분류별·수단별은 서버에서
   * 다시 받는다. 앱에서는 그 사이가 눈에 띄게 비어 보인다. 열어 본 적 없는 보기는
   * 만들지 않는다. 처음부터 셋 다 받아 오면 요청만 늘어난다.
   */
  const [visited, setVisited] = useState<ViewType[]>(['calendar']);
  /*
   * 그 보기를 몇 번째 열었는지.
   *
   * 남겨 둔 화면은 그대로 두되, 다시 열 때마다 서버에 새로 물어본다. 프로젝트를 여럿이
   * 함께 쓰므로 내가 보지 않는 동안 남이 고쳤을 수 있다. 받아 둔 값을 먼저 보여 주고
   * 새 값이 오면 갈아 끼우므로 화면이 비는 순간은 없다.
   */
  const [visits, setVisits] = useState<Record<ViewType, number>>({
    calendar: 0,
    category: 0,
    method: 0,
  });
  /** 달력에서 고른 날. 고르면 그 날 거래만 아래에 보여 준다. */
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [dayEntries, setDayEntries] = useState<EntryListItem[]>([]);

  const ledger = useLedgerData({
    projectId: selectedProjectId,
    year: view.year,
    month: view.month,
  });

  /* 위 머리글에 적는 이 구간의 합계. 목록의 날짜별 소계와 같은 규칙으로 센다. */
  const totals = sumEntries(ledger.entries, ledger.share);

  return (
    <View className="gap-6">
      <PageHeader
        title={
          <PersonScopeTitle
            noun={t('ledger.noun')}
            people={ledger.people}
            myPersonId={ledger.myPersonId}
            selectedPersonIds={ledger.selectedPersonIds}
            onTogglePerson={togglePersonId}
          />
        }
      />

      {ledger.hasError ? (
        <View className="rounded-lg bg-red-50 p-3">
          <Text className="text-sm text-red-800">{t('home.loadFailed')}</Text>
        </View>
      ) : null}

      <MonthHeader
        year={view.year}
        month={view.month}
        incomeTotal={totals.incomeTotal}
        expenseTotal={totals.expenseTotal}
        onMonthChange={(year, month) => {
          setView({ year, month });
          // 달을 옮기면 고른 날은 그 달에 없다. 목록을 이 달 전체로 되돌린다.
          setSelectedDate(null);
          setDayEntries([]);
        }}
      />

      {/* 보기 방식. 웹은 달 머리글 오른쪽에 붙지만 좁은 화면에서는 아래 줄로 내린다. */}
      <View className="flex-row gap-2 rounded-lg bg-gray-200 p-1">
        {VIEWS.map((item) => {
          const active = viewType === item.id;

          return (
            <Pressable
              key={item.id}
              onPress={() => {
                setViewType(item.id);
                setVisited((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]));
                setVisits((prev) => ({ ...prev, [item.id]: prev[item.id] + 1 }));
                // 날짜별은 이 화면이 들고 있는 값이라 여기서 직접 다시 받는다.
                if (item.id === 'calendar') ledger.reloadEntries();
              }}
              className={`flex-1 items-center rounded-md px-4 py-2 ${active ? 'bg-white' : ''}`}
            >
              <Text className={`font-medium ${active ? 'text-blue-600' : 'text-gray-600'}`}>
                {t(item.labelKey)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/*
        조회 필터. 둘 다 켜면 전체이고 하나도 켜지 않으면 거래가 없는 상태다.
        서버 조회 조건으로 넘어간다. 목록만 걸러 놓으면 위 합계와 어긋나기 때문이다.
      */}
      <View className="flex-row flex-wrap items-center gap-4 rounded-lg border border-gray-200 bg-white p-3">
        <Text className="text-xs font-semibold uppercase tracking-wider text-gray-600">
          {t('ledger.filterExtraLabel')}
        </Text>
        {EXTRA_OPTIONS.map((option) => (
          <Pressable
            key={option.value}
            onPress={() => ledger.toggleExtraType(option.value)}
            className="flex-row items-center gap-1.5"
          >
            <Switch
              value={ledger.selectedExtraTypes.includes(option.value)}
              onValueChange={() => ledger.toggleExtraType(option.value)}
            />
            <Text className="text-sm text-gray-700">{t(option.labelKey)}</Text>
          </Pressable>
        ))}
      </View>

      {/* 감춘 보기도 그대로 남겨 둔다. 다시 누르면 받아 둔 값이 바로 보인다. */}
      {visited.includes('category') ? (
        <View style={{ display: viewType === 'category' ? 'flex' : 'none' }}>
          <CategoryBreakdown
            period={ledger.reportPeriod}
            projectId={selectedProjectId}
            filter={ledger.filter}
            categories={ledger.categories}
            reloadToken={ledger.dataVersion + visits.category}
          />
        </View>
      ) : null}

      {visited.includes('method') ? (
        <View style={{ display: viewType === 'method' ? 'flex' : 'none' }}>
          <PaymentMethodBreakdown
            period={ledger.reportPeriod}
            projectId={selectedProjectId}
            filter={ledger.filter}
            reloadToken={ledger.dataVersion + visits.method}
          />
        </View>
      ) : null}

      <View className="gap-4" style={{ display: viewType === 'calendar' ? 'flex' : 'none' }}>
        {ledger.isLoading && ledger.entries.length === 0 ? (
          <Text className="text-gray-600">{t('common.loading')}</Text>
        ) : (
          <>
            <TransactionCalendar
              entries={ledger.entries}
              share={ledger.share}
              year={view.year}
              month={view.month}
              selectedDate={selectedDate}
              onDateSelect={(date, entries) => {
                // 같은 날을 다시 누르면 고르기를 푼다. 그 달 전체로 돌아간다.
                const isSame = selectedDate?.getTime() === date.getTime();
                setSelectedDate(isSame ? null : date);
                setDayEntries(isSame ? [] : entries);
              }}
            />

            {ledger.entries.length === 0 ? (
              /* 필터로 비었는지 원래 없는지 구분해 준다. 체크를 다 풀면 결과가 없는 게 정상이다. */
              <Text className="text-gray-600">
                {ledger.isFilterNarrowed ? t('ledger.noFiltered') : t('feed.empty')}
              </Text>
            ) : (
              <TransactionListView
                entries={selectedDate ? dayEntries : ledger.entries}
                share={ledger.share}
              />
            )}
          </>
        )}
      </View>
    </View>
  );
}
