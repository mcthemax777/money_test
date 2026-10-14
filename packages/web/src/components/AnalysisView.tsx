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
import { memo, startTransition, useEffect, useState } from 'react';
import { Search } from 'lucide-react';

import {
  useAnalysis,
  type AnalysisInitial,
  type AnalysisKind,
} from '@money/core/hooks/useAnalysis';
import { totalIdOf } from '@money/core/hooks/useCategoryDetail';
import { usePersonFilterSync } from '@money/core/hooks/usePersonFilterSync';
import { useScreenReturn } from '@money/core/hooks/useScreenReturn';
import type { TransactionSearch } from '@money/core/hooks/useTransactions';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { useMyPersonId } from '@money/core/store/project';
import { useUserFilter } from '@money/core/store/user-filter';

import { BudgetDetailModal } from '@/components/BudgetDetailModal';
import NavIcon from '@/components/NavIcon';
import NetAnalysisPanel from '@/components/NetAnalysisPanel';
import PageHeader from '@/components/PageHeader';
import PeriodNavigator from '@/components/PeriodNavigator';
import { usePeriodSwipe } from '@/hooks/usePeriodSwipe';
import PersonScopeTitle from '@/components/PersonScopeTitle';
import RevealTop from '@/components/RevealTop';
import SearchChips from '@/components/SearchChips';
import TransactionSearchModal from '@/components/TransactionSearchModal';
import TransactionsView from '@/components/TransactionsView';
import { useCloseOnBack } from '@/hooks/useCloseOnBack';
import { useSwapScroll } from '@/hooks/useSwapScroll';
import { useTopReveal } from '@/hooks/useTopReveal';
import LoadingBlock from '@/components/LoadingBlock';
import { RevealScope } from '@/components/ChartReveal';
import { useStableCallback } from '@money/core/hooks/useStableCallback';
import type { MethodSlice } from '@money/core/lib/usage-pattern';
import { ScreenVisibility } from '@/components/ScreenVisible';

/*
 * 분석 탭의 지출·수입 그래프 묶음. 한 번 연 탭을 숨겨 두므로, 탭을 누를 때 숨은 탭까지 다시 그리지
 * 않게 받은 값이 그대로면 다시 그리지 않는다 (2026-10-15 사용자 요청, 앱과 같다).
 */
const AnalysisDetail = memo(BudgetDetailModal);
/** 끼워 그린 상세에는 닫을 것이 없다. 그래프 묶음이 memo 라 고정된 함수를 넘긴다. */
const noop = () => undefined;

const TABS: Array<{ id: AnalysisKind; labelKey: MessageKey }> = [
  { id: 'net', labelKey: 'analysis.tab.net' },
  { id: 'expense', labelKey: 'analysis.tab.expense' },
  { id: 'income', labelKey: 'analysis.tab.income' },
];

