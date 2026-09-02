'use client';

/*
 * 거래. 오간 돈을 훑어보는 자리다.
 *
 * 세 겹으로 파고든다. **년월 -> (날짜·분류·수단) -> 거래.** 줄을 누르면 바로 아래가
 * 펼쳐지고 다시 누르면 접힌다. 화면을 갈아 끼우지 않으므로 어느 달의 어느 분류를 보고
 * 있는지가 줄의 위치로 남는다.
 *
 * 이 화면은 고치지 않는다. 줄을 누르면 편집기가 아니라 상세가 뜬다. 거래를 적고 고치는
 * 자리는 가계 화면이다.
 *
 * 값과 상태는 `useTransactions` 가 갖는다. 앱의 거래 화면과 같은 훅이라, 두 화면이
 * 서로 다른 규칙으로 파고들 일이 없다.
 */
import { useState } from 'react';
import { ArrowLeft, Check, Loader2, MoreVertical, Search, Trash2 } from 'lucide-react';
import {
  SEARCHABLE_ENTRY_KINDS,
  type EntryKind,
  type EntryListItem as EntryListItemDto,
} from '@money/types';

import { formatDateTime, formatYearMonth } from '@money/core/lib/datetime';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import {
  EMPTY_SEARCH,
  useTransactions,
  type TransactionRow,
  type TransactionSearch,
  type TransactionTab,
} from '@money/core/hooks/useTransactions';
import { usePersonFilterSync } from '@money/core/hooks/usePersonFilterSync';
import { useMyPersonId, useProjectDisplayCurrency, useProjectTimeZone } from '@money/core/store/project';
import { useUserFilter } from '@money/core/store/user-filter';

import Modal from '@/components/Modal';
import PageHeader from '@/components/PageHeader';
import PersonScopeTitle from '@/components/PersonScopeTitle';
import TransactionItem from '@/components/TransactionItem';
import { useProjectGuard } from '@/hooks/useProjectGuard';

const TABS: Array<{ id: TransactionTab; labelKey: MessageKey }> = [
  { id: 'date', labelKey: 'tx.tab.date' },
  { id: 'category', labelKey: 'tx.tab.category' },
  { id: 'method', labelKey: 'tx.tab.method' },
];

/** "2026-08" 을 화면의 달 이름으로. core 의 형식기는 숫자 둘을 받는다. */
function monthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  return formatYearMonth(year, month);
}

/**
 * 체크박스. 세 상태를 보인다 -- 빈 칸 / 체크 / 줄(일부만 고름).
 *
 * 년월 줄은 그 달의 거래 일부만 골랐을 수 있어 셋이 필요하다.
 */
/**
 * 체크박스. 켜짐과 꺼짐 둘뿐이다.
 *
 * **반쯤 골라진 상태를 따로 그리지 않는다** -- 지우는 화면에서 애매한 표시는 "이걸
 * 누르면 무엇이 지워지는가"를 흐린다. 줄에 든 거래가 하나라도 빠지면 꺼진 것으로 본다.
 */
