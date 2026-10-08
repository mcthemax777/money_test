'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BudgetDto, CardDto, EntryFilterQuery } from '@money/types';
import type { Account, Card, Category, Person } from '@money/core/lib/types';

import { currentYearMonth, shiftYearMonth } from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import { useHomeData } from '@money/core/hooks/useHomeData';
import { usePeriodSwipe } from '@/hooks/usePeriodSwipe';
import { useProjectGuard } from '@/hooks/useProjectGuard';
import {
  useCanEdit,
  useProjectTimeZone,
} from '@money/core/store/project';
import { budgetSettingsHref, tagBudgetSettingsHref } from '@money/core/lib/budget';
import { useUserFilter } from '@money/core/store/user-filter';
import EntryEditor, {
  type EntryEditorHandle,
  type ReferenceDataPatch,
} from '@/components/EntryEditor';
import AnalysisView from '@/components/AnalysisView';
import { budgetAnalysisInitial, type AnalysisInitial } from '@money/core/hooks/useAnalysis';
import { useCloseOnBack } from '@/hooks/useCloseOnBack';
import { useSwapScroll } from '@/hooks/useSwapScroll';
import { apiClient } from '@money/core/lib/api-client';
import CardDetailBody from '@/components/CardDetailBody';
import Modal from '@/components/Modal';
import MonthHeader from '@/components/MonthHeader';
import MonthlyBudgetSummary, { TagBudgetSummary } from '@/components/MonthlyBudgetSummary';
import PageHeader from '@/components/PageHeader';
import PersonScopeTitle from '@/components/PersonScopeTitle';
import SpendingMethodCarousel from '@/components/SpendingMethodCarousel';
import type { EntryType } from '@/components/TypeTabs';

/**
 * 로그인하면 처음 보는 화면.
 *
 * 다른 화면에 들어가 봐야 알 수 있던 것들을 한 자리에 모은다. 실적 구간에 카드를
 * 얼마나 썼는지, 이 달 예산을 얼마나 썼는지. 그 달의 거래 목록은 두지 않는다 -- 거래
 * 화면이 같은 것을 더 넓게 보여 준다 (2026-10-05 사용자 요청).
 *
 * 자산이 얼마인지는 자산 화면이 답한다. 두 화면이 같은 금액을 그리면 어느 쪽이
 * 제자리인지 흐려지고, 홈은 달을 옮기며 보는 자리라 "지금 얼마인가"와 섞인다.
 *
 * 여기서 고치는 것은 없다. 숫자를 누르러 가는 화면은 가계와 자산이고, 홈은
 * 그 화면들을 열기 전에 훑는 자리다.
 */
