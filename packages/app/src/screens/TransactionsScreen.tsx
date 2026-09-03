/*
 * 거래. 오간 돈을 훑어보는 자리다.
 *
 * 세 겹으로 파고든다. **년월 -> (날짜·분류·수단) -> 거래.** 겹마다 그 줄을 누르면
 * 바로 아래가 펼쳐지고, 다시 누르면 접힌다. 화면을 갈아 끼우지 않는 것이 요점이다 --
 * 어느 달의 어느 분류를 보고 있는지가 줄의 위치로 남아, 되돌아가려고 뒤로가기를
 * 누를 일이 없다.
 *
 * 이 화면은 고치지 않는다. 줄을 누르면 편집 폼이 아니라 상세가 뜬다. 거래를 적고
 * 고치는 자리는 가계 화면이다.
 *
 * 값은 `useTransactions` 가 창구에서 받는다. 그래서 서버에서 왔는지 기기 사본에서
 * 왔는지 이 화면은 모르고, 오프라인에서도 같은 코드로 그려진다.
 */
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft, Check, MoreVertical, Search, Trash2, X } from 'lucide-react-native';
import type { EntryListItem } from '@money/types';

import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import { formatYearMonth } from '@money/core/lib/datetime';
import {
  useTransactions,
  type TransactionRow,
  type TransactionTab,
} from '@money/core/hooks/useTransactions';
import { useMyPersonId, useProject, useProjectDisplayCurrency } from '@money/core/store/project';
import { usePersonFilterSync } from '@money/core/hooks/usePersonFilterSync';
import { useUserFilter } from '@money/core/store/user-filter';

import EntryDetailModal from '../components/EntryDetailModal';
import Modal from '../components/Modal';
import PageHeader from '../components/PageHeader';
import PersonScopeTitle from '../components/PersonScopeTitle';
import TransactionItem from '../components/TransactionItem';
import TransactionSearchModal from '../components/TransactionSearchModal';

const TABS: Array<{ id: TransactionTab; labelKey: MessageKey }> = [
  { id: 'date', labelKey: 'tx.tab.date' },
  { id: 'category', labelKey: 'tx.tab.category' },
  { id: 'method', labelKey: 'tx.tab.method' },
];

/**
 * 체크박스. RN 에는 없어서 그린다.
 *
 * 세 상태를 보인다. 빈 칸 / 체크 / 줄(일부만 고름). 년월 줄은 그 달의 거래 일부만
 * 골랐을 수 있어 셋이 필요하다.
 */
/**
 * 체크박스. RN 에는 없어서 그린다.
 *
 * 켜짐과 꺼짐 둘뿐이다. **반쯤 골라진 상태를 따로 그리지 않는다** -- 지우는 화면에서
 * 애매한 표시는 "이걸 누르면 무엇이 지워지는가"를 흐린다. 줄에 든 거래가 하나라도
 * 빠지면 꺼진 것으로 본다.
 */
function CheckBox({
  checked,
  pending,
  onPress,
}: {
  checked: boolean;
  /** 그 범위의 거래를 세는 중. 누른 것이 먹혔다는 표시가 된다. */
  pending?: boolean;
  onPress: () => void;
}) {
  return (
    /*
      누르는 자리를 줄 높이만큼 넓힌다.
      20×20 상자만 받으면 손가락이 조금 아래로 가도 바깥의 줄이 눌려 접힘·펼침이
      바뀐다. 체크하려던 사람에게는 "체크가 안 된다"로 보인다.
    */
    <Pressable onPress={onPress} hitSlop={8} className="py-3 pl-1 pr-2">
      {pending ? (
        <View className="h-5 w-5 items-center justify-center">
          <ActivityIndicator size="small" color="#2563eb" />
        </View>
      ) : (
        <View
          className={`h-5 w-5 items-center justify-center rounded border ${
            checked ? 'border-blue-600 bg-blue-600' : 'border-gray-400 bg-white'
          }`}
        >
          {checked ? <Check size={14} color="#ffffff" strokeWidth={3} /> : null}
        </View>
      )}
    </Pressable>
  );
}

