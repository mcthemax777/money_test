'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BudgetDto, CardDto, EntryFilterQuery } from '@money/types';
import type { Account, Card, Category, Person } from '@money/core/lib/types';

import {
  currentYearMonth,
  dateMarkerKey,
  formatMonthShort,
  monthQueryRange,
} from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import { useHomeData } from '@money/core/hooks/useHomeData';
import { useProjectGuard } from '@/hooks/useProjectGuard';
import {
  useCanEdit,
  useProjectDisplayCurrency,
  useProjectTimeZone,
} from '@money/core/store/project';
import { budgetSettingsHref, tagBudgetSettingsHref } from '@money/core/lib/budget';
import { useUserFilter } from '@money/core/store/user-filter';
import EntryFeed from '@/components/EntryFeed';
import CardSettlementPanel from '@/components/CardSettlementPanel';
import EntryEditor, {
  type EntryEditorHandle,
  type ReferenceDataPatch,
} from '@/components/EntryEditor';
import Modal from '@/components/Modal';
import { BudgetDetailModal } from '@/components/BudgetDetailModal';
import { useLedgerBasis } from '@money/core/store/ledger-basis';
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
 * 얼마나 썼는지, 이 달 예산을 얼마나 썼는지, 이 달에 무엇을 샀는지.
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
  const displayCurrency = useProjectDisplayCurrency();
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
  const monthRange = monthQueryRange(year, month, timeZone);

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
    summary,
    methods,
    filter: appliedFilter,
    isLoading,
    hasError,
    cardVersion,
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
   * 예산 줄을 눌러 연 상세 분석. 가계 분류별에서 분류를 누를 때와 같은 패널을 팝업으로 띄운다.
   *
   * 세는 기준(회차·발생)도 가계와 같은 값을 싣는다. 같은 분류를 두 화면에서 열었는데
   * 금액이 다르면 어느 쪽이 맞는지 따지게 된다.
   */
  const [detailTarget, setDetailTarget] = useState<{ id: string; name: string } | null>(null);
  const basis = useLedgerBasis((state) => state.basis);
  const detailFilter = useMemo(() => ({ ...appliedFilter, basis }), [appliedFilter, basis]);
  /** 정산 팝업을 띄울 카드. */
  const [settlementCardId, setSettlementCardId] = useState<string | null>(null);
  /** 거래 상세·수정 팝업. 가계·자산 화면과 같은 컴포넌트다. */
  const entryEditorRef = useRef<EntryEditorHandle>(null);

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
            onSelect={(method) => setSettlementCardId(method.id)}
          />
        )}
      </section>

      <section className="space-y-3">
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
          그 탭을 따르는 것처럼 읽힌다. 탭에는 이 달의 두 합계를 함께 적는다.
        */}
        <MonthlyBudgetSummary
          budgets={budgets}
          type={type}
          onTypeChange={setType}
          onSelect={setDetailTarget}
          expenseTotal={formatCurrency(toNumber(summary?.expense), displayCurrency)}
          incomeTotal={formatCurrency(toNumber(summary?.income), displayCurrency)}
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
          onSelect={setDetailTarget}
          onOpenSettings={
            canEdit ? () => router.push(tagBudgetSettingsHref(yearMonth)) : undefined
          }
        />
      </section>

      {detailTarget && (
        <BudgetDetailModal
          isOpen
          onClose={() => setDetailTarget(null)}
          categoryId={detailTarget.id}
          categoryName={detailTarget.name}
          categories={categories}
          period={{ yearMonth }}
          projectId={selectedProjectId}
          filter={detailFilter}
          onEntryClick={(entry) => entryEditorRef.current?.openDetail(entry)}
          reloadToken={entryVersion}
        />
      )}

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
