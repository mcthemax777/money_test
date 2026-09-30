import { useRef, useState } from 'react';
import { Text, View } from 'react-native';

import type { EntryListItem } from '@money/types';

import { useHomeData } from '@money/core/hooks/useHomeData';
import { currentYearMonth, formatMonthShort, monthQueryRange } from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import { useProjectDisplayCurrency, useProjectTimeZone } from '@money/core/store/project';
import { useUserFilter } from '@money/core/store/user-filter';
import { useCanEdit, useProject } from '@money/core/store/project';
import { budgetSettingsHref, tagBudgetSettingsHref } from '@money/core/lib/budget';

import CategoryDetailView from '../components/CategoryDetailView';
import EntryEditor from '../components/EntryEditor';
import EntryFeed from '../components/EntryFeed';
import MonthHeader from '../components/MonthHeader';
import MonthlyBudgetSummary, { TagBudgetSummary } from '../components/MonthlyBudgetSummary';
import PageHeader from '../components/PageHeader';
import PersonScopeTitle from '../components/PersonScopeTitle';
import SpendingMethodCarousel from '../components/SpendingMethodCarousel';
import type { EntryType } from '../components/TypeTabs';
import { useCloseOnBack, useNavigation } from '../shell/navigation';
import { useScrollRestore, useScrollToTop } from '../shell/scroll';

/**
 * 예산 화면 (주소는 `/home`). 로그인하면 처음 보는 화면이고, 웹과 같은 차례로 늘어놓는다.
 *
 * 제목 → 실적 구간 카드 → 달 → 분류 예산(안에 지출·수입 탭) → 태그 예산 → 그 달의 거래.
 */
