import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { MoreVertical } from 'lucide-react-native';
import type { EntryListItem } from '@money/types';

import { useLedgerData } from '@money/core/hooks/useLedgerData';
import { currentYearMonth } from '@money/core/lib/datetime';
import { sumEntries } from '@money/core/lib/entries';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { useLedgerBasis } from '@money/core/store/ledger-basis';
import { useCanEdit, useProject, useProjectTimeZone } from '@money/core/store/project';
import { useUserFilter } from '@money/core/store/user-filter';

import BasisPicker from '../components/BasisPicker';
import CategoryBreakdown, { type CategoryTarget } from '../components/CategoryBreakdown';
import CategoryDetailView from '../components/CategoryDetailView';
import EntryEditor from '../components/EntryEditor';
import LedgerKindSummary from '../components/LedgerKindSummary';
import Modal from '../components/Modal';
import MonthHeader from '../components/MonthHeader';
import PaymentMethodBreakdown from '../components/PaymentMethodBreakdown';
import PersonScopeTitle from '../components/PersonScopeTitle';
import { useCloseOnBack } from '../shell/navigation';
import { useScrollToTop } from '../shell/scroll';

type ViewType = 'category' | 'method';

/**
 * 보기 방식. 웹의 가계 화면과 같은 둘이다.
 *
 * 날짜별(달력 + 그 날의 목록)은 여기 없다. 거래 화면이 같은 일을 더 넓게 하므로
 * (년월 -> 날짜 -> 거래, 달력 보기, 검색) 같은 것을 두 자리에서 기르지 않는다.
 */
const VIEWS: Array<{ id: ViewType; labelKey: MessageKey }> = [
  { id: 'category', labelKey: 'ledger.tab.category' },
  { id: 'method', labelKey: 'ledger.tab.method' },
];

/**
 * 가계. 웹의 /dashboard 를 옮긴 것이다.
 *
 * 한 달의 거래를 두 가지로 본다. 분류별, 수단별. 기간 보기(임의 구간)는 아직 웹에만 있다.
 *
 * 분류를 누르면 그 분류의 상세가 화면을 덮는다 -- 구성비 원형차트, 12개월 추이,
 * 일별 누적, 그 구간의 거래 목록이다. 거래를 고치는 것은 그 안에서 하고, 새로 적는
 * 것은 거래 화면이 맡는다. 오프라인이면 기기에 먼저 담기고 연결될 때 나간다
 * (창구가 그것을 가르므로 이 화면은 어느 쪽인지 모른다).
 */
