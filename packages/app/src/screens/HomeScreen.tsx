import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import type { EntryListItem } from '@money/types';

import { useHomeData } from '@money/core/hooks/useHomeData';
import { currentYearMonth, shiftYearMonth } from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import { useProjectDisplayCurrency, useProjectTimeZone } from '@money/core/store/project';
import { useUserFilter } from '@money/core/store/user-filter';
import { homeDataPort } from '@money/core/data/home-port';
import { useCanEdit, useProject } from '@money/core/store/project';
import { budgetSettingsHref, tagBudgetSettingsHref } from '@money/core/lib/budget';
import { budgetAnalysisInitial, type AnalysisInitial } from '@money/core/hooks/useAnalysis';

import AssetDetailView from '../components/AssetDetailView';
import EntryEditor from '../components/EntryEditor';
import MonthHeader from '../components/MonthHeader';
import MonthlyBudgetSummary, { TagBudgetSummary } from '../components/MonthlyBudgetSummary';
import PageHeader from '../components/PageHeader';
import PeriodSwipe from '../components/PeriodSwipe';
import PersonScopeTitle from '../components/PersonScopeTitle';
import SpendingMethodCarousel from '../components/SpendingMethodCarousel';
import type { EntryType } from '../components/TypeTabs';
import AnalysisScreen from './AnalysisScreen';
import { useCloseOnBack, useNavigation } from '../shell/navigation';
import { useScrollRestore, useScrollToTop } from '../shell/scroll';

/** 예산 화면에서 펼 수 있는 상세 둘. */
type HomeDetail = { kind: 'analysis'; initial: AnalysisInitial } | { kind: 'card'; id: string };

/** 카드 상세는 구성원 소계를 쓰지 않는다. AssetDetailView 가 받는 자리만 채운다. */
const EMPTY_NET_WORTH = new Map<string, { total: string }>();

