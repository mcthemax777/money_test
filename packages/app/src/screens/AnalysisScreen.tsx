/*
 * 분석. 거래 탭과 같은 조건으로 한 기간의 돈을 그래프로 본다 (웹의 AnalysisView 와 같은 짝).
 *
 * 짜임은 거래 탭을 따른다. 머리글(자산주인·거래내역·검색), 걸어 둔 조건 알약, 그 아래
 * 탭이다. 다른 것은 둘이다 -- 탭이 날짜별·분류별·수단별 대신 **합계·지출·수입**이고, 그 아래에
 * 기간 줄과 거래내역 대신 **한 기간의 분석**이 선다.
 *
 * 값과 상태는 core 의 `useAnalysis` 가 갖는다.
 *
 * 거래 탭 년월 줄의 분석 아이콘도 이 화면을 제자리에 그린다(`initial`·`onBack`). 그때는 거래
 * 탭의 검색·단위·세는 방식과 그 줄의 기간으로 서고, 머리글에는 ← 하나만 선다 -- 분석 탭의
 * 거래내역 단추가 거래 화면을 여는 것과 방향만 반대인 같은 길이다.
 */
import { startTransition, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { Search } from 'lucide-react-native';

import {
  useAnalysis,
  type AnalysisInitial,
  type AnalysisKind,
} from '@money/core/hooks/useAnalysis';
import { totalIdOf } from '@money/core/hooks/useCategoryDetail';
import { usePersonFilterSync } from '@money/core/hooks/usePersonFilterSync';
import type { TransactionSearch } from '@money/core/hooks/useTransactions';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { useMyPersonId, useProject } from '@money/core/store/project';
import { useUserFilter } from '@money/core/store/user-filter';

import CategoryDetailView from '../components/CategoryDetailView';
import NavIcon from '../components/NavIcon';
import NetAnalysisPanel from '../components/NetAnalysisPanel';
import PageHeader from '../components/PageHeader';
import PeriodNavigator from '../components/PeriodNavigator';
import PeriodSwipe from '../components/PeriodSwipe';
import PersonScopeTitle from '../components/PersonScopeTitle';
import SearchChips from '../components/SearchChips';
import SegmentedTabs from '../components/SegmentedTabs';
import TransactionSearchModal from '../components/TransactionSearchModal';
import { useCloseOnBack } from '../shell/navigation';
import RevealTop, { RevealKeep } from '../shell/RevealTop';
import { ScreenPush, ScreenReturn } from '../shell/ScreenSlide';
import { useScrollRestore, useScrollToTop } from '../shell/scroll';
import TransactionsScreen from './TransactionsScreen';
import { RevealScope } from '../components/ChartReveal';
import LoadingBlock from '../components/LoadingBlock';
import { useStableCallback } from '@money/core/hooks/useStableCallback';
import type { MethodSlice } from '@money/core/lib/usage-pattern';

const TABS: Array<{ id: AnalysisKind; labelKey: MessageKey }> = [
  { id: 'net', labelKey: 'analysis.tab.net' },
  { id: 'expense', labelKey: 'analysis.tab.expense' },
  { id: 'income', labelKey: 'analysis.tab.income' },
];

/**
 * 탭 하나의 내용. 보일 때마다 옅은 데서 떠오른다(웹의 `unfold` 와 같은 180ms). 안 보이는 동안에는
 * 지우지 않고 숨겨 둔다 -- 다시 누르면 그리던 그래프가 곧바로 선다 (2026-10-15 사용자 요청: 탭을
 * 누를 때마다 그래프 묶음을 새로 그리느라 반응이 늦었다).
 */
function FadeIn({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) return;
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [opacity, visible]);
  return (
    <Animated.View style={[{ opacity }, visible ? null : { display: 'none' }]}>
      {/* 다시 보일 때 안의 그래프도 다시 그려지듯 움직인다 (ChartReveal). */}
      <RevealScope visible={visible}>{children}</RevealScope>
    </Animated.View>
  );
}

