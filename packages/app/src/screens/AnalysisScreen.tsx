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
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { Search } from 'lucide-react-native';
import type { EntryListItem } from '@money/types';

import {
  useAnalysis,
  type AnalysisInitial,
  type AnalysisKind,
} from '@money/core/hooks/useAnalysis';
import { totalIdOf } from '@money/core/hooks/useCategoryDetail';
import { usePersonFilterSync } from '@money/core/hooks/usePersonFilterSync';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import {
  useCanEdit,
  useMyPersonId,
  useProject,
} from '@money/core/store/project';
import { useUserFilter } from '@money/core/store/user-filter';

import CategoryDetailView from '../components/CategoryDetailView';
import EntryEditor from '../components/EntryEditor';
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
import { useScrollRestore, useScrollToTop } from '../shell/scroll';
import TransactionsScreen from './TransactionsScreen';

const TABS: Array<{ id: AnalysisKind; labelKey: MessageKey }> = [
  { id: 'net', labelKey: 'analysis.tab.net' },
  { id: 'expense', labelKey: 'analysis.tab.expense' },
  { id: 'income', labelKey: 'analysis.tab.income' },
];

/** 탭을 옮기면 새 내용이 옅은 데서 떠오른다. 웹의 `unfold` 와 같은 180ms 다. */
function FadeIn({ children }: { children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [opacity]);
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
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
   * 요청, 웹과 같다). 거래 탭이 연 분석은 주지 않는다. 거기서 거래내역을 열면 두 화면이 서로를 겹겹이 연다.
   */
  canOpenEntries?: boolean;
} = {}) {
  const { t } = useTranslation();
  const projectId = useProject((state) => state.selectedProjectId);
  const canEdit = useCanEdit();
  const myPersonId = useMyPersonId();
  const selectedPersonIds = useUserFilter((state) => state.selectedPersonIds);
  const togglePersonId = useUserFilter((state) => state.togglePersonId);

  const analysis = useAnalysis(projectId, { initial });
  const { tx } = analysis;
  // 사람 목록과 선택을 이 프로젝트에 맞춘다 (거래 화면과 같은 훅).
  usePersonFilterSync(projectId, tx.people);

  /*
   * 거래내역 단추. 거래 화면을 **이 자리에** 그린다 -- 거래 탭의 분석 아이콘이 분석을 제자리에
   * 그리는 것과 방향만 반대인 같은 길이고, 웹과 같다. 걸어 둔 조건에 보고 있는 날들을 기간으로
   * 더해 열고(`entriesSearch`), 그 화면은 조건을 고칠 수 없다(locked, 2026-10-07 사용자 요청).
   * 이 화면이 그대로 세워져 있어 ← 나 기기의 뒤로가기로 돌아오면 기간·탭과 보던 자리가 그대로다.
   */
  const [isEntriesOpen, setIsEntriesOpen] = useState(false);
  const scrollToTop = useScrollToTop();
  const { offsetOf, restoreTo } = useScrollRestore();
  const analysisOffset = useRef(0);
  const openEntries = () => {
    analysisOffset.current = offsetOf();
    setIsEntriesOpen(true);
    scrollToTop();
  };
  const closeEntries = () => {
    setIsEntriesOpen(false);
    restoreTo(analysisOffset.current);
  };
  /*
   * 예산 화면이 연 분석(canOpenEntries)에서는 거래내역과 분석이 오른쪽 위 단추로 오가는 한 자리다 --
   * 거래내역의 ← 와 뒤로가기는 분석이 아니라 예산 화면으로 돌아간다 (2026-10-09 사용자 요청). 그래서
   * 뒤로가기 칸을 따로 쌓지 않고, 부르는 쪽(예산 화면)의 칸이 통째로 닫는다.
   */
  useCloseOnBack(isEntriesOpen && !canOpenEntries, closeEntries);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  /**
   * 분석의 거래를 눌러 여는 고치기 창. 예산 화면의 분류 상세와 같은 길이다. 읽기 전용
   * 구성원에게는 열지 않는다. 고친 값은 사본이 바뀌어(`useMirrorVersion`) 그래프가 다시 읽는다.
   */
  const [editing, setEditing] = useState<EntryListItem | null>(null);
  const openEntry = canEdit ? (entry: EntryListItem) => setEditing(entry) : undefined;

  if (isEntriesOpen) {
    return (
      <TransactionsScreen
        initial={{ search: analysis.entriesSearch, unit: tx.unit }}
        locked
        onBack={canOpenEntries && onBack ? onBack : closeEntries}
        /* 오른쪽 위의 분석 단추도 ← 와 같이 이 분석으로 돌아온다 -- 두 화면을 오가는 길이다. */
        onOpenAnalysis={closeEntries}
      />
    );
  }

  return (
    <View className="gap-4">
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
              거래 탭에서 건너왔으면 ← 만 둔다. 조건은 거래 탭에서 걸고 오는 것이고, 여기서
              거래내역을 다시 열면 거래 화면과 분석이 서로를 겹겹이 연다.
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
                selected={analysis.kind}
                onSelect={analysis.setKind}
              />
              {/*
                걸려 있는 조건. 탭 **아래** 둔다(2026-10-07 사용자 요청). 누르면 그 조건만 빠진다. 거래
                탭에서 건너왔으면 무엇으로 그렸는지 알리기만 한다 -- 뺀 조건을 되걸 검색 단추가 없다.
              */}
              <SearchChips chips={tx.searchChips} onRemove={onBack ? undefined : tx.removeSearchChip} />
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
            <Text className="py-8 text-center text-sm text-gray-500">{t('common.loading')}</Text>
          ) : !analysis.period ? (
            <Text className="py-8 text-center text-sm text-gray-500">{t('tx.analysisOutOfRange')}</Text>
          ) : (
            <FadeIn key={analysis.kind}>
              {analysis.kind === 'net' ? (
                <NetAnalysisPanel
                  totals={analysis.totals}
                  categories={tx.pickerCategories}
                  period={analysis.period}
                  projectId={projectId}
                  filter={analysis.filter}
                  trendClip={analysis.trendClip}
                  trendPeriod={analysis.trendPeriod}
                />
              ) : (
                <CategoryDetailView
                  categoryId={totalIdOf(analysis.kind)}
                  categoryName=""
                  categories={tx.pickerCategories}
                  period={analysis.period}
                  projectId={projectId}
                  filter={analysis.filter}
                  trendClip={analysis.trendClip}
                  trendPeriod={analysis.trendPeriod}
                  onEntryClick={openEntry}
                  /*
                    원형 목록 줄을 누르면 그 분류·수단을 조건으로 건다 (웹과 같은 규칙). 거래 탭에서 건너온
                    보기는 조건을 고칠 수 없어 줄은 예전처럼 파고들기만 한다.
                  */
                  onPickCategory={onBack ? undefined : analysis.pickCategory}
                  onPickMethod={onBack ? undefined : analysis.pickMethod}
                />
              )}
            </FadeIn>
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


      <EntryEditor
        isOpen={editing !== null}
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={tx.reload}
      />
    </View>
  );
}