/**
 * 예산 화면 (주소는 `/home`). 로그인하면 처음 보는 화면이고, 웹과 같은 차례로 늘어놓는다.
 *
 * 제목 → 실적 구간 카드 → 달 → 분류 예산(안에 지출·수입 탭) → 태그 예산.
 * 그 달의 거래 목록은 두지 않는다 (2026-10-05 사용자 요청, 웹과 같다).
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
  /**
   * 달 줄의 ‹ › 와 같은 일. 아래 예산 자리를 가로로 끌 때 쓴다.
   * 앞 값에서 옮긴다 -- 다시 그리기 전에 두 번 넘겨도 두 달이 넘어가게.
   */
  const shiftMonth = (delta: number) =>
    setView((prev) => {
      const from = `${prev.year}-${String(prev.month).padStart(2, '0')}`;
      const [nextYear, nextMonth] = shiftYearMonth(from, delta).split('-').map(Number);
      return { year: nextYear, month: nextMonth };
    });

  /* 아래 예산이 지출을 볼지 수입을 볼지. 지출부터 본다. */
  const [type, setType] = useState<EntryType>('expense');

  const home = useHomeData({ projectId: selectedProjectId, year, month, thisYearMonth });

  /*
   * 펼쳐 둔 상세. null 이면 예산 화면을 본다.
   *
   *   analysis  예산 줄을 눌러 편 분석. 거래 탭 년월 줄의 분석 아이콘이 여는 것과 같은 화면
   *             (AnalysisScreen)이다 (2026-10-09 사용자 요청) -- 지출 줄은 지출을 걸고 지출 탭,
   *             수입 줄은 수입을 걸고 수입 탭, 태그 줄은 그 태그를 걸고 합계 탭이다
   *             (`budgetAnalysisInitial`, 웹과 같다).
   *   card      실적 구간 카드를 눌러 편 카드 상세. 자산 화면에서 카드를 누를 때와 같은 상자를
   *             화면을 옮기지 않고 여기서 그린다 -- ← 를 누르면 예산 화면 그대로다
   *             (2026-10-05 사용자 요청). 카드는 id 만 들고 목록에서 다시 찾는다.
   */
  const [detail, setDetail] = useState<HomeDetail | null>(null);
  const scrollToTop = useScrollToTop();
  const { offsetOf, restoreTo } = useScrollRestore();
  /** 상세로 들어가기 전 보던 자리. */
  const listOffset = useRef(0);

  const openDetail = (next: HomeDetail | null) => {
    if (next && !detail) listOffset.current = offsetOf();
    setNotice('');
    // 분석에서 거래를 고쳤을 수 있어 돌아올 때 예산을 다시 받는다.
    if (!next && detail?.kind === 'analysis') home.reloadEntries();
    setDetail(next);
    if (next) scrollToTop();
    else restoreTo(listOffset.current);
  };

  /* 기기의 뒤로가기는 상세의 ← 와 같은 일을 한다. */
  useCloseOnBack(detail !== null, () => openDetail(null));

  const openAnalysis = (target: { id: string }, targetType: EntryType) =>
    openDetail({ kind: 'analysis', initial: budgetAnalysisInitial(target.id, targetType, yearMonth) });

  /** 펼친 카드. 목록에 없으면(숨겼거나 지운 카드) null 이고 예산 화면을 그린다. */
  const detailCard =
    detail?.kind === 'card' ? (home.cards.find((card) => card.id === detail.id) ?? null) : null;
  /** 카드의 결제 통장. 카드 금액의 통화와 대금 전표에 달 사람이 여기서 나온다. */
  const paymentAccount = detailCard
    ? home.accounts.find((account) => account.id === detailCard.paymentAccountId)
    : undefined;

  /* 사라진 카드의 상세는 접는다. 목록이 오는 중에는 기다린다 (자산 화면과 같은 규칙). */
  useEffect(() => {
    if (detail?.kind !== 'card' || detailCard || home.isLoading) return;
    setDetail(null);
  }, [detail, detailCard, home.isLoading]);

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

  /**
   * 카드 원장 줄을 눌렀을 때. 원장 줄은 전표 id 만 들고 있어 그 거래를 사본에서 읽는다
   * (자산 화면과 같다). 못 읽었거나 고칠 수 없는 구성원이면 아무것도 열지 않는다.
   */
  const openLedgerEntry = openEntry
    ? (entryId: string) => {
        void homeDataPort()
          .getEntry(entryId, selectedProjectId)
          .then((entry) => {
            if (entry) openEntry(entry);
          })
          .catch(() => {
            /* 못 읽었으면 열지 않는다. 다음 누름에 다시 해 본다. */
          });
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
      {detailCard ? (
        <AssetDetailView
          target={{ kind: 'card', card: detailCard }}
          netWorthByPerson={EMPTY_NET_WORTH}
          cardCurrency={paymentAccount?.currency ?? displayCurrency}
          paymentAccountOwnerId={paymentAccount?.ownerId ?? null}
          onClose={() => openDetail(null)}
          onOpenEntry={openLedgerEntry}
          onChanged={home.reloadEntries}
        />
      ) : detail?.kind === 'analysis' ? (
        <AnalysisScreen
          initial={detail.initial}
          onBack={() => openDetail(null)}
          /* 오른쪽 위 단추로 거래내역과 분석을 오간다 (2026-10-09 사용자 요청). */
          canOpenEntries
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
              <SpendingMethodCarousel
                methods={home.methods}
                onSelect={(method) => openDetail({ kind: 'card', id: method.id })}
              />
            )}
          </View>

          {/*
            달 줄부터 아래를 가로로 끌면 달을 넘긴다 (2026-10-08 사용자 요청). 위쪽 실적 구간
            카드는 감싸지 않는다 -- 그 줄은 가로로 끌면 카드를 넘긴다.
          */}
          <PeriodSwipe onShift={shiftMonth}>
            <View className="gap-3">
              {/*
                아래 칸들은 모두 이 달 기준이다. 어느 달인지 한 번만 적고, 여기서 달을 옮긴다.
                합계는 넘기지 않는다. 예산 상자의 합계 줄이 말한다.
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
                그 탭을 따르는 것처럼 읽힌다 (웹과 같다). 탭에는 금액을 적지 않는다.
              */}
              <MonthlyBudgetSummary
                budgets={home.budgets}
                categories={home.categories}
                type={type}
                onTypeChange={setType}
                onSelect={(target) => openAnalysis(target, type)}
                onOpenSettings={canEdit ? () => go(budgetSettingsHref(yearMonth, type)) : undefined}
              />

              {/* 태그 예산. 분류 예산과 상자를 나누고, 지출·수입 탭을 따르지 않는다 (웹과 같다). */}
              <TagBudgetSummary
                tagBudgets={home.tagBudgets}
                /* 태그 줄은 유형을 걸지 않는다. 넘기는 유형은 쓰이지 않는다. */
                onSelect={(target) => openAnalysis(target, 'expense')}
                onOpenSettings={canEdit ? () => go(tagBudgetSettingsHref(yearMonth)) : undefined}
              />
            </View>
          </PeriodSwipe>
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
