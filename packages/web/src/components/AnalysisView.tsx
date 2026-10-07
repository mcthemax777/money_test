'use client';

/*
 * 분석. 거래 탭과 같은 조건으로 한 기간의 돈을 그래프로 본다 (앱의 AnalysisScreen 과 같은 짝).
 *
 * 짜임은 거래 탭을 따른다. 머리글(자산주인·거래내역·검색), 걸어 둔 조건 알약, 그 아래
 * 탭이다. 다른 것은 둘이다 -- 탭이 날짜별·분류별·수단별 대신 **합계·지출·수입**이고, 그 아래에
 * 기간 줄과 거래내역 대신 **한 기간의 분석**이 선다.
 *
 * 값과 상태는 core 의 `useAnalysis` 가 갖는다.
 *
 * 거래 탭 년월 줄의 분석 아이콘도 이 화면을 연다(`initial`·`onBack`). 그때는 거래 탭의 검색·
 * 단위·세는 방식과 그 줄의 기간으로 서고, 머리글에는 ← 하나만 선다 -- 분석 탭의 거래내역
 * 단추가 거래 화면을 여는 것과 방향만 반대인 같은 길이다.
 */
import { useRef, useState } from 'react';
import { Search } from 'lucide-react';

import {
  useAnalysis,
  type AnalysisInitial,
  type AnalysisKind,
} from '@money/core/hooks/useAnalysis';
import { totalIdOf } from '@money/core/hooks/useCategoryDetail';
import { usePersonFilterSync } from '@money/core/hooks/usePersonFilterSync';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { useMyPersonId } from '@money/core/store/project';
import { useUserFilter } from '@money/core/store/user-filter';

import { BudgetDetailModal } from '@/components/BudgetDetailModal';
import EntryEditor, { type EntryEditorHandle, type ReferenceDataPatch } from '@/components/EntryEditor';
import NavIcon from '@/components/NavIcon';
import NetAnalysisPanel from '@/components/NetAnalysisPanel';
import PageHeader from '@/components/PageHeader';
import PeriodNavigator from '@/components/PeriodNavigator';
import PersonScopeTitle from '@/components/PersonScopeTitle';
import RevealTop from '@/components/RevealTop';
import SearchChips from '@/components/SearchChips';
import TransactionSearchModal from '@/components/TransactionSearchModal';
import TransactionsView from '@/components/TransactionsView';
import { useCloseOnBack } from '@/hooks/useCloseOnBack';
import { useTopReveal } from '@/hooks/useTopReveal';

const TABS: Array<{ id: AnalysisKind; labelKey: MessageKey }> = [
  { id: 'net', labelKey: 'analysis.tab.net' },
  { id: 'expense', labelKey: 'analysis.tab.expense' },
  { id: 'income', labelKey: 'analysis.tab.income' },
];