export default function AnalysisView({
  projectId,
  initial,
  onBack,
  canOpenEntries = false,
}: {
  projectId: string | null;
  /** 거래 탭에서 열 때의 검색·단위·세는 방식·기간. 없으면 분석 탭이다. */
  initial?: AnalysisInitial;
  /** 주면 머리글에 ← 만 선다. 부르는 쪽이 돌아가는 일을 맡는다. */
  onBack?: () => void;
  /**
   * ← 와 함께 오른쪽 위에 거래내역 단추를 세운다 -- 예산 화면이 연 분석이다 (2026-10-09 사용자
   * 요청). 거래 탭이 연 분석은 주지 않는다 -- 그 아래에 이미 거래 화면이 있다.
   */
  canOpenEntries?: boolean;
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

  /**
   * 한 번 연 탭(합계·지출·수입). 숨겨 두고 다시 누르면 곧바로 보인다 (2026-10-15 사용자 요청 --
   * 탭을 누를 때마다 그래프 묶음을 새로 그려 반응이 늦었다, 앱과 같다). 처음 여는 탭은 다음 그림에
   * 더해 탭 표시가 먼저 옮겨 간다.
   */
  const [openedKinds, setOpenedKinds] = useState<AnalysisKind[]>(() => [analysis.kind]);
  useEffect(() => {
    if (openedKinds.includes(analysis.kind)) return;
    /*
     * 두 그림 뒤에 더한다. 탭 표시와 돌림 표시가 화면에 먼저 그려진 뒤에 그래프 묶음을 그려야
     * 기다리는 동안 돌림 표시가 보인다 -- 한 그림 뒤면 그 그림이 미처 칠해지기 전에 바빠진다.
     */
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() =>
        setOpenedKinds((prev) => (prev.includes(analysis.kind) ? prev : [...prev, analysis.kind])),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [analysis.kind, openedKinds]);
  /** 그릴 구간. 탭마다 그리는 자리(아래 map)까지 null 이 아님이 이어지게 따로 든다. */
  const shownPeriod = analysis.period;

  const [isSearchOpen, setIsSearchOpen] = useState(false);

  /*
   * 위에 덮어 여는 화면 둘 (2026-10-10 사용자 요청). 덮은 동안에는 그것만 그리고, 그 머리글의 ← 나
   * 브라우저 뒤로가기로 닫으면 이 화면이 떠날 때 그대로 돌아온다(아래에서 그리기만 바꾼다).
   *
   *   거래내역   걸어 둔 검색·묶는 단위에 **보고 있는 날들을 기간으로 더한** 거래 화면이다
   *              (`entriesSearch`). 조건을 고칠 수 없고(locked) 분석으로 가는 단추도 없다 --
   *              그 아래에 이 분석이 있다.
   *   원형 목록 줄  그 분류·수단으로 좁힌 새 분석이다 (`pickCategory`·`pickMethod`).
   *   일별 누적 아래 줄  그 선의 첫날부터 그 날까지로 좁힌 같은 거래 화면이다 (`openDay`, 2026-10-14 사용자 요청).
   */
  /** 덮어 연 거래 화면의 검색. null 이면 덮지 않았다. */
  const [entriesSearch, setEntriesSearch] = useState<TransactionSearch | null>(null);
  const [picked, setPicked] = useState<AnalysisInitial | null>(null);
  const isCovered = entriesSearch !== null || picked !== null;
  /* 펴면 맨 위로, 돌아오면 보던 자리로 (거래 화면의 분석과 같다). */
  const rememberScroll = useSwapScroll(isCovered);
  const returnClass = useScreenReturn(isCovered) ? 'screen-return' : '';
  const openEntries = (search: TransactionSearch = analysis.entriesSearch) => {
    rememberScroll();
    setEntriesSearch(search);
  };
  /** 일별 누적 아래 줄의 구간(그 선의 첫날~그 날). 지출·수입 탭이면 그 유형도 건다. */
  const openDay = useStableCallback((range: { from: string; to: string }) =>
    openEntries(analysis.cumulativeEntriesSearch(range)),
  );
  /* 그래프 묶음이 memo 라 함수를 고정해 넘긴다 (useStableCallback). */
  const pickCategory = useStableCallback((pickId: string) =>
    openPicked(analysis.pickCategory(pickId)),
  );
  const pickMethod = useStableCallback((method: MethodSlice) =>
    openPicked(analysis.pickMethod(method)),
  );
  const openPicked = (next: AnalysisInitial) => {
    rememberScroll();
    setPicked(next);
  };
  /** 덮은 화면에서 거래를 고쳤을 수 있어 돌아올 때 기간 줄 금액을 다시 받는다. */
  /**
   * 덮은 화면에서 거래를 고쳤을 수 있다. 돌아올 때 올려 그래프도 다시 받게 한다 (2026-10-16) -- 웹은
   * 사본 신호가 없고 그래프 묶음은 숨겨 둔 채 살아 있어, 올리지 않으면 요약만 새 값이고 그래프는
   * 옛 숫자로 남았다.
   */
  const [reloadToken, setReloadToken] = useState(0);
  const closeCover = () => {
    setEntriesSearch(null);
    setPicked(null);
    tx.reload();
    setReloadToken((token) => token + 1);
  };
  useCloseOnBack(isCovered, closeCover);

  /*
   * 기간 줄부터 아래(그래프)를 가로로 끌면 기간을 넘긴다 -- 기간 줄의 ‹ › 와 같은 일이다 (2026-10-09
   * 사용자 요청, 예산 화면과 같은 손짓, 앱과 같다). 위쪽 탭 줄은 감싸지 않는다. 직접 정한 기간은 옮길
   * 앞뒤가 없어 손을 가져오지 않는다.
   */
  const swipeRef = usePeriodSwipe<HTMLDivElement>(
    (delta) => analysis.shift(delta),
    analysis.unit !== 'range',
  );

  /**
   * 탭 표시. 누르면 이것부터 옮기고 내용 전환은 뒤로 미룬다(startTransition) -- 같은 그림에서
   * 그래프 묶음까지 바꾸면 다 그릴 때까지 누른 표시가 늦게 바뀐다 (2026-10-15 사용자 요청, 앱과
   * 같다). 다른 길로 탭이 바뀌면(덮어 연 분석의 처음 탭) 그쪽을 따른다.
   */
  const [selectedKind, setSelectedKind] = useState(analysis.kind);
  useEffect(() => setSelectedKind(analysis.kind), [analysis.kind]);
  const selectKind = (kind: AnalysisKind) => {
    setSelectedKind(kind);
    startTransition(() => analysis.setKind(kind));
  };
  const activeTabIndex = Math.max(
    0,
    TABS.findIndex((item) => item.id === selectedKind),
  );

  /*
    거래내역·좁힌 분석을 덮어도
    아래 화면은 지우지 않고 숨겨 둔다 (2026-10-15 사용자 요청 -- 팝업처럼). 받아 둔 값·펼침·고른
    탭이 그대로 남아 닫으면 다시 받지 않고, 숨어 있는 동안에도 다른 기기의 변경을 받는다.
  */
  return (
    <>
      {entriesSearch ? (
        <div className="screen-push">
          <TransactionsView
            projectId={projectId}
            search={entriesSearch}
            unit={tx.unit}
            locked
            onBack={closeCover}
          />
        </div>
      ) : picked ? (
        <div className="screen-push">
          <AnalysisView projectId={projectId} initial={picked} onBack={closeCover} />
        </div>
      ) : null}
    <div className={`space-y-4 ${isCovered ? 'hidden' : returnClass}`}>
      <ScreenVisibility visible={!isCovered}>
      <RevealScope visible={!isCovered}>
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
            다른 화면에서 덮어 열었으면 ← 만 둔다. 조건은 연 쪽에서 걸고 오는 것이고, 거래 탭에서
            열었으면 그 아래에 이미 거래 화면이 있다.
          */
          action={
            onBack ? (
              canOpenEntries ? (
                <button
                  type="button"
                  onClick={() => openEntries()}
                  aria-label={t('analysis.toTransactions')}
                  title={t('analysis.toTransactions')}
                  className="flex items-center justify-center p-2 text-gray-600"
                >
                  <NavIcon name="transactions" className="h-4 w-4" />
                </button>
              ) : undefined
            ) : (
              <div className="flex gap-2">
                {/*
                  거래내역. 거래 탭의 보관함·달력 자리다 -- 분석에서 본 것을 같은 검색으로 낱낱의
                  거래로 확인하러 가는 길이다 (openEntries).
                */}
                <button
                  type="button"
                  onClick={() => openEntries()}
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
          탭과 걸어 둔 조건. 한 상자에 묶어, 조건이 걸려 있으면 내려가는 동안에도 이 상자는
          화면 위에 남는다(useTopReveal 의 keepRef). 조건이 없으면 통째로 비켜선다.
        */}
        <div ref={tx.searchChips.length > 0 ? topReveal.keepRef : undefined} className="space-y-4">
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
                onClick={() => selectKind(item.id)}
                aria-pressed={selectedKind === item.id}
                className={`relative flex flex-1 items-center justify-center rounded-md px-4 py-2 font-medium ${
                  selectedKind === item.id ? 'text-blue-600' : 'text-gray-600'
                }`}
              >
                {t(item.labelKey)}
              </button>
            ))}
          </div>
          {/*
            걸려 있는 조건. 탭 **아래** 둔다(2026-10-07 사용자 요청). 누르면 그 조건만 빠진다. 거래
            탭·원형 목록 줄이 덮어 연 보기도 같다(2026-10-10 사용자 요청). 그 보기의 조건은 제 것이라
            빼도 아래의 화면에는 번지지 않는다.
          */}
          <SearchChips chips={tx.searchChips} onRemove={tx.removeSearchChip} />
        </div>
      </RevealTop>

      <div ref={swipeRef} className="space-y-4">
        <PeriodNavigator periodKey={analysis.periodKey} onChange={analysis.setPeriodKey} />

        {analysis.isPeriodPending ? (
          <LoadingBlock label={t('common.loading')} />
        ) : !shownPeriod ? (
          <p className="py-8 text-center text-sm text-gray-500">{t('tx.analysisOutOfRange')}</p>
        ) : (
          /*
            탭을 옮기면 새 내용이 옅은 데서 떠오른다 (`unfold` -- display 가 돌아올 때마다 다시 돈다).
            한 번 연 탭은 지우지 않고 숨겨 둔다(`openedKinds`).
          */
          TABS.filter((tab) => openedKinds.includes(tab.id)).map(({ id: kind }) => (
          <div key={kind} className={kind === analysis.kind ? 'unfold' : 'hidden'}>
            {/* 다시 보일 때 안의 그래프도 다시 그려진다 (ChartReveal). */}
            <RevealScope visible={kind === analysis.kind}>
            {kind === 'net' ? (
              <NetAnalysisPanel
                active={kind === analysis.kind}
                totals={analysis.totals}
                categories={tx.pickerCategories}
                period={shownPeriod}
                projectId={projectId}
                filter={analysis.filter}
                trendClip={analysis.trendClip}
                trendPeriod={analysis.trendPeriod}
                reloadToken={reloadToken}
                onOpenDay={openDay}
              />
            ) : (
              <AnalysisDetail
                /* 숨은 탭은 받지 않는다 (앱 CategoryDetailView 의 active 와 같다). */
                isOpen={kind === analysis.kind}
                onClose={noop}
                isInline
                categoryId={totalIdOf(kind)}
                categoryName=""
                categories={tx.pickerCategories}
                period={shownPeriod}
                projectId={projectId}
                filter={analysis.filter}
                trendClip={analysis.trendClip}
                trendPeriod={analysis.trendPeriod}
                reloadToken={reloadToken}
                /*
                  원형 목록 줄을 누르면 그 분류·수단으로 좁힌 분석을 위에 덮어 연다. 분석 탭이든 거래
                  탭·예산 화면에서 건너온 보기든 같다 (2026-10-10 사용자 요청).
                */
                onPickCategory={pickCategory}
                onPickMethod={pickMethod}
                onOpenDay={openDay}
              />
            )}
            </RevealScope>
          </div>
          )).concat(
            /* 처음 여는 탭은 두 그림 뒤에 선다(`openedKinds`). 그동안 그 자리에서 돈다. */
            openedKinds.includes(analysis.kind)
              ? []
              : [<LoadingBlock key="opening" label={t('detail.loading')} />],
          )
        )}
      </div>

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
      </RevealScope>
      </ScreenVisibility>
    </div>
    </>
  );
}