export default function HomeScreen() {
  const { t } = useTranslation();
  const timeZone = useProjectTimeZone();
  const displayCurrency = useProjectDisplayCurrency();
  const selectedProjectId = useProject((state) => state.selectedProjectId);
  const togglePersonId = useUserFilter((state) => state.togglePersonId);
  const { go } = useNavigation();
  /* 예산 설정의 톱니는 고칠 수 있는 사람에게만 선다. */
  const canEdit = useCanEdit();

  /*
   * 보고 있는 달. 아래 예산과 거래 목록이 이 달을 따른다.
   *
   * 위쪽 실적 구간 카드는 따라가지 않는다. 카드사가 지금 세고 있는 구간이라
   * 지난 달을 펴 보는 것과 뜻이 다르다.
   */
  const { year: thisYear, month: thisMonth } = currentYearMonth(timeZone);
  const [view, setView] = useState({ year: thisYear, month: thisMonth });
  const { year, month } = view;
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  const thisYearMonth = `${thisYear}-${String(thisMonth).padStart(2, '0')}`;
  const monthRange = monthQueryRange(year, month, timeZone);

  /* 아래 예산이 지출을 볼지 수입을 볼지. 지출부터 본다. */
  const [type, setType] = useState<EntryType>('expense');

  const home = useHomeData({ projectId: selectedProjectId, year, month, thisYearMonth });

  /*
   * 예산 줄을 눌러 편 상세 분석. null 이면 예산 화면을 본다. 가계 분류별에서 분류를 누를 때와
   * 같은 보기이고, 펴고 접을 때 자리를 다루는 규칙도 같다 (LedgerScreen 의 openDetail).
   */
  const [detail, setDetail] = useState<{ id: string; name: string } | null>(null);
  const scrollToTop = useScrollToTop();
  const { offsetOf, restoreTo } = useScrollRestore();
  /** 상세로 들어가기 전 보던 자리. */
  const listOffset = useRef(0);

  const openDetail = (next: { id: string; name: string } | null) => {
    if (next && !detail) listOffset.current = offsetOf();
    setNotice('');
    setDetail(next);
    if (next) scrollToTop();
    else restoreTo(listOffset.current);
  };

  /* 기기의 뒤로가기는 상세의 ← 와 같은 일을 한다. */
  useCloseOnBack(detail !== null, () => openDetail(null));

  /** 상세의 거래를 누르면 여는 고치기 창. 읽기 전용 구성원에게는 열지 않는다. */
  const [editor, setEditor] = useState<{ isOpen: boolean; editing: EntryListItem | null }>({
    isOpen: false,
    editing: null,
  });
  /** 고치기 창이 알리는 한 줄 (고칠 수 없는 거래 등). */
  const [notice, setNotice] = useState('');
  const openEntry = canEdit
    ? (entry: EntryListItem) => {
        setNotice('');
        setEditor({ isOpen: true, editing: entry });
      }
    : undefined;

  return (
    <View className="gap-6">
      {/* 고치기 창이 알린 한 줄. 상세에서 거래를 눌렀을 때 뜨므로 두 보기 모두의 위에 둔다. */}
      {notice ? (
        <View className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <Text className="text-sm text-amber-800">{notice}</Text>
        </View>
      ) : null}

      {/*
        펼쳐 둔 상세만 그린다. 가계 화면과 같은 짜임이다 -- 위에 목록을 남기면 그래프가
        한참 아래로 밀린다. 닫으면 보던 자리로 돌아온다.
      */}
      {detail ? (
        <CategoryDetailView
          categoryId={detail.id}
          categoryName={detail.name}
          categories={home.categories}
          period={{ yearMonth }}
          projectId={selectedProjectId}
          filter={home.filter}
          reloadToken={home.entryVersion}
          onClose={() => openDetail(null)}
          onEntryClick={openEntry}
        />
      ) : (
        <>
          {home.hasError ? (
            <View className="rounded-lg bg-red-50 p-3">
              <Text className="text-sm text-red-800">{t('home.loadFailed')}</Text>
            </View>
          ) : null}

          {home.peopleLoaded && home.people.length === 0 ? (
            <Text className="text-gray-600">{t('home.noPeople')}</Text>
          ) : null}

          {/*
            화면의 첫 줄이자 제목이다. 이름을 누르면 자산주인을 고른다.

            자산 금액은 자산 화면으로 옮겼다. 제목은 남긴다. 아래 예산과 거래가 모두
            여기서 고른 자산주인을 따르므로, 이 줄을 빼면 홈에서 보는 범위를 홈에서
            바꿀 수 없다. 이름은 자산이 아니라 화면 이름인 "홈"이다.
          */}
          <PageHeader
            title={
              <PersonScopeTitle
                noun={t('nav.home')}
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
              합계는 넘기지 않는다. 예산 상자의 지출·수입 탭이 각각 적는다.
            */}
            <MonthHeader
              year={year}
              month={month}
              incomeTotal={0}
              expenseTotal={0}
              onMonthChange={(nextYear, nextMonth) => setView({ year: nextYear, month: nextMonth })}
            />

            {/*
              분류 예산. 지출·수입 탭이 이 상자 안에 있다 -- 밖에 두면 아래 태그 예산까지
              그 탭을 따르는 것처럼 읽힌다 (웹과 같다). 탭에는 이 달의 두 합계를 함께 적는다.
            */}
            <MonthlyBudgetSummary
              budgets={home.budgets}
              type={type}
              onTypeChange={setType}
          onSelect={openDetail}
              expenseTotal={formatCurrency(toNumber(home.summary?.expense), displayCurrency)}
              incomeTotal={formatCurrency(toNumber(home.summary?.income), displayCurrency)}
              onOpenSettings={canEdit ? () => go(budgetSettingsHref(yearMonth, type)) : undefined}
            />

            {/* 태그 예산. 분류 예산과 상자를 나누고, 지출·수입 탭을 따르지 않는다 (웹과 같다). */}
            <TagBudgetSummary
              tagBudgets={home.tagBudgets}
              onSelect={openDetail}
              onOpenSettings={canEdit ? () => go(tagBudgetSettingsHref(yearMonth)) : undefined}
            />
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
        </>
      )}

      {/* 상세의 거래를 누르면 여는 고치기 창. 가계 화면과 같은 것이다. */}
      <EntryEditor
        isOpen={editor.isOpen}
        editing={editor.editing}
        onClose={() => setEditor({ isOpen: false, editing: null })}
        onSaved={home.reloadEntries}
        onNotEditable={() => setNotice(t('editor.notEditable'))}
      />
    </View>
  );
}