export default function AnalysisScreen({
  initial,
  onBack,
  canOpenEntries = false,
}: {
  /** 거래 탭에서 열 때의 검색·단위·세는 방식·기간. 없으면 분석 탭이다. */
  initial?: AnalysisInitial;
  /** 주면 머리글에 ← 만 선다. 부르는 쪽이 돌아가는 일을 맡는다. */
  onBack?: () => void;
  /**
   * ← 와 함께 오른쪽 위에 거래내역 단추를 세운다 -- 예산 화면이 연 분석이다 (2026-10-09 사용자
   * 요청, 웹과 같다). 거래 탭이 연 분석은 주지 않는다 -- 그 아래에 이미 거래 화면이 있다.
   */
  canOpenEntries?: boolean;
} = {}) {
  const { t } = useTranslation();
  const projectId = useProject((state) => state.selectedProjectId);
  const myPersonId = useMyPersonId();
  const selectedPersonIds = useUserFilter((state) => state.selectedPersonIds);
  const togglePersonId = useUserFilter((state) => state.togglePersonId);

  const analysis = useAnalysis(projectId, { initial });
  const { tx } = analysis;
  // 사람 목록과 선택을 이 프로젝트에 맞춘다 (거래 화면과 같은 훅).
  usePersonFilterSync(projectId, tx.people);

  /*
   * 위에 덮어 여는 화면 둘 (2026-10-10 사용자 요청, 웹과 같다). 덮은 동안에는 그것만 그리고, 그
   * 머리글의 ← 나 기기의 뒤로가기로 닫으면 이 화면이 기간·탭과 보던 자리까지 떠날 때 그대로다.
   *
   *   거래내역   걸어 둔 조건에 **보고 있는 날들을 기간으로 더한** 거래 화면이다(`entriesSearch`).
   *              조건을 고칠 수 없고(locked) 분석으로 가는 단추도 없다 -- 그 아래에 이 분석이 있다.
   *   원형 목록 줄  그 분류·수단으로 좁힌 새 분석이다 (`pickCategory`·`pickMethod`).
   *   일별 누적 아래 줄  그 선의 첫날부터 그 날까지로 좁힌 같은 거래 화면이다 (`openDay`, 2026-10-14 사용자 요청).
   */
  /** 덮어 연 거래 화면의 검색. null 이면 덮지 않았다. */
  const [entriesSearch, setEntriesSearch] = useState<TransactionSearch | null>(null);
  const [picked, setPicked] = useState<AnalysisInitial | null>(null);
  const isCovered = entriesSearch !== null || picked !== null;
  const scrollToTop = useScrollToTop();
  const { offsetOf, restoreTo } = useScrollRestore();
  const analysisOffset = useRef(0);
  const cover = (open: () => void) => {
    analysisOffset.current = offsetOf();
    open();
    scrollToTop();
  };
  const openEntries = () => cover(() => setEntriesSearch(analysis.entriesSearch));
  /** 일별 누적 아래 줄의 구간(그 선의 첫날~그 날). 지출·수입 탭이면 그 유형도 건다. */
  const openDay = useStableCallback((range: { from: string; to: string }) =>
    cover(() => setEntriesSearch(analysis.cumulativeEntriesSearch(range))),
  );
  const openPicked = (next: AnalysisInitial) => cover(() => setPicked(next));
  const closeCover = () => {
    setEntriesSearch(null);
    setPicked(null);
    restoreTo(analysisOffset.current);
  };
  useCloseOnBack(isCovered, closeCover);
  /* 가계부를 바꾸면 덮어 둔 화면은 앞 가계부의 조건이라 닫는다 (탭을 숨겨 두므로 저절로 닫히지 않는다). */
  useEffect(() => {
    setEntriesSearch(null);
    setPicked(null);
  }, [projectId]);

  /**
   * 한 번 연 탭(합계·지출·수입). 안 보이게 숨겨 두고 다시 누르면 곧바로 보인다(`FadeIn`).
   *
   * 처음 여는 탭은 **다음 그림에** 더한다 -- 누른 그림에서 그래프 묶음까지 그리면 탭 표시가
   * 그만큼 늦게 바뀐다. 탭 표시가 먼저 옮겨 가고 내용이 뒤따른다.
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

  /**
   * 탭 표시. 누르면 이것부터 옮기고 내용 전환은 뒤로 미룬다(startTransition) -- 같은 그림에서
   * 그래프 묶음까지 바꾸면 다 그릴 때까지 누른 표시가 늦게 바뀐다 (2026-10-15 사용자 요청, 하단 탭과
   * 같다). 다른 길로 탭이 바뀌면(덮어 연 분석의 처음 탭) 그쪽을 따른다.
   */
  const [selectedKind, setSelectedKind] = useState(analysis.kind);
  useEffect(() => setSelectedKind(analysis.kind), [analysis.kind]);
  const selectKind = (kind: AnalysisKind) => {
    setSelectedKind(kind);
    startTransition(() => analysis.setKind(kind));
  };

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  /* 원형 목록 줄. 그래프 묶음이 memo 라 함수를 고정해 넘긴다 (useStableCallback). */
  const pickCategory = useStableCallback((pickId: string) =>
    openPicked(analysis.pickCategory(pickId)),
  );
  const pickMethod = useStableCallback((method: MethodSlice) =>
    openPicked(analysis.pickMethod(method)),
  );

  /*
    덮은 화면 아래의 분석은 지우지 않고 숨겨 둔다 (2026-10-15 사용자 요청 -- 팝업처럼). 받아 둔
    그래프·고른 탭·파고든 원형이 그대로 남아 닫으면 다시 받지 않는다.
  */
  return (
    <>
      {entriesSearch ? (
        <ScreenPush>
          <TransactionsScreen
            initial={{ search: entriesSearch, unit: tx.unit }}
            locked
            onBack={closeCover}
          />
        </ScreenPush>
      ) : picked ? (
        <ScreenPush>
          <AnalysisScreen initial={picked} onBack={closeCover} />
        </ScreenPush>
      ) : null}
    <ScreenReturn covered={isCovered} style={{ gap: 16 }}>
      {/*
        위쪽 한 덩어리 -- 제목, 걸어 둔 조건, 탭. 거래 화면과 같은 규칙이다(`RevealTop`): 내리는
        동안에는 비켜서고 조금이라도 올리면 되돌아오며, 걸어 둔 조건 알약 줄부터 아래(탭)는
        비켜서지 않는다 -- 무엇으로 그린 그래프인지 내내 보여야 한다 (2026-10-07 사용자 요청).
      */}
      <RevealTop>
        <View className="gap-4">
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
                  <Pressable
                    onPress={openEntries}
                    accessibilityLabel={t('analysis.toTransactions')}
                    className="items-center justify-center p-2"
                  >
                    <NavIcon name="transactions" size={18} color="#4b5563" />
                  </Pressable>
                ) : undefined
              ) : (
                <View className="flex-row gap-2">
                  {/*
                    거래내역. 거래 탭의 보관함·달력 자리다 -- 분석에서 본 것을 같은 검색으로 낱낱의
                    거래로 확인하러 가는 길이다 (openEntries).
                  */}
                  <Pressable
                    onPress={openEntries}
                    accessibilityLabel={t('analysis.toTransactions')}
                    className="items-center justify-center p-2"
                  >
                    {/* 아래 메뉴의 거래 탭과 같은 그림이다 -- 같은 곳으로 가는 길이다. */}
                    <NavIcon name="transactions" size={18} color="#4b5563" />
                  </Pressable>
                  {/* 검색. 거래 탭과 같은 창이고 같은 규칙으로 걸린다. */}
                  <Pressable
                    onPress={() => setIsSearchOpen(true)}
                    accessibilityLabel={t('tx.search')}
                    className="flex-row items-center gap-1.5 px-2 py-2"
                  >
                    <Search size={18} color={tx.searchCount > 0 ? '#2563eb' : '#4b5563'} />
                    {tx.searchCount > 0 ? (
                      <Text className="text-sm font-semibold text-blue-600">{tx.searchCount}</Text>
                    ) : null}
                  </Pressable>
                </View>
              )
            }
          />

          {tx.hasError ? (
            <View className="rounded-lg bg-red-50 p-3">
              <Text className="text-sm text-red-800">{t('tx.loadFailed')}</Text>
            </View>
          ) : null}

          {/*
            탭과 걸어 둔 조건. 한 상자에 묶어, 조건이 걸려 있으면 내려가는 동안에도 이 상자는
            화면 위에 남는다(RevealKeep). 조건이 없으면 통째로 비켜선다.
          */}
          <RevealKeep active={tx.searchChips.length > 0}>
            <View className="gap-4">
              {/*
                합계·지출·수입. 거래 탭의 날짜별·분류별·수단별 자리와 모양이다. 금액은 적지 않는다
                (2026-10-06 사용자 요청) -- 합계 탭의 요약이 말한다.
              */}
              <SegmentedTabs
                tabs={TABS.map((item) => ({ id: item.id, label: t(item.labelKey) }))}
                selected={selectedKind}
                onSelect={selectKind}
              />
              {/*
                걸려 있는 조건. 탭 **아래** 둔다(2026-10-07 사용자 요청). 누르면 그 조건만 빠진다. 거래
                탭·원형 목록 줄이 덮어 연 보기도 같다(2026-10-10 사용자 요청, 웹과 같다). 그 보기의 조건은
                제 것이라 빼도 아래의 화면에는 번지지 않는다.
              */}
              <SearchChips chips={tx.searchChips} onRemove={tx.removeSearchChip} />
            </View>
          </RevealKeep>
        </View>
      </RevealTop>

      {/*
        기간 줄부터 아래(그래프)를 가로로 끌면 기간을 넘긴다 -- 기간 줄의 ‹ › 와 같은 일이다
        (2026-10-09 사용자 요청, 예산 화면과 같은 손짓). 위쪽 탭 줄은 감싸지 않는다. 직접 정한 기간은
        옮길 앞뒤가 없어 손을 가져오지 않는다.
      */}
      <PeriodSwipe onShift={analysis.shift} enabled={analysis.unit !== 'range'}>
        <View className="gap-4">
          <PeriodNavigator periodKey={analysis.periodKey} onChange={analysis.setPeriodKey} />

          {analysis.isPeriodPending ? (
            <LoadingBlock label={t('common.loading')} />
          ) : !shownPeriod ? (
            <Text className="py-8 text-center text-sm text-gray-500">{t('tx.analysisOutOfRange')}</Text>
          ) : (
            TABS.filter((tab) => openedKinds.includes(tab.id)).map(({ id: kind }) => (
            <FadeIn key={kind} visible={kind === analysis.kind}>
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
                  onOpenDay={openDay}
                />
              ) : (
                <CategoryDetailView
                  active={kind === analysis.kind}
                  categoryId={totalIdOf(kind)}
                  categoryName=""
                  categories={tx.pickerCategories}
                  period={shownPeriod}
                  projectId={projectId}
                  filter={analysis.filter}
                  trendClip={analysis.trendClip}
                  trendPeriod={analysis.trendPeriod}
                  /*
                    원형 목록 줄을 누르면 그 분류·수단으로 좁힌 분석을 위에 덮어 연다 (웹과 같은 규칙). 분석
                    탭이든 거래 탭·예산 화면에서 건너온 보기든 같다 (2026-10-10 사용자 요청).
                  */
                  onPickCategory={pickCategory}
                  onPickMethod={pickMethod}
                  onOpenDay={openDay}
                />
              )}
            </FadeIn>
            )).concat(
              /* 처음 여는 탭은 다음 그림에 선다(`openedKinds`). 그동안 그 자리에서 돈다. */
              openedKinds.includes(analysis.kind)
                ? []
                : [<LoadingBlock key="opening" label={t('detail.loading')} />],
            )
          )}
        </View>
      </PeriodSwipe>

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

    </ScreenReturn>
    </>
  );
}