/** 펼침 표시. 왼쪽에 두어 줄이 늘어서도 계층이 눈에 남는다. */
function Caret({ open, deep }: { open: boolean; deep?: boolean }) {
  /*
   * 세 상태를 글자 하나로 보인다.
   *
   *   ▸  접힘
   *   ▾  안쪽 목록까지
   *   ▾▾ 그 목록의 거래까지
   *
   * 두 단계를 같은 모양으로 두면 한 번 더 누를 자리가 있는지 알 수 없다.
   */
  return (
    <Text className={`text-gray-400 ${deep ? 'w-4 text-[10px]' : 'w-4'}`}>
      {open ? (deep ? '▾▾' : '▾') : '▸'}
    </Text>
  );
}

/**
 * 2단·3단의 한 줄.
 *
 * 오른쪽에 지출과 수입을 함께 적는다. 한쪽만 적으면 이체가 섞인 달에서 줄의 금액과
 * 아래를 펴서 나온 거래의 합이 어긋나 보인다.
 */
function Line({
  label,
  sub,
  expense,
  income,
  open,
  deep,
  depth,
  check,
  onPress,
}: {
  label: string;
  sub?: string;
  expense: number;
  income: number;
  open?: boolean;
  /** 년월 줄에서만. 안쪽까지 펼친 상태다. */
  deep?: boolean;
  /** 고르는 중이면 왼쪽에 체크박스를 둔다. */
  check?: { checked: boolean; pending?: boolean; onToggle: () => void };
  /** 0 이면 년월 줄, 1 이면 그 안의 줄. 왼쪽 여백으로 계층을 보인다. */
  depth: 0 | 1;
  onPress: () => void;
}) {
  const currency = useProjectDisplayCurrency();

  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center gap-2 border-b border-gray-100 py-3 pr-3 active:bg-gray-50 ${
        depth === 0 ? 'pl-3' : 'pl-6 bg-gray-50/50'
      }`}
    >
      {check ? (
        <CheckBox checked={check.checked} pending={check.pending} onPress={check.onToggle} />
      ) : null}
      <Caret open={Boolean(open)} deep={deep} />
      <View className="flex-1">
        <Text
          numberOfLines={1}
          className={`text-gray-900 ${depth === 0 ? 'text-base font-semibold' : 'text-[15px] font-medium'}`}
        >
          {label}
        </Text>
        {sub ? <Text className="mt-0.5 text-xs text-gray-500">{sub}</Text> : null}
      </View>
      <View className="items-end">
        {expense > 0 ? (
          <Text className="text-[15px] font-semibold text-red-600">
            -{formatCurrency(expense, currency)}
          </Text>
        ) : null}
        {income > 0 ? (
          <Text className="text-[13px] font-medium text-green-600">
            +{formatCurrency(income, currency)}
          </Text>
        ) : null}
        {expense === 0 && income === 0 ? <Text className="text-sm text-gray-400">-</Text> : null}
      </View>
    </Pressable>
  );
}

export default function TransactionsScreen() {
  const { t } = useTranslation();
  const selectedProjectId = useProject((state) => state.selectedProjectId);
  const togglePersonId = useUserFilter((state) => state.togglePersonId);
  const selectedPersonIds = useUserFilter((state) => state.selectedPersonIds);
  const myPersonId = useMyPersonId();

  const tx = useTransactions(selectedProjectId);
  /*
   * 사람 목록과 선택을 이 프로젝트에 맞춘다.
   *
   * 가계 화면도 같은 일을 하지만 그쪽을 한 번도 열지 않고 여기로 바로 올 수 있다.
   * 맞추지 않으면 제목이 이름을 잃고, 저장해 둔 선택이 남의 프로젝트 것으로 남는다.
   */
  usePersonFilterSync(selectedProjectId, tx.people);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  /** 더보기 선택창. 지금은 삭제 하나뿐이다. */
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  /** 상세를 띄운 거래. null 이면 닫힌 상태다. */
  const [detail, setDetail] = useState<EntryListItem | null>(null);
  /** 지우다 남은 것 같은 알림. 빈 글자면 아무것도 그리지 않는다. */
  const [notice, setNotice] = useState('');

  /**
   * 지우기 전에 묻는다. 몇 건인지 함께 적는다.
   *
   * 년월 줄을 체크하면 수십 건이 한꺼번에 골라질 수 있다. 그 숫자를 보여 주지 않으면
   * 무엇을 지우는지 모르고 확인을 누른다.
   */
  const askDelete = () => {
    if (tx.selectedCount === 0) {
      setNotice(t('tx.deleteNone'));
      return;
    }

    Alert.alert(
      t('tx.deleteConfirm', { count: tx.selectedCount }),
      t('tx.deleteConfirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('entryForm.delete'),
          style: 'destructive',
          onPress: () => {
            void tx.deleteSelected().then(({ failed }) => {
              setNotice(failed > 0 ? t('tx.deleteFailed', { count: failed }) : '');
            });
          },
        },
      ],
    );
  };

  const entryList = (yearMonth: string, key: string) => (
    <View className="border-b border-gray-100 bg-white pl-6">
      {tx.isLoadingRow(yearMonth, key) ? (
        <Text className="py-3 text-sm text-gray-500">{t('common.loading')}</Text>
      ) : tx.entriesOf(yearMonth, key).length === 0 ? (
        <Text className="py-3 text-sm text-gray-500">{t('feed.empty')}</Text>
      ) : (
        tx.entriesOf(yearMonth, key).map((entry) =>
          /*
           * 고르는 중에는 누름의 뜻이 바뀐다. 상세를 띄우는 대신 체크한다.
           *
           * TransactionItem 은 가계 화면도 쓰는 컴포넌트라 손대지 않고, 체크박스를
           * 옆에 세우고 누름만 갈아 끼운다.
           */
          tx.isSelecting ? (
            <View key={entry.id} className="flex-row items-center gap-2 pl-1">
              <CheckBox
                checked={tx.isEntrySelected(entry.id)}
                onPress={() => tx.toggleEntrySelected(entry.id)}
              />
              <View className="flex-1">
                <TransactionItem
                  entry={entry}
                  onPress={() => tx.toggleEntrySelected(entry.id)}
                />
              </View>
            </View>
          ) : (
            <TransactionItem key={entry.id} entry={entry} onPress={() => setDetail(entry)} />
          ),
        )
      )}
    </View>
  );

  /** 그 달의 안쪽 줄. 세 탭이 같은 모양으로 내려오므로 한 번만 적는다. */
  const level2 = (yearMonth: string) => {
    if (tx.isLoadingMonth(yearMonth)) {
      return <Text className="py-3 pl-6 text-sm text-gray-500">{t('common.loading')}</Text>;
    }

    const rows = tx.rowsOf(yearMonth);
    if (rows.length === 0) {
      const emptyKey: MessageKey =
        tx.tab === 'date' ? 'tx.noDays' : tx.tab === 'category' ? 'tx.noCategories' : 'tx.noMethods';
      return <Text className="py-3 pl-6 text-sm text-gray-500">{t(emptyKey)}</Text>;
    }

    return rows.map((row: TransactionRow) => {
      const open = tx.isRowOpen(yearMonth, row.key);
      return (
        <View key={`${tx.tab}-${row.key}`}>
          <Line
            depth={1}
            label={row.label}
            sub={row.sub ?? (row.count === undefined ? undefined : t('tx.entryCount', { count: row.count }))}
            expense={row.expense}
            income={row.income}
            open={open}
            check={
              tx.isSelecting
                ? {
                    checked: tx.rowChecked(yearMonth, row.key),
                    pending: tx.isRangePending(yearMonth, row.key),
                    onToggle: () => void tx.toggleRange(yearMonth, row),
                  }
                : undefined
            }
            onPress={() => tx.toggleRow(yearMonth, row.key)}
          />
          {open ? entryList(yearMonth, row.key) : null}
        </View>
      );
    });
  };

  return (
    <View className="gap-4">
      {/*
        고르는 중에는 머리글이 통째로 바뀐다.
        뒤로가기 · 몇 개를 골랐는지 · 삭제. 제목과 검색은 그때 쓸 것이 아니다.
      */}
      {tx.isSelecting ? (
        <View className="flex-row items-center gap-3">
          <Pressable
            onPress={tx.stopSelecting}
            accessibilityLabel={t('common.back')}
            className="h-9 w-9 items-center justify-center rounded-lg border border-gray-300 bg-white active:bg-gray-50"
          >
            <ArrowLeft size={18} color="#4b5563" />
          </Pressable>
          <Text className="flex-1 text-base font-semibold text-gray-900">
            {t('tx.selected', { count: tx.selectedCount })}
          </Text>
          <Pressable
            onPress={askDelete}
            disabled={tx.isDeleting}
            accessibilityLabel={t('tx.deleteSelected')}
            className={`h-9 w-9 items-center justify-center rounded-lg border border-red-300 bg-white active:bg-red-50 ${
              tx.isDeleting ? 'opacity-50' : ''
            }`}
          >
            <Trash2 size={18} color="#dc2626" />
          </Pressable>
        </View>
      ) : (
        <PageHeader
          title={
            <PersonScopeTitle
              noun={t('tx.noun')}
              people={tx.people}
              myPersonId={myPersonId}
              selectedPersonIds={selectedPersonIds}
              onTogglePerson={togglePersonId}
            />
          }
          action={
            <View className="flex-row gap-2">
              <Pressable
                onPress={() => setIsSearchOpen(true)}
                accessibilityLabel={t('tx.search')}
                className={`flex-row items-center gap-1.5 rounded-lg border px-3 py-2 active:bg-gray-50 ${
                  tx.searchCount > 0 ? 'border-blue-600 bg-blue-50' : 'border-gray-300 bg-white'
                }`}
              >
                {/* 돋보기만 둔다. 몇 개를 걸어 두었는지는 옆에 숫자로 붙인다. */}
                <Search size={18} color={tx.searchCount > 0 ? '#2563eb' : '#4b5563'} />
                {tx.searchCount > 0 ? (
                  <Text className="text-sm font-semibold text-blue-600">{tx.searchCount}</Text>
                ) : null}
              </Pressable>
              <Pressable
                onPress={() => setIsMoreOpen(true)}
                accessibilityLabel={t('tx.more')}
                className="items-center justify-center rounded-lg border border-gray-300 bg-white px-2 py-2 active:bg-gray-50"
              >
                <MoreVertical size={18} color="#4b5563" />
              </Pressable>
            </View>
          }
        />
      )}

      {tx.hasError ? (
        <View className="rounded-lg bg-red-50 p-3">
          <Text className="text-sm text-red-800">{t('tx.loadFailed')}</Text>
        </View>
      ) : null}

      {notice ? (
        <View className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <Text className="text-sm text-amber-800">{notice}</Text>
        </View>
      ) : null}

      {/* 보기 방식. 년월 목록 위에 두어 어떤 기준으로 파고드는지 먼저 정한다. */}
      <View className="flex-row gap-2 rounded-lg bg-gray-200 p-1">
        {TABS.map((item) => {
          const active = tx.tab === item.id;
          return (
            <Pressable
              key={item.id}
              onPress={() => tx.changeTab(item.id)}
              className={`flex-1 items-center rounded-md px-4 py-2 ${active ? 'bg-white' : ''}`}
            >
              <Text className={`font-medium ${active ? 'text-blue-600' : 'text-gray-600'}`}>
                {t(item.labelKey)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/*
        걸려 있는 조건. 탭 바로 아래에 둔다.

        검색 창을 열어야 무엇을 골랐는지 알 수 있으면, 결과가 비었을 때 이유를 찾으려
        창을 다시 열게 된다. 여기 늘어놓으면 그 걸음이 사라지고, 하나만 빼는 일도
        창을 열지 않고 끝난다.

        많아지면 가로로 굴린다. 줄바꿈으로 두면 조건이 열 개 넘을 때 목록이 화면 밖으로
        밀린다.
      */}
      {tx.searchChips.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          /*
           * 늘어나지 않게 못 박는다. ScrollView 는 기본 스타일에 flexGrow:1 이 있어
           * 세로로 늘어선 칸 안에서 남는 높이를 먹는다. 알약 줄은 알약 높이면 된다.
           */
          className="grow-0"
          contentContainerClassName="flex-row items-center gap-2 pr-4"
        >
          {tx.searchChips.map((chip) => (
            <Pressable
              key={chip.id}
              onPress={() => tx.removeSearchChip(chip.id)}
              // 손가락이 닿는 자리라 알약 자체를 누르게 한다. x 만 누르게 하면 빗나간다.
              accessibilityLabel={`${chip.label} ${t('tx.search.chipRemove')}`}
              className="flex-row items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 py-1.5 pl-3 pr-2 active:bg-blue-100"
            >
              <Text className="text-sm font-medium text-blue-700">{chip.label}</Text>
              <X size={14} color="#1d4ed8" />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <View className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        {tx.isLoadingMonths && tx.months.length === 0 ? (
          <Text className="p-3 text-sm text-gray-500">{t('common.loading')}</Text>
        ) : tx.months.length === 0 ? (
          <Text className="p-3 text-sm text-gray-500">{t('tx.noMonths')}</Text>
        ) : (
          tx.months.map((month) => {
            const level = tx.levelOf(month.yearMonth);
            return (
              <View key={month.yearMonth}>
                <Line
                  depth={0}
                  label={monthLabel(month.yearMonth)}
                  expense={toNumber(month.expense)}
                  income={toNumber(month.income)}
                  open={level >= 1}
                  /* 2단은 안쪽까지 펼친 상태다. 표시를 달리 해 어디까지 열렸는지 보인다. */
                  deep={level === 2}
                  check={
                    tx.isSelecting
                      ? {
                          checked: tx.monthChecked(month.yearMonth),
                          pending: tx.isRangePending(month.yearMonth),
                          onToggle: () => void tx.toggleRange(month.yearMonth),
                        }
                      : undefined
                  }
                  onPress={() => tx.cycleMonth(month.yearMonth)}
                />
                {level >= 1 ? <View>{level2(month.yearMonth)}</View> : null}
              </View>
            );
          })
        )}
      </View>

      <TransactionSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onApply={tx.setSearch}
        current={tx.search}
        categories={tx.pickerCategories}
        accounts={tx.pickerAccounts}
        cards={tx.pickerCards}
      />

      {/*
        더보기 선택창. 지금은 삭제 하나뿐이라 목록 하나로 둔다.
        메뉴가 늘면 이 자리에 줄을 더한다.
      */}
      <Modal isOpen={isMoreOpen} onClose={() => setIsMoreOpen(false)} title={t('tx.more')}>
        <Pressable
          onPress={() => {
            setIsMoreOpen(false);
            setNotice('');
            tx.startSelecting();
          }}
          className="flex-row items-center gap-3 rounded-lg px-2 py-3 active:bg-gray-50"
        >
          <Trash2 size={18} color="#dc2626" />
          <Text className="text-base text-gray-900">{t('tx.select')}</Text>
        </Pressable>
      </Modal>

      <EntryDetailModal entry={detail} onClose={() => setDetail(null)} />
    </View>
  );
}

/** "2026-08" 을 화면의 달 이름으로. core 의 형식기는 숫자 둘을 받는다. */
function monthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  return formatYearMonth(year, month);
}
