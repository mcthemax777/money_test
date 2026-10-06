'use client';

/*
 * 분석. 거래 탭과 같은 조건으로 한 기간의 돈을 그래프로 본다 (앱의 AnalysisScreen 과 같은 짝).
 *
 * 짜임은 거래 탭을 따른다. 머리글(자산주인·거래내역·검색·더보기), 걸어 둔 조건 알약, 그 아래
 * 탭이다. 다른 것은 둘이다 -- 탭이 날짜별·분류별·수단별 대신 **합계·지출·수입**이고, 그 아래에
 * 기간 줄과 거래내역 대신 **한 기간의 분석**이 선다.
 *
 * 값과 상태는 core 의 `useAnalysis` 가 갖는다.
 */
import { useRef, useState } from 'react';
import { List, MoreVertical, Search, X } from 'lucide-react';

import { useAnalysis, type AnalysisKind } from '@money/core/hooks/useAnalysis';
import { totalIdOf } from '@money/core/hooks/useCategoryDetail';
import { usePersonFilterSync } from '@money/core/hooks/usePersonFilterSync';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { useMyPersonId } from '@money/core/store/project';
import { useUserFilter } from '@money/core/store/user-filter';

import BasisPicker from '@/components/BasisPicker';
import { BudgetDetailModal } from '@/components/BudgetDetailModal';
import EntryEditor, { type EntryEditorHandle, type ReferenceDataPatch } from '@/components/EntryEditor';
import Modal from '@/components/Modal';
import NetAnalysisPanel from '@/components/NetAnalysisPanel';
import PageHeader from '@/components/PageHeader';
import PeriodNavigator from '@/components/PeriodNavigator';
import PeriodUnitPicker from '@/components/PeriodUnitPicker';
import PersonScopeTitle from '@/components/PersonScopeTitle';
import TransactionSearchModal from '@/components/TransactionSearchModal';
import TransactionsView from '@/components/TransactionsView';
import { useCloseOnBack } from '@/hooks/useCloseOnBack';

const TABS: Array<{ id: AnalysisKind; labelKey: MessageKey }> = [
  { id: 'net', labelKey: 'analysis.tab.net' },
  { id: 'expense', labelKey: 'analysis.tab.expense' },
  { id: 'income', labelKey: 'analysis.tab.income' },
];

export default function AnalysisView({ projectId }: { projectId: string | null }) {
  const { t } = useTranslation();
  const myPersonId = useMyPersonId();
  const selectedPersonIds = useUserFilter((state) => state.selectedPersonIds);
  const togglePersonId = useUserFilter((state) => state.togglePersonId);

  const analysis = useAnalysis(projectId);
  const { tx } = analysis;
  // 사람 목록과 선택을 프로젝트에 맞춘다. 다른 화면과 같은 훅을 쓴다.
  usePersonFilterSync(projectId, tx.people);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  /** 더보기. 묶는 단위와 세는 방식을 고른다 (거래 탭의 더보기 위쪽 둘과 같다). */
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  /** 분석의 거래를 눌러 연 상세·고치기 창. 예산 화면의 분류 상세와 같은 길이다. */
  const entryEditorRef = useRef<EntryEditorHandle>(null);
  const [refPatch, setRefPatch] = useState<ReferenceDataPatch>({});
  /** 이 화면에서 거래를 고치면 올린다. 그래프가 다시 받는다. */
  const [reloadToken, setReloadToken] = useState(0);

  /*
   * 거래내역을 펼쳐 둔 동안에는 그것만 그린다. 자산 상세의 "거래내역 보기"와 같은 규칙이다 --
   * 걸어 둔 검색·묶는 단위·세는 방식 그대로 거래 화면이 서고, 그 머리글의 ← 나 브라우저 뒤로가기로 돌아온다.
   * 이 화면이 그대로 세워져 있어(아래에서 그리기만 바꾼다) 돌아오면 검색·단위·기간·탭이
   * 떠날 때 그대로다.
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
        search={tx.search}
        unit={tx.unit}
        basis={tx.basis}
        onBack={closeEntries}
      />
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <PersonScopeTitle
            noun={t('analysis.noun')}
            people={tx.people}
            myPersonId={myPersonId}
            selectedPersonIds={selectedPersonIds}
            onTogglePerson={togglePersonId}
          />
        }
        action={
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
              <List className="h-4 w-4" aria-hidden />
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
            <button
              type="button"
              onClick={() => setIsMoreOpen(true)}
              aria-label={t('tx.more')}
              title={t('tx.more')}
              className="flex items-center justify-center p-2 text-gray-600"
            >
              <MoreVertical className="h-4 w-4" aria-hidden />
            </button>
          </div>
        }
      />

      {tx.hasError ? (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{t('tx.loadFailed')}</div>
      ) : null}

      {/* 걸려 있는 조건. 거래 탭과 같이 탭 위에 두고, 누르면 그 조건만 빠진다. */}
      {tx.searchChips.length > 0 ? (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {tx.searchChips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => tx.removeSearchChip(chip.id)}
              aria-label={`${chip.label} ${t('tx.search.chipRemove')}`}
              title={t('tx.search.chipRemove')}
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-blue-200 bg-blue-50 py-1.5 pl-3 pr-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
            >
              {chip.label}
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          ))}
        </div>
      ) : null}

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
        onApply={tx.setSearch}
        current={tx.search}
        categories={tx.pickerCategories}
        accounts={tx.pickerAccounts}
        cards={tx.pickerCards}
        tags={tx.pickerTags}
        people={tx.people}
        unit={tx.unit}
      />

      {/* 더보기. 묶는 단위와 세는 방식뿐이다 -- 고르고 지우는 일은 거래 탭의 것이다. */}
      <Modal isOpen={isMoreOpen} onClose={() => setIsMoreOpen(false)} title={t('tx.more')}>
        <PeriodUnitPicker value={tx.unit} onChange={tx.changeUnit} />
        <BasisPicker value={tx.basis} onChange={tx.setBasis} />
      </Modal>

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