export default function AnalysisView({
  projectId,
  initial,
  onBack,
}: {
  projectId: string | null;
  /** 거래 탭에서 열 때의 검색·단위·세는 방식·기간. 없으면 분석 탭이다. */
  initial?: AnalysisInitial;
  /** 주면 머리글에 ← 만 선다. 부르는 쪽이 돌아가는 일을 맡는다. */
  onBack?: () => void;
}) {
  const { t } = useTranslation();
  const myPersonId = useMyPersonId();
  const selectedPersonIds = useUserFilter((state) => state.selectedPersonIds);
  const togglePersonId = useUserFilter((state) => state.togglePersonId);

  const analysis = useAnalysis(projectId, { initial });
  /** 위쪽 덩어리를 내릴 때 비켜서게 한다. 조건 알약 줄부터는 남는다. */
  const topReveal = useTopReveal<HTMLDivElement>();
  const { tx } = analysis;
  // 사람 목록과 선택을 프로젝트에 맞춘다. 다른 화면과 같은 훅을 쓴다.
  usePersonFilterSync(projectId, tx.people);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  /** 분석의 거래를 눌러 연 상세·고치기 창. 예산 화면의 분류 상세와 같은 길이다. */
  const entryEditorRef = useRef<EntryEditorHandle>(null);
  const [refPatch, setRefPatch] = useState<ReferenceDataPatch>({});
  /** 이 화면에서 거래를 고치면 올린다. 그래프가 다시 받는다. */
  const [reloadToken, setReloadToken] = useState(0);

  /*
   * 거래내역을 펼쳐 둔 동안에는 그것만 그린다. 자산 상세의 "거래내역 보기"와 같은 규칙이다 --
   * 걸어 둔 검색·묶는 단위에 **보고 있는 날들을 기간으로 더한** 거래 화면이 서고(`entriesSearch`),
   * 그 머리글의 ← 나 브라우저 뒤로가기로 돌아온다. 그 화면은 조건을 고칠 수 없다(locked) --
   * 거래 탭의 분석 아이콘이 연 분석과 같은 규칙이다 (2026-10-07 사용자 요청). 이 화면이 그대로
   * 세워져 있어(아래에서 그리기만 바꾼다) 돌아오면 기간·탭이 떠날 때 그대로다.
   */
  const [isEntriesOpen, setIsEntriesOpen] = useState(false);
  const closeEntries = () => setIsEntriesOpen(false);
  useCloseOnBack(isEntriesOpen, closeEntries);

  const activeTabIndex = Math.max(
    0,
    TABS.findIndex((item) => item.id === analysis.kind),
  );

  if (isEntriesOpen) {
    return (
      <TransactionsView
        projectId={projectId}
        search={analysis.entriesSearch}
        unit={tx.unit}
        locked
        onBack={closeEntries}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/*
        위쪽 한 덩어리 -- 제목, 걸어 둔 조건, 탭. 거래 화면과 같은 규칙이다(`useTopReveal`): 내리는
        동안에는 비켜서고 조금이라도 올리면 되돌아오며, 걸어 둔 조건 알약 줄부터 아래(탭)는
        비켜서지 않는다 -- 무엇으로 그린 그래프인지 내내 보여야 한다 (2026-10-07 사용자 요청).
      */}
      <RevealTop reveal={topReveal}>
        <PageHeader
          onBack={onBack}
          title={
            <PersonScopeTitle
              noun={t('analysis.noun')}
              people={tx.people}
              myPersonId={myPersonId}
              selectedPersonIds={selectedPersonIds}
              onTogglePerson={togglePersonId}
            />
          }
          /*
            거래 탭에서 건너왔으면 ← 만 둔다. 조건은 거래 탭에서 걸고 오는 것이고, 여기서
            거래내역을 다시 열면 거래 화면과 분석이 서로를 겹겹이 연다.
          */
          action={
            onBack ? undefined : (
              <div className="flex gap-2">
                {/*
                  거래내역. 거래 탭의 보관함·달력 자리다 -- 분석에서 본 것을 같은 검색으로 낱낱의
                  거래로 확인하러 가는 길이다 (isEntriesOpen).
                */}
                <button
                  type="button"
                  onClick={() => setIsEntriesOpen(true)}
                  aria-label={t('analysis.toTransactions')}
                  title={t('analysis.toTransactions')}
                  className="flex items-center justify-center p-2 text-gray-600"
                >
                  {/* 아래 메뉴의 거래 탭과 같은 그림이다 -- 같은 곳으로 가는 길이다. */}
                  <NavIcon name="transactions" className="h-4 w-4" />
                </button>
                {/* 검색. 거래 탭과 같은 창이고 같은 규칙으로 걸린다. */}
                <button
                  type="button"
                  onClick={() => setIsSearchOpen(true)}
                  aria-label={t('tx.search')}
                  title={t('tx.search')}
                  className={`flex items-center gap-1.5 px-2 py-2 text-sm font-medium ${
                    tx.searchCount > 0 ? 'text-blue-600' : 'text-gray-600'
                  }`}
                >
                  <Search className="h-4 w-4" aria-hidden />
                  {tx.searchCount > 0 ? <span className="font-semibold">{tx.searchCount}</span> : null}
                </button>
              </div>
            )
          }
        />

        {tx.hasError ? (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{t('tx.loadFailed')}</div>
        ) : null}

        {/*
          걸려 있는 조건. 거래 탭과 같이 탭 위에 두고, 누르면 그 조건만 빠진다. 거래 탭에서
          건너왔으면 무엇으로 그렸는지 알리기만 한다 -- 뺀 조건을 되걸 검색 단추가 없다.
        */}
        <SearchChips
          chips={tx.searchChips}
          onRemove={onBack ? undefined : tx.removeSearchChip}
          boxRef={topReveal.keepRef}
        />

        {/*
          합계·지출·수입. 거래 탭의 날짜별·분류별·수단별 자리와 모양이다 -- 흰 알약 하나가
          미끄러져 옮긴다. 금액은 적지 않는다 (2026-10-06 사용자 요청) -- 합계 탭의 요약이 말한다.
        */}
        <div className="relative flex gap-2 rounded-lg bg-gray-200 p-1">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-1 left-1 rounded-md bg-white transition-transform duration-200 ease-out motion-reduce:transition-none"
            style={{
              width: 'calc((100% - 1.5rem) / 3)',
              transform: `translateX(calc(${activeTabIndex} * (100% + 0.5rem)))`,
            }}
          />
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => analysis.setKind(item.id)}
              aria-pressed={analysis.kind === item.id}
              className={`relative flex flex-1 items-center justify-center rounded-md px-4 py-2 font-medium ${
                analysis.kind === item.id ? 'text-blue-600' : 'text-gray-600'
              }`}
            >
              {t(item.labelKey)}
            </button>
          ))}
        </div>
      </RevealTop>

      <PeriodNavigator periodKey={analysis.periodKey} onChange={analysis.setPeriodKey} />

      {analysis.isPeriodPending ? (
        <p className="py-8 text-center text-sm text-gray-500">{t('common.loading')}</p>
      ) : !analysis.period ? (
        <p className="py-8 text-center text-sm text-gray-500">{t('tx.analysisOutOfRange')}</p>
      ) : (
        /* 탭을 옮기면 새 내용이 옅은 데서 떠오른다 (`unfold`). */
        <div key={analysis.kind} className="unfold">
          {analysis.kind === 'net' ? (
            <NetAnalysisPanel
              totals={analysis.totals}
              categories={tx.pickerCategories}
              period={analysis.period}
              projectId={projectId}
              filter={analysis.filter}
              trendClip={analysis.trendClip}
              trendPeriod={analysis.trendPeriod}
              reloadToken={reloadToken}
            />
          ) : (
            <BudgetDetailModal
              isOpen
              onClose={() => undefined}
              isInline
              categoryId={totalIdOf(analysis.kind)}
              categoryName=""
              categories={tx.pickerCategories}
              period={analysis.period}
              projectId={projectId}
              filter={analysis.filter}
              trendClip={analysis.trendClip}
              trendPeriod={analysis.trendPeriod}
              reloadToken={reloadToken}
              onEntryClick={(entry) => entryEditorRef.current?.openDetail(entry)}
            />
          )}
        </div>
      )}

      <TransactionSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onApply={tx.applySearch}
        current={tx.search}
        categories={tx.pickerCategories}
        accounts={tx.pickerAccounts}
        cards={tx.pickerCards}
        tags={tx.pickerTags}
        people={tx.people}
        unit={tx.unit}
      />

      <EntryEditor
        ref={entryEditorRef}
        projectId={projectId}
        accounts={refPatch.accounts ?? tx.pickerAccounts}
        cards={refPatch.cards ?? tx.pickerCards}
        categories={refPatch.categories ?? tx.pickerCategories}
        people={refPatch.people ?? tx.people}
        onReferenceDataChange={(patch) => setRefPatch((prev) => ({ ...prev, ...patch }))}
        onEntryChange={() => {
          tx.reload();
          setReloadToken((token) => token + 1);
        }}
      />
    </div>
  );
}