export default function HomePage() {
  const { t } = useTranslation();
  const selectedProjectId = useProjectGuard();
  const { selectedPersonIds, togglePersonId } = useUserFilter();
  const timeZone = useProjectTimeZone();
  const router = useRouter();
  /* 예산 설정의 톱니는 고칠 수 있는 사람에게만 선다. */
  const canEdit = useCanEdit();

  /*
   * 보고 있는 달. 아래 예산·거래 목록이 모두 이 달을 따른다.
   *
   * 위쪽 실적 구간 카드는 따라가지 않는다. 카드사가 지금 세고 있는 구간이라
   * 지난 달을 펴 보는 것과 뜻이 다르다.
   */
  const { year: thisYear, month: thisMonth } = currentYearMonth(timeZone);
  const [view, setView] = useState({ year: thisYear, month: thisMonth });
  const { year, month } = view;
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  const thisYearMonth = `${thisYear}-${String(thisMonth).padStart(2, '0')}`;
  /*
   * 달 줄부터 아래(예산 상자들)를 가로로 끌면 달을 넘긴다 -- 달 줄의 ‹ › 와 같은 일이다
   * (2026-10-08 사용자 요청, 앱과 같다). 위쪽 실적 구간 카드는 감싸지 않는다. 그 줄은
   * 가로로 끌면 카드를 넘긴다. 앞 값에서 옮겨, 다시 그리기 전에 두 번 넘겨도 두 달이 간다.
   */
  const swipeRef = usePeriodSwipe<HTMLElement>((delta) =>
    setView((prev) => {
      const from = `${prev.year}-${String(prev.month).padStart(2, '0')}`;
      const [nextYear, nextMonth] = shiftYearMonth(from, delta).split('-').map(Number);
      return { year: nextYear, month: nextMonth };
    }),
  );

  /* 화면이 보는 값 전부. 앱의 홈 화면도 같은 훅을 쓴다. */
  const home = useHomeData({ projectId: selectedProjectId, year, month, thisYearMonth });
  const {
    people,
    peopleLoaded,
    cards,
    accounts,
    categories,
    myPersonId,
    budgets,
    methods,
    isLoading,
    hasError,
    entryVersion,
  } = home;

  /*
   * 분류 예산 상자가 지출을 볼지 수입을 볼지. 탭은 그 상자 안에 있다.
   *
   * 지출부터 본다. 홈을 여는 까닭은 대개 "이 달에 얼마나 썼나"이고, 수입은 달마다
   * 크게 흔들리지 않는다. 태그 예산 상자는 이 값을 따르지 않는다.
   */
  const [type, setType] = useState<EntryType>('expense');
  /*
   * 예산 줄을 눌러 연 분석. 거래 탭 년월 줄의 분석 아이콘이 여는 것과 같은 화면(AnalysisView)을
   * 이 자리에 그린다 (2026-10-09 사용자 요청) -- 지출 줄은 지출을 걸고 지출 탭, 수입 줄은 수입을
   * 걸고 수입 탭, 태그 줄은 그 태그를 걸고 합계 탭이다 (`budgetAnalysisInitial`). 머리글에는 ← 만
   * 서고, 그것이나 브라우저 뒤로가기로 돌아오면 예산 화면이 떠날 때 그대로다.
   */
  const [analysis, setAnalysis] = useState<AnalysisInitial | null>(null);
  const rememberScroll = useSwapScroll(analysis !== null);
  const openAnalysis = (target: { id: string }, targetType: EntryType) => {
    rememberScroll();
    setAnalysis(budgetAnalysisInitial(target.id, targetType, yearMonth));
  };
  /** 분석에서 거래를 고쳤을 수 있어 돌아올 때 예산을 다시 받는다. */
  const closeAnalysis = () => {
    setAnalysis(null);
    home.reloadEntries();
  };
  useCloseOnBack(analysis !== null, closeAnalysis);
  /** 거래 상세·수정 팝업. 가계·자산 화면과 같은 컴포넌트다. */
  const entryEditorRef = useRef<EntryEditorHandle>(null);

  /*
   * 실적 구간 카드를 눌러 연 카드 상세. 자산 화면에서 카드를 누를 때 나오는 상자를 팝업으로
   * 띄운다(2026-10-05 사용자 요청) -- 화면을 옮기지 않으므로 닫으면 예산 화면 그대로다.
   *
   * id 만 들고 목록에서 다시 찾는다. 대금을 기록해 목록을 다시 읽으면 새 값으로 그린다.
   * 못 찾으면(숨긴 카드 등) 팝업을 열지 않는다.
   */
  const [detailCardId, setDetailCardId] = useState<string | null>(null);
  const detailCard = cards.find((card) => card.id === detailCardId);

  /**
   * 카드 원장 줄을 눌렀을 때. 원장 줄은 전표 id 만 들고 있어 그 거래를 읽어 상세를 연다
   * (자산 화면과 같다). 못 읽으면 아무것도 열지 않는다.
   */
  const openLedgerEntry = useCallback((entryId: string) => {
    void apiClient
      .getEntry(entryId)
      .then((entry) => entryEditorRef.current?.openDetail(entry))
      .catch(() => {});
  }, []);

  /* 분석을 펴 둔 동안에는 그것만 그린다 (거래 화면의 분석과 같은 짜임). */
  if (analysis) {
    return <AnalysisView projectId={selectedProjectId} initial={analysis} onBack={closeAnalysis} />;
  }

  return (
    <div className="space-y-6">
      {hasError && (
        <div className="p-3 bg-red-50 text-red-800 text-sm rounded-lg">{t('home.loadFailed')}</div>
      )}

      {peopleLoaded && people.length === 0 && (
        <p className="text-gray-600">{t('home.noPeople')}</p>
      )}

      {/*
        화면의 첫 줄이자 제목이다. 이름을 누르면 자산주인을 고른다.

        자산 금액은 자산 화면으로 옮겼다. 제목은 남긴다. 아래 예산·그래프·거래가
        모두 여기서 고른 자산주인을 따르므로, 이 줄을 빼면 홈에서 보는 범위를
        홈에서 바꿀 수 없다. 이름은 자산이 아니라 화면 이름인 "홈"이다.
      */}
      <PageHeader
        title={
          <PersonScopeTitle
            noun={t('nav.home')}
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
            onSelect={(method) => setDetailCardId(method.id)}
          />
        )}
      </section>

      <section ref={swipeRef} className="space-y-3">
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
          그 탭을 따르는 것처럼 읽힌다. 탭에는 금액을 적지 않는다.
        */}
        <MonthlyBudgetSummary
          budgets={budgets}
          categories={categories}
          type={type}
          onTypeChange={setType}
          onSelect={(target) => openAnalysis(target, type)}
          onOpenSettings={
            canEdit ? () => router.push(budgetSettingsHref(yearMonth, type)) : undefined
          }
        />

        {/*
          태그 예산. 분류 예산과 상자를 나눈다. 지출·수입 탭을 따르지 않는다 -- 태그 예산은
          쓴 돈에서 돌려받은 돈을 뺀 한 금액이다.
        */}
        <TagBudgetSummary
          tagBudgets={home.tagBudgets}
          /* 태그 줄은 유형을 걸지 않는다. 넘기는 유형은 쓰이지 않는다. */
          onSelect={(target) => openAnalysis(target, 'expense')}
          onOpenSettings={
            canEdit ? () => router.push(tagBudgetSettingsHref(yearMonth)) : undefined
          }
        />
      </section>

      {detailCard && (
        <Modal
          isOpen
          onClose={() => setDetailCardId(null)}
          title={detailCard.name}
          /* 실적·청구 막대 그래프가 들어 있어 넓은 창을 쓴다. */
          wide
        >
          <div className="space-y-4">
            {detailCard.issuer?.name && (
              <p className="text-sm text-gray-600">{detailCard.issuer.name}</p>
            )}
            <CardDetailBody
              card={detailCard}
              accounts={accounts}
              reloadToken={entryVersion}
              /* 대금을 기록하면 거래가 생긴다. 위 카드 사용액과 예산도 함께 다시 읽는다. */
              onChange={home.reloadEntries}
              onOpenEntry={openLedgerEntry}
            />
          </div>
        </Modal>
      )}

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