export default function LedgerScreen() {
  const { t } = useTranslation();
  const timeZone = useProjectTimeZone();
  const selectedProjectId = useProject((state) => state.selectedProjectId);
  const canEdit = useCanEdit();
  const togglePersonId = useUserFilter((state) => state.togglePersonId);

  const { year: thisYear, month: thisMonth } = currentYearMonth(timeZone);
  const [view, setView] = useState({ year: thisYear, month: thisMonth });
  const [viewType, setViewType] = useState<ViewType>('category');
  /*
   * 한 번 열어 본 보기는 그려 둔 채로 감춘다.
   *
   * 탭을 옮길 때마다 지우고 다시 만들면 분류별·수단별을 서버에서 다시 받는다. 앱에서는
   * 그 사이가 눈에 띄게 비어 보인다. 열어 본 적 없는 보기는 만들지 않는다.
   */
  const [visited, setVisited] = useState<ViewType[]>(['category']);
  /*
   * 그 보기를 몇 번째 열었는지.
   *
   * 남겨 둔 화면은 그대로 두되, 다시 열 때마다 서버에 새로 물어본다. 프로젝트를 여럿이
   * 함께 쓰므로 내가 보지 않는 동안 남이 고쳤을 수 있다. 받아 둔 값을 먼저 보여 주고
   * 새 값이 오면 갈아 끼우므로 화면이 비는 순간은 없다.
   */
  const [visits, setVisits] = useState<Record<ViewType, number>>({ category: 0, method: 0 });
  /**
   * 고치기 팝업.
   *
   * 상세의 거래 목록에서 누른 거래만 연다. 새로 적는 것은 거래 화면이 맡으므로 이
   * 화면에서는 editing 이 null 인 채로 열리지 않는다 (EntryEditor 는 두 쓰임을 다 받는다).
   */
  const [editor, setEditor] = useState<{ isOpen: boolean; editing: EntryListItem | null }>({
    isOpen: false,
    editing: null,
  });
  /** 이 화면이 다루지 않는 갈래를 눌렀을 때의 안내 (카드사 대금 이동 등) */
  const [notice, setNotice] = useState('');
  /*
   * 더보기. 세는 기준 하나만 든다 -- 이 화면에서 쓰기는 일어나지 않으므로(거래를 적는
   * 것은 거래 화면이 맡는다) 태그·지우기 같은 것이 들어올 자리가 없다.
   */
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const { basis, setBasis } = useLedgerBasis();

  const ledger = useLedgerData({
    projectId: selectedProjectId,
    year: view.year,
    month: view.month,
  });

  /*
   * 펼쳐 둔 분류 상세. null 이면 목록을 본다.
   *
   * 펼치거나 접으면 맨 위로 올린다. 화면에 보이는 것이 통째로 바뀌는 자리라, 내려와
   * 있던 자리에 그대로 두면 새로 그린 칸의 가운데부터 보이고 접고 나면 목록의
   * 엉뚱한 데에 서 있다 (자산 화면과 같은 규칙이다).
   */
  const [detail, setDetail] = useState<CategoryTarget | null>(null);
  const scrollToTop = useScrollToTop();
  const openDetail = (next: CategoryTarget | null) => {
    setNotice('');
    setDetail(next);
    scrollToTop();
  };

  /* 기기의 뒤로가기는 머리글의 ← 와 같은 일을 한다 -- 목록으로 돌아간다. */
  useCloseOnBack(detail !== null, () => openDetail(null));

  /* 위 머리글에 적는 이 구간의 합계. 목록의 날짜별 소계와 같은 규칙으로 센다. */
  const totals = sumEntries(ledger.entries);

  /** 상세의 거래 목록에서 거래를 누를 때. 읽기 전용 구성원에게는 열지 않는다. */
  const openEntry = canEdit
    ? (entry: EntryListItem) => {
        setNotice('');
        setEditor({ isOpen: true, editing: entry });
      }
    : undefined;

  return (
    <View className="gap-6">
      {/*
        상세를 펼쳐 두면 그것만 그린다.

        머리글과 목록을 위에 남겨 두면 좁은 화면에서 그래프가 한참 아래로 밀리고,
        무엇을 보고 있는지도 흐려진다. 닫으면 목록이 그 자리에 그대로 돌아온다.
      */}
      {detail ? (
        <CategoryDetailView
          categoryId={detail.categoryId}
          categoryName={detail.name}
          exactCategory={detail.exact}
          categories={ledger.categories}
          period={ledger.reportPeriod}
          projectId={selectedProjectId}
          filter={ledger.filter}
          reloadToken={ledger.dataVersion}
          onClose={() => openDetail(null)}
          onEntryClick={openEntry}
        />
      ) : (
        <>
          {/*
            화면의 첫 문장이자 제목이다. 자산 화면과 같은 짜임새다 -- 이름을 누르면
            자산주인을, 갈래 상자를 누르면 무엇을 더한 금액인지 고른다.

            날짜를 고르는 자리도 이 문장 안에 있다. "언제의 순수입인가"를 답하지 않으면
            금액만으로는 무엇을 본 것인지 알 수 없다.
          */}
          <LedgerKindSummary
            scopeTitle={
              /* 낱말(순수입·수입·지출)은 다음 줄로 내려갔으므로 noun 을 넘기지 않는다. */
              <PersonScopeTitle
                people={ledger.people}
                myPersonId={ledger.myPersonId}
                selectedPersonIds={ledger.selectedPersonIds}
                onTogglePerson={togglePersonId}
              />
            }
            action={
              /* 더보기. 거래 화면과 같은 자리, 같은 아이콘이다. */
              <Pressable
                onPress={() => setIsMoreOpen(true)}
                accessibilityLabel={t('tx.more')}
                className="items-center justify-center p-2"
              >
                <MoreVertical size={18} color="#4b5563" />
              </Pressable>
            }
            dateControl={
              <MonthHeader
                year={view.year}
                month={view.month}
                incomeTotal={totals.incomeTotal}
                expenseTotal={totals.expenseTotal}
                onMonthChange={(year, month) => setView({ year, month })}
                /* 합계는 위 문장과 아래 상자가 말한다. 여기서 또 적으면 같은 숫자가 세 번이다. */
                showTotals={false}
                /* 년월 글자를 윗줄 제목과 같은 왼쪽 선에 세우고, 꺽쇠 양옆을 붙인다. */
                tightArrows
              />
            }
            incomeTotal={totals.incomeTotal}
            expenseTotal={totals.expenseTotal}
          />

          {ledger.hasError ? (
            <View className="rounded-lg bg-red-50 p-3">
              <Text className="text-sm text-red-800">{t('home.loadFailed')}</Text>
            </View>
          ) : null}

          {notice ? (
            <View className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <Text className="text-sm text-amber-800">{notice}</Text>
            </View>
          ) : null}

          {/* 보기 방식. 웹은 달 머리글 오른쪽에 붙지만 좁은 화면에서는 아래 줄로 내린다. */}
          <View className="flex-row gap-2 rounded-lg bg-gray-200 p-1">
            {VIEWS.map((item) => {
              const active = viewType === item.id;

              return (
                <Pressable
                  key={item.id}
                  onPress={() => {
                    setViewType(item.id);
                    setVisited((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]));
                    setVisits((prev) => ({ ...prev, [item.id]: prev[item.id] + 1 }));
                  }}
                  className={`flex-1 items-center rounded-md px-4 py-2 ${active ? 'bg-white' : ''}`}
                >
                  <Text className={`font-medium ${active ? 'text-blue-600' : 'text-gray-600'}`}>
                    {t(item.labelKey)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* 감춘 보기도 그대로 남겨 둔다. 다시 누르면 받아 둔 값이 바로 보인다. */}
          {visited.includes('category') ? (
            <View style={{ display: viewType === 'category' ? 'flex' : 'none' }}>
              <CategoryBreakdown
                period={ledger.reportPeriod}
                projectId={selectedProjectId}
                filter={ledger.filter}
                categories={ledger.categories}
                reloadToken={ledger.dataVersion + visits.category}
                onSelect={openDetail}
              />
            </View>
          ) : null}

          {visited.includes('method') ? (
            <View style={{ display: viewType === 'method' ? 'flex' : 'none' }}>
              <PaymentMethodBreakdown
                period={ledger.reportPeriod}
                projectId={selectedProjectId}
                filter={ledger.filter}
                reloadToken={ledger.dataVersion + visits.method}
              />
            </View>
          ) : null}
        </>
      )}

      {/* 더보기. 세는 기준 하나만 든다 (거래 화면의 같은 창과 같은 모양이다). */}
      <Modal isOpen={isMoreOpen} onClose={() => setIsMoreOpen(false)} title={t('tx.more')}>
        {/*
          창을 닫지 않는다 -- 둘을 눌러 보며 숫자가 어떻게 달라지는지 견주는 자리라,
          누를 때마다 닫히면 다시 열어야 한다.
        */}
        <BasisPicker value={basis} onChange={setBasis} />
      </Modal>

      <EntryEditor
        isOpen={editor.isOpen}
        editing={editor.editing}
        onClose={() => setEditor({ isOpen: false, editing: null })}
        onSaved={() => {
          /*
            reloadEntries 가 아니라 reloadAll 이다. 위 합계뿐 아니라 **상세와 분류별
            목록까지** 다시 받아야 하는데, 그 둘은 dataVersion 이 오르는 것을 보고
            움직인다 -- reloadEntries 는 그 표를 올리지 않는다. 오프라인이면 사본에서
            곧바로 온다.
          */
          ledger.reloadAll();
        }}
        onNotEditable={() => setNotice(t('editor.notEditable'))}
      />
    </View>
  );
}