function CheckBox({
  checked,
  pending,
  onToggle,
}: {
  checked: boolean;
  /** 그 범위의 거래를 세는 중. 누른 것이 먹혔다는 표시가 된다. */
  pending?: boolean;
  onToggle: () => void;
}) {
  if (pending) {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-blue-600" aria-hidden />
      </span>
    );
  }

  return (
    <span
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      onKeyDown={(event) => {
        if (event.key !== ' ' && event.key !== 'Enter') return;
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
        checked ? 'border-blue-600 bg-blue-600' : 'border-gray-400 bg-white'
      }`}
    >
      {checked ? <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} /> : null}
    </span>
  );
}

/**
 * 한 줄. 오른쪽에 지출과 수입을 함께 적는다.
 *
 * 한쪽만 적으면 이체가 섞인 달에서 줄의 금액과 아래를 펴서 나온 거래의 합이 어긋나
 * 보인다.
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
  onClick,
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
  onClick: () => void;
}) {
  const currency = useProjectDisplayCurrency();

  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={Boolean(open)}
      className={`flex w-full items-center gap-2 border-b border-gray-100 py-3 pr-3 text-left hover:bg-gray-50 ${
        depth === 0 ? 'pl-3' : 'bg-gray-50/50 pl-8'
      }`}
    >
      {check ? (
        <CheckBox checked={check.checked} pending={check.pending} onToggle={check.onToggle} />
      ) : null}
      {/*
        세 상태를 글자 하나로 보인다. ▸ 접힘 / ▾ 안쪽 목록까지 / ▾▾ 거래까지.
        두 단계를 같은 모양으로 두면 한 번 더 누를 자리가 있는지 알 수 없다.
      */}
      <span className={`w-4 text-gray-400 ${deep ? 'text-[10px]' : ''}`}>
        {open ? (deep ? '▾▾' : '▾') : '▸'}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-gray-900 ${
            depth === 0 ? 'text-base font-semibold' : 'text-[15px] font-medium'
          }`}
        >
          {label}
        </span>
        {sub ? <span className="mt-0.5 block text-xs text-gray-500">{sub}</span> : null}
      </span>
      <span className="text-right">
        {expense > 0 ? (
          <span className="block text-[15px] font-semibold text-red-600">
            -{formatCurrency(expense, currency)}
          </span>
        ) : null}
        {income > 0 ? (
          <span className="block text-[13px] font-medium text-green-600">
            +{formatCurrency(income, currency)}
          </span>
        ) : null}
        {expense === 0 && income === 0 ? <span className="text-sm text-gray-400">-</span> : null}
      </span>
    </button>
  );
}

function toggleId<T extends string>(ids: T[], id: T): T[] {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
}

/** 유형 이름. 열쇠를 이어 붙이지 않고 적어 두어 사전에서 찾을 수 있게 한다. */
const KIND_LABEL: Record<EntryKind, MessageKey> = {
  expense: 'tx.kind.expense',
  income: 'tx.kind.income',
  transfer: 'tx.kind.transfer',
  card_payment: 'tx.kind.card_payment',
  adjustment: 'entry.adjustment',
};

