/*
 * 분석. 거래 탭과 같은 조건으로 한 기간의 돈을 그래프로 본다 (웹의 AnalysisView 와 같은 짝).
 *
 * 짜임은 거래 탭을 따른다. 머리글(자산주인·거래내역·검색·더보기), 걸어 둔 조건 알약, 그 아래
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
import { Animated, Pressable, ScrollView, Text, View } from 'react-native';
import { List, MoreVertical, Search, X } from 'lucide-react-native';
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
import { useEntryFocus } from '@money/core/store/entry-focus';
import { useUserFilter } from '@money/core/store/user-filter';

import BasisPicker from '../components/BasisPicker';
import CategoryDetailView from '../components/CategoryDetailView';
import EntryEditor from '../components/EntryEditor';
import Modal from '../components/Modal';
import NetAnalysisPanel from '../components/NetAnalysisPanel';
import PageHeader from '../components/PageHeader';
import PeriodNavigator from '../components/PeriodNavigator';
import PeriodUnitPicker from '../components/PeriodUnitPicker';
import PersonScopeTitle from '../components/PersonScopeTitle';
import SegmentedTabs from '../components/SegmentedTabs';
import TransactionSearchModal from '../components/TransactionSearchModal';
import { useNavigation } from '../shell/navigation';

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
}: {
  /** 거래 탭에서 열 때의 검색·단위·세는 방식·기간. 없으면 분석 탭이다. */
  initial?: AnalysisInitial;
  /** 주면 머리글에 ← 만 선다. 부르는 쪽이 돌아가는 일을 맡는다. */
  onBack?: () => void;
} = {}) {
  const { t } = useTranslation();
  const { go } = useNavigation();
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
   * 거래내역 단추. 자산 상세의 "거래내역 보기"와 같은 길이다 -- 걸어 둔 검색·묶는 단위·세는 방식을 쪽지에 실어
   * 거래 화면으로 건너가고, 그 화면 머리글에 ← 가 선다. ← 로 돌아오면 떠날 때의 보기(검색·
   * 단위·세는 방식·기간·탭)를 되살린다. 앱은 화면을 갈아 끼워 이 화면의 상태가 사라지기 때문이다.
   */
  const focusEntries = useEntryFocus((state) => state.focusEntries);
  const reopen = useEntryFocus((state) => state.reopen);
  const clearReopen = useEntryFocus((state) => state.clearReopen);
  const openEntries = () => {
    focusEntries({ kind: 'analysis', id: '', snapshot: analysis.snapshot() }, tx.search, {
      unit: tx.unit,
      basis: tx.basis,
    });
    go('/transactions');
  };
  const { restore } = analysis;
  useEffect(() => {
    // 거래 탭에 얹힌 보기는 분석 탭이 아니다. 거래 화면의 ← 가 남긴 쪽지는 분석 탭의 것이다.
    if (onBack || reopen?.kind !== 'analysis') return;
    if (reopen.snapshot) restore(reopen.snapshot);
    clearReopen();
  }, [onBack, reopen, restore, clearReopen]);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  /** 더보기. 묶는 단위와 세는 방식을 고른다 (거래 탭의 더보기 위쪽 둘과 같다). */
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  /**
   * 분석의 거래를 눌러 여는 고치기 창. 예산 화면의 분류 상세와 같은 길이다. 읽기 전용
   * 구성원에게는 열지 않는다. 고친 값은 사본이 바뀌어(`useMirrorVersion`) 그래프가 다시 읽는다.
   */
  const [editing, setEditing] = useState<EntryListItem | null>(null);
  const openEntry = canEdit ? (entry: EntryListItem) => setEditing(entry) : undefined;

  return (
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
          onBack ? undefined : (
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
                <List size={18} color="#4b5563" />
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
              <Pressable
                onPress={() => setIsMoreOpen(true)}
                accessibilityLabel={t('tx.more')}
                className="items-center justify-center p-2"
              >
                <MoreVertical size={18} color="#4b5563" />
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
        걸려 있는 조건. 거래 탭과 같이 탭 위에 두고, 누르면 그 조건만 빠진다. 거래 탭에서
        건너왔으면 무엇으로 그렸는지 알리기만 한다 -- 뺀 조건을 되걸 검색 단추가 없다.
      */}
      {tx.searchChips.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="grow-0"
          contentContainerClassName="flex-row items-center gap-2 pr-4"
        >
          {tx.searchChips.map((chip) =>
            onBack ? (
              <View
                key={chip.id}
                className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5"
              >
                <Text className="text-sm font-medium text-blue-700">{chip.label}</Text>
              </View>
            ) : (
              <Pressable
                key={chip.id}
                onPress={() => tx.removeSearchChip(chip.id)}
                accessibilityLabel={`${chip.label} ${t('tx.search.chipRemove')}`}
                className="flex-row items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 py-1.5 pl-3 pr-2 active:bg-blue-100"
              >
                <Text className="text-sm font-medium text-blue-700">{chip.label}</Text>
                <X size={14} color="#1d4ed8" />
              </Pressable>
            ),
          )}
        </ScrollView>
      ) : null}

      {/*
        합계·지출·수입. 거래 탭의 날짜별·분류별·수단별 자리와 모양이다. 금액은 적지 않는다
        (2026-10-06 사용자 요청) -- 합계 탭의 요약이 말한다.
      */}
      <SegmentedTabs
        tabs={TABS.map((item) => ({ id: item.id, label: t(item.labelKey) }))}
        selected={analysis.kind}
        onSelect={analysis.setKind}
      />

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
            />
          )}
        </FadeIn>
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
        isOpen={editing !== null}
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={tx.reload}
      />
    </View>
  );
}