export default function TransactionsPage() {
  const { t } = useTranslation();
  const selectedProjectId = useProjectGuard();
  const timeZone = useProjectTimeZone();
  const currency = useProjectDisplayCurrency();
  const myPersonId = useMyPersonId();
  const selectedPersonIds = useUserFilter((state) => state.selectedPersonIds);
  const togglePersonId = useUserFilter((state) => state.togglePersonId);

  const tx = useTransactions(selectedProjectId);
  // 사람 목록과 선택을 프로젝트에 맞춘다. 다른 화면과 같은 훅을 쓴다.
  usePersonFilterSync(selectedProjectId, tx.people);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  /** 더보기 선택창. 지금은 삭제 하나뿐이다. */
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  /** 지우다 남은 것 같은 알림. 빈 글자면 아무것도 그리지 않는다. */
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState<TransactionSearch>(EMPTY_SEARCH);
  const [detail, setDetail] = useState<EntryListItemDto | null>(null);

  /**
   * 펼친 자리의 거래 목록.
   *
   * 달과 줄을 받아 그때그때 만든다. 여러 달을 함께 펼 수 있어서 목록이 하나가 아니다.
   */
  /**
   * 지우기 전에 묻는다. 몇 건인지 함께 적는다.
   *
   * 년월 줄을 체크하면 수십 건이 한꺼번에 골라질 수 있다. 그 숫자를 보여 주지 않으면
   * 무엇을 지우는지 모르고 확인을 누른다. 묻는 방식은 웹의 다른 삭제와 같다.
   */
  const askDelete = async () => {
    if (tx.selectedCount === 0) {
      setNotice(t('tx.deleteNone'));
      return;
    }
    if (!window.confirm(t('tx.deleteConfirm', { count: tx.selectedCount }))) return;

    const { failed } = await tx.deleteSelected();
    setNotice(failed > 0 ? t('tx.deleteFailed', { count: failed }) : '');
  };

  const entryList = (yearMonth: string, key: string) => (
    <div className="border-b border-gray-100 bg-white pl-8">
      {tx.isLoadingRow(yearMonth, key) ? (
        <p className="py-3 text-sm text-gray-500">{t('common.loading')}</p>
      ) : tx.entriesOf(yearMonth, key).length === 0 ? (
        <p className="py-3 text-sm text-gray-500">{t('feed.empty')}</p>
      ) : (
        tx.entriesOf(yearMonth, key).map((entry) =>
          /*
           * 고르는 중에는 누름의 뜻이 바뀐다. 상세를 띄우는 대신 체크한다.
           *
           * TransactionItem 은 가계 화면도 쓰는 컴포넌트라 손대지 않고, 체크박스를
           * 옆에 세우고 누름만 갈아 끼운다.
           */
          tx.isSelecting ? (
            <div key={entry.id} className="flex items-center gap-2 pl-1">
              <CheckBox
                checked={tx.isEntrySelected(entry.id)}
                onToggle={() => tx.toggleEntrySelected(entry.id)}
              />
              <div className="min-w-0 flex-1">
                <TransactionItem entry={entry} onClick={() => tx.toggleEntrySelected(entry.id)} />
              </div>
            </div>
          ) : (
            <TransactionItem key={entry.id} entry={entry} onClick={() => setDetail(entry)} />
          ),
        )
      )}
    </div>
  );

  /** 그 달의 안쪽 줄. 세 탭이 같은 모양으로 내려오므로 한 번만 적는다. */
  const level2 = (yearMonth: string) => {
    if (tx.isLoadingMonth(yearMonth)) {
      return <p className="py-3 pl-8 text-sm text-gray-500">{t('common.loading')}</p>;
    }

    const rows = tx.rowsOf(yearMonth);
    if (rows.length === 0) {
      const emptyKey: MessageKey =
        tx.tab === 'date' ? 'tx.noDays' : tx.tab === 'category' ? 'tx.noCategories' : 'tx.noMethods';
      return <p className="py-3 pl-8 text-sm text-gray-500">{t(emptyKey)}</p>;
    }

    return rows.map((row: TransactionRow) => {
      const open = tx.isRowOpen(yearMonth, row.key);
      return (
        <div key={`${tx.tab}-${row.key}`}>
          <Line
            depth={1}
            label={row.label}
            sub={
              row.sub ?? (row.count === undefined ? undefined : t('tx.entryCount', { count: row.count }))
            }
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
            onClick={() => tx.toggleRow(yearMonth, row.key)}
          />
          {open ? entryList(yearMonth, row.key) : null}
        </div>
      );
    });
  };

  /** 검색 팝업의 알약 하나. */
  const Chip = ({
    label,
    selected,
    onClick,
  }: {
    label: string;
    selected: boolean;
    onClick: () => void;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm ${
        selected
          ? 'border-blue-600 bg-blue-50 font-medium text-blue-600'
          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  );

  const draftCount =
    draft.categoryIds.length +
    draft.paymentAccountIds.length +
    draft.paymentCardIds.length +
    draft.kinds.length;

  const detailRows: Array<{ label: string; value: string | null }> = detail
    ? [
        { label: t('tx.detail.date'), value: formatDateTime(detail.date, timeZone) },
        { label: t('tx.detail.person'), value: detail.personName },
        {
          label: t('tx.detail.category'),
          value: detail.parentCategoryName
            ? `${detail.parentCategoryName} > ${detail.categoryName}`
            : detail.categoryName,
        },
        {
          label: t('tx.detail.method'),
          value: detail.cardName ?? detail.accountName,
        },
        { label: t('tx.detail.merchant'), value: detail.merchant },
        {
          label: detail.kind === 'income' ? t('tx.detail.extraIncome') : t('tx.detail.extra'),
          value: toNumber(detail.extraAmount) > 0 ? formatCurrency(detail.extraAmount, currency) : null,
        },
        {
          label: t('tx.detail.installment'),
          value: detail.installmentMonths
            ? t('tx.detail.installmentMonths', { months: detail.installmentMonths })
            : null,
        },
        {
          label: t('tx.detail.fee'),
          value:
            detail.feeAmount && toNumber(detail.feeAmount) > 0
              ? formatCurrency(detail.feeAmount, currency)
              : null,
        },
        {
          label: t('tx.detail.original'),
          value:
            detail.originalCurrency && detail.originalAmount
              ? formatCurrency(detail.originalAmount, detail.originalCurrency)
              : null,
        },
        {
          label: t('tx.detail.split'),
          value: detail.splitCount > 1 ? t('tx.detail.split', { count: detail.splitCount }) : null,
        },
        { label: t('tx.detail.note'), value: detail.detailedNote },
      ]
    : [];

  return (
    <div className="space-y-4">
      {/*
        고르는 중에는 머리글이 통째로 바뀐다.
        뒤로가기 · 몇 개를 골랐는지 · 삭제. 제목과 검색은 그때 쓸 것이 아니다.
      */}
      {tx.isSelecting ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={tx.stopSelecting}
            aria-label={t('common.back')}
            title={t('common.back')}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 bg-white hover:bg-gray-50"
          >
            <ArrowLeft className="h-4 w-4 text-gray-600" aria-hidden />
          </button>
          <p className="flex-1 text-base font-semibold text-gray-900">
            {t('tx.selected', { count: tx.selectedCount })}
          </p>
          <button
            type="button"
            onClick={askDelete}
            disabled={tx.isDeleting}
            aria-label={t('tx.deleteSelected')}
            title={t('tx.deleteSelected')}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-red-300 bg-white hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4 text-red-600" aria-hidden />
          </button>
        </div>
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
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setDraft(tx.search);
                  setIsSearchOpen(true);
                }}
                aria-label={t('tx.search')}
                title={t('tx.search')}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium ${
                  tx.searchCount > 0
                    ? 'border-blue-600 bg-blue-50 text-blue-600'
                    : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {/* 돋보기만 둔다. 몇 개를 걸어 두었는지는 옆에 숫자로 붙인다. */}
                <Search className="h-4 w-4" aria-hidden />
                {tx.searchCount > 0 ? (
                  <span className="font-semibold">{tx.searchCount}</span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => setIsMoreOpen(true)}
                aria-label={t('tx.more')}
                title={t('tx.more')}
                className="flex items-center justify-center rounded-lg border border-gray-300 bg-white px-2 py-2 text-gray-600 hover:bg-gray-50"
              >
                <MoreVertical className="h-4 w-4" aria-hidden />
              </button>
            </div>
          }
        />
      )}

      {tx.hasError ? (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{t('tx.loadFailed')}</div>
      ) : null}

      {notice ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {notice}
        </div>
      ) : null}

      {tx.searchCount > 0 ? (
        <button
          type="button"
          onClick={() => tx.setSearch(EMPTY_SEARCH)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          {t('tx.search.off')}
        </button>
      ) : null}

      <div className="flex gap-2 rounded-lg bg-gray-200 p-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => tx.changeTab(item.id)}
            className={`flex-1 rounded-md px-4 py-2 font-medium ${
              tx.tab === item.id ? 'bg-white text-blue-600' : 'text-gray-600'
            }`}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        {tx.isLoadingMonths && tx.months.length === 0 ? (
          <p className="p-3 text-sm text-gray-500">{t('common.loading')}</p>
        ) : tx.months.length === 0 ? (
          <p className="p-3 text-sm text-gray-500">{t('tx.noMonths')}</p>
        ) : (
          tx.months.map((month) => {
            const level = tx.levelOf(month.yearMonth);
            return (
              <div key={month.yearMonth}>
                <Line
                  depth={0}
                  label={monthLabel(month.yearMonth)}
                  expense={toNumber(month.expense)}
                  income={toNumber(month.income)}
                  open={level >= 1}
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
                  onClick={() => tx.cycleMonth(month.yearMonth)}
                />
                {level >= 1 ? <div>{level2(month.yearMonth)}</div> : null}
              </div>
            );
          })
        )}
      </div>

      {/*
        더보기 선택창. 지금은 삭제 하나뿐이라 목록 하나로 둔다.
        메뉴가 늘면 이 자리에 줄을 더한다.
      */}
      <Modal isOpen={isMoreOpen} onClose={() => setIsMoreOpen(false)} title={t('tx.more')}>
        <button
          type="button"
          onClick={() => {
            setIsMoreOpen(false);
            setNotice('');
            tx.startSelecting();
          }}
          className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left hover:bg-gray-50"
        >
          <Trash2 className="h-4 w-4 text-red-600" aria-hidden />
          <span className="text-base text-gray-900">{t('tx.select')}</span>
        </button>
      </Modal>

      <Modal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        title={t('tx.search')}
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDraft(EMPTY_SEARCH)}
              className="rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {t('tx.search.clear')}
            </button>
            <button
              type="button"
              onClick={() => {
                tx.setSearch(draft);
                setIsSearchOpen(false);
              }}
              className="flex-1 rounded-lg bg-blue-600 px-4 py-3 text-base font-semibold text-white hover:bg-blue-700"
            >
              {t('tx.search.apply')}
              {draftCount > 0 ? ` (${draftCount})` : ''}
            </button>
          </div>
        }
      >
        {tx.pickerCategories.length === 0 &&
        tx.pickerAccounts.length === 0 &&
        tx.pickerCards.length === 0 ? (
          <p className="text-sm text-gray-600">{t('tx.search.empty')}</p>
        ) : (
          <div className="space-y-5">
            {/*
              유형을 맨 위에 둔다. 넷뿐이고, 이체나 카드정산만 보려는 사람에게는 이 칸
              하나로 끝난다. 분류가 수십 개라 아래에 두면 굴려서 찾아야 한다.
            */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
                {t('tx.search.kinds')}
              </p>
              <div className="flex flex-wrap gap-2">
                {SEARCHABLE_ENTRY_KINDS.map((kind) => (
                  <Chip
                    key={kind}
                    label={t(KIND_LABEL[kind])}
                    selected={draft.kinds.includes(kind)}
                    onClick={() =>
                      setDraft((prev) => ({ ...prev, kinds: toggleId(prev.kinds, kind) }))
                    }
                  />
                ))}
              </div>
              <p className="mt-2 text-xs leading-5 text-gray-500">{t('tx.search.kindHint')}</p>
            </div>

            {tx.pickerCategories.length > 0 ? (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
                  {t('tx.search.categories')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {tx.pickerCategories.map((category) => {
                    const parent = tx.pickerCategories.find((row) => row.id === category.parentId);
                    return (
                      <Chip
                        key={category.id}
                        label={parent ? `${parent.name} > ${category.name}` : category.name}
                        selected={draft.categoryIds.includes(category.id)}
                        onClick={() =>
                          setDraft((prev) => ({
                            ...prev,
                            categoryIds: toggleId(prev.categoryIds, category.id),
                          }))
                        }
                      />
                    );
                  })}
                </div>
              </div>
            ) : null}

            {tx.pickerAccounts.length > 0 ? (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
                  {t('tx.search.accounts')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {tx.pickerAccounts.map((account) => (
                    <Chip
                      key={account.id}
                      label={account.name}
                      selected={draft.paymentAccountIds.includes(account.id)}
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          paymentAccountIds: toggleId(prev.paymentAccountIds, account.id),
                        }))
                      }
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {tx.pickerCards.length > 0 ? (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
                  {t('tx.search.cards')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {tx.pickerCards.map((card) => (
                    <Chip
                      key={card.id}
                      label={card.name}
                      selected={draft.paymentCardIds.includes(card.id)}
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          paymentCardIds: toggleId(prev.paymentCardIds, card.id),
                        }))
                      }
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </Modal>

      <Modal
        isOpen={detail !== null}
        onClose={() => setDetail(null)}
        title={t('tx.detail.title')}
      >
        {detail ? (
          <div>
            <p className="mb-1 text-3xl font-bold text-gray-900">
              {formatCurrency(detail.amount, currency)}
            </p>
            <p className="mb-4 text-base text-gray-600">
              {detail.description || t('entry.noTitle')}
            </p>
            {detailRows
              .filter((row) => row.value)
              .map((row) => (
                <div
                  key={row.label}
                  className="flex items-baseline justify-between gap-4 border-b border-gray-100 py-2.5"
                >
                  <span className="text-sm text-gray-500">{row.label}</span>
                  <span className="flex-1 text-right text-[15px] text-gray-900">{row.value}</span>
                </div>
              ))}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
