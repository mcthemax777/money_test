'use client';

/*
 * 거래 검색 창. 거래 탭과 분석 탭이 함께 쓴다 (앱의 TransactionSearchModal 과 같은 짝).
 *
 * 규칙은 **같은 칸에서 고른 것끼리 또는(OR), 칸끼리는 그리고(AND)** 다. 규칙 자체는
 * `@money/types` 의 parseEntrySearch 가 갖고, 서버와 사본이 같은 것을 쓴다.
 *
 * 고르는 동안에는 목록을 바꾸지 않는다. 적용을 눌러야 걸리고, 그 전에는 몇 개를 골랐는지만
 * 단추에 적는다. 열 때마다 지금 걸린 검색(`current`)에서 다시 시작한다.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Check, Minus } from 'lucide-react';
import {
  ENTRY_FEATURES,
  NO_ACCOUNT,
  NO_PERSON,
  NO_TAG,
  SEARCHABLE_ENTRY_KINDS,
  selfCategoryPick,
  type AccountDto,
  type CardDto,
  type CategoryDto,
  type EntryBasis,
  type EntryPeriodUnit,
  type PersonDto,
  type TagDto,
  type WeekStart,
} from '@money/types';

import { formatMonthShort, weekdayNames } from '@money/core/lib/datetime';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import {
  assetOwnerNames,
  groupByOwner,
  hasSeveralOwners,
  sortCardsByAccount,
} from '@money/core/lib/asset-owner';
import {
  groupCategoriesByType,
  categoryPickState,
  toggleCategory,
} from '@money/core/lib/category-tree';
import {
  EMPTY_SEARCH,
  ENTRY_FEATURE_LABEL,
  ENTRY_KIND_LABEL,
  periodCutOf,
  searchPeriodModeOf,
  searchRange,
  withSearchPeriodMode,
  type SearchPeriodMode,
  type TransactionSearch,
} from '@money/core/hooks/useTransactions';

import Modal from './Modal';
import SearchTemplates from './SearchTemplates';
import SegmentedTabs from './SegmentedTabs';

/** 묶는 단위. 좁은 것에서 넓은 것으로 간다. */
const UNITS: Array<{ id: EntryPeriodUnit; labelKey: MessageKey }> = [
  { id: 'week', labelKey: 'tx.unit.week' },
  { id: 'month', labelKey: 'tx.unit.month' },
  { id: 'year', labelKey: 'tx.unit.year' },
];

/** 세는 기준. 기본인 회차 기준을 앞에 둔다. */
const BASES: EntryBasis[] = ['installment', 'accrual'];

function toggleId<T extends string>(ids: T[], id: T): T[] {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
}

/**
 * 분류 칸의 가름표. 대분류 뒤의 `›` 와 묶음 끝의 `/`.
 *
 * 누를 수 없는 글자다. 상자 대신 이것으로 묶음의 경계를 말한다. 대분류 뒤는 꺾쇠다 --
 * 알약에 적히는 "식비 › 식료품" 과 같은 기호라 뒤따르는 것이 그 아래 소분류임이
 * 한눈에 읽힌다.
 */
const Divider = ({ mark }: { mark: '›' | '/' }) => (
  <span className="select-none text-sm text-gray-300" aria-hidden>
    {mark}
  </span>
);

/** 검색 팝업의 알약 하나. */
export const Chip = ({
  label,
  selected,
  covered,
  onClick,
  color,
  partial,
  mark,
  subtle,
}: {
  label: string;
  selected: boolean;
  /**
   * 고른 것은 아니지만 함께 걸리는 자리 (대분류를 켰을 때의 그 소분류).
   *
   * 파랗게 칠하지 않고 옅은 파란 테두리와 글자만 남긴다. 켠 것과 같은 모양으로 두면
   * 대분류 하나를 눌렀을 때 아래가 전부 켜져 보여, 무엇을 골랐는지 읽을 수 없다.
   */
  covered?: boolean;
  onClick: () => void;
  /** 태그의 색. 그 밖의 알약은 색이 없다. */
  color?: string | null;
  /**
   * 고른 거래 중 일부만 가진 태그.
   *
   * 켜진 것과 같은 파랑으로 두면 둘을 구별할 수 없고, 꺼진 것과 같은 회색으로 두면
   * 아무도 가지지 않은 것과 구별할 수 없다. 색은 켜짐과 나누고 표시는 꺼짐과 나눈다.
   */
  partial?: boolean;
  /**
   * 켜짐·일부를 아이콘으로도 보여 줄지. 태그를 손보는 창이 쓴다.
   *
   * 그 창은 세 갈래(켜짐·일부·꺼짐)를 갈라야 해서 색만으로는 모자란다. 자리는 상태와
   * 상관없이 늘 잡아 둔다 -- 아이콘이 들락거리면 누를 때마다 알약의 너비가 달라져
   * 뒤따르는 알약이 줄을 넘나든다.
   */
  mark?: boolean;
  /**
   * 소분류처럼 한 단 아래인 알약.
   *
   * 테두리를 감추고 글자를 얇게 한다. 크기는 그대로다 -- 대분류가 먼저 눈에 들어오되
   * 줄이 밀리지 않아야 한다. 상태가 아니라 **자리**에 따른 차이라 눌러도 달라지지 않는다.
   * 고른 소분류는 파란 테두리가 다시 보인다. 골랐다는 것은 보여야 한다.
   */
  subtle?: boolean;
}) => (
  /*
   * **누른다고 크기가 달라지지 않는다.** 테두리 굵기도 글자 굵기도 상태와 무관하게
   * 같고, 고른 것은 색으로만 말한다. 굵어지거나 아이콘이 붙으면 그만큼 넓어져,
   * 한 알약을 켰을 뿐인데 옆의 알약이 다음 줄로 밀린다.
   */
  <button
    type="button"
    onClick={onClick}
    aria-pressed={selected}
    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100 ${
      subtle ? 'font-light' : ''
    } ${
      selected
        ? 'border-blue-600 bg-blue-50 text-blue-600'
        : covered
          ? 'border-blue-200 bg-white text-blue-400 hover:bg-blue-50'
          : partial
            ? 'border-gray-400 bg-gray-50 text-gray-800'
            : subtle
              ? // 테두리를 없애지 않고 **투명하게** 둔다. 굵기가 그대로라 줄바꿈 자리가 움직이지 않는다.
                'border-transparent bg-white text-gray-500 hover:bg-gray-50'
              : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
    }`}
  >
    {color ? (
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
    ) : null}
    {label}
    {mark ? (
      <span className="flex h-3 w-3 items-center justify-center" aria-hidden>
        {selected ? <Check className="h-3 w-3" /> : partial ? <Minus className="h-3 w-3" /> : null}
      </span>
    ) : null}
  </button>
);

export default function TransactionSearchModal({
  isOpen,
  onClose,
  onApply,
  current,
  categories,
  accounts,
  cards,
  tags,
  people,
  unit,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** 적용을 누르면 고른 검색과 묶는 단위를 넘긴다. 창은 이 컴포넌트가 닫는다. */
  onApply: (search: TransactionSearch, unit: EntryPeriodUnit) => void;
  /** 지금 걸린 검색. 열 때마다 여기서 시작한다. */
  current: TransactionSearch;
  categories: CategoryDto.Response[];
  accounts: AccountDto.Response[];
  cards: CardDto.Response[];
  tags: TagDto.Response[];
  people: PersonDto.Response[];
  /**
   * 지금 묶는 단위. 이 창에서 고친다(2026-10-07 사용자 요청, 그 전엔 더보기). 기간 줄을
   * 끊는 자리는 고른 단위의 것 하나만 고른다.
   */
  unit: EntryPeriodUnit;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<TransactionSearch>(EMPTY_SEARCH);
  /** 고르는 중인 묶는 단위. 끊는 자리 칸이 이 단위의 것으로 선다. */
  const [draftUnit, setDraftUnit] = useState<EntryPeriodUnit>(unit);
  /**
   * "언제"를 무엇으로 정하는가 -- 묶는 단위(+끊는 자리)와 직접 정한 기간 중 하나다 (2026-10-08
   * 사용자 요청). 고른 쪽 칸만 선다. 다른 쪽 값은 고르는 동안엔 남겨 두고(오가도 잃지 않게)
   * 적용할 때 비운다 (`withSearchPeriodMode`).
   */
  const [periodMode, setPeriodMode] = useState<SearchPeriodMode>('unit');

  /*
   * 열 때마다 지금 걸린 검색에서 시작한다. 고르다 닫은 것은 버린다. 기간이 적힌 검색이면
   * 기간 쪽으로 연다 -- 둘 다 적힌 옛 검색도 실제로 걸던 것은 기간이다 (`searchPeriodModeOf`).
   */
  useEffect(() => {
    if (!isOpen) return;
    setDraft(current);
    setDraftUnit(unit);
    setPeriodMode(searchPeriodModeOf(current));
  }, [isOpen, current, unit]);

  /**
   * 통장·카드를 주인별로 묶어 그린다.
   *
   * 주인이 하나뿐인 가계부에서는 묶음 이름을 적지 않는다. 모든 줄에 같은 이름이
   * 붙으면 고르는 데 도움이 되지 않고 칸만 길어진다.
   */
  const OwnerGroups = <T extends { id: string }>({
    items,
    children,
  }: {
    items: T[];
    children: (item: T) => React.ReactNode;
  }) => {
    if (!showAssetOwner) {
      return <div className="flex flex-wrap gap-2">{items.map(children)}</div>;
    }

    return (
      <div className="space-y-3">
        {groupByOwner(items, assetOwners, ownerOrder).map((group) => (
          <div key={group.ownerName ?? ''}>
            <p className="mb-1.5 text-xs text-gray-500">
              {group.ownerName ?? t('scopeTitle.noPeople')}
            </p>
            <div className="flex flex-wrap gap-2">{group.items.map(children)}</div>
          </div>
        ))}
      </div>
    );
  };

  /** 지출·수입으로 가르고 대분류별로 묶은 분류. 검색 창의 분류 칸이 이 차례로 그린다. */
  const categorySections = useMemo(
    () => groupCategoriesByType(categories),
    [categories],
  );

  /** 카드는 결제 통장의 차례를 따라 세운다. 자산 화면과 같은 차례가 된다. */
  const orderedCards = useMemo(
    () => sortCardsByAccount(cards, accounts),
    [cards, accounts],
  );

  /*
   * 통장·카드의 주인. 이름이 같은 통장이 여럿이면 이름만으로는 고를 수 없다.
   * 주인이 하나뿐인 가계부에서는 묶지 않는다 -- 모든 줄에 같은 이름이 붙을 뿐이다.
   */
  const assetOwners = useMemo(
    () => assetOwnerNames(accounts, cards, people),
    [accounts, cards, people],
  );
  const showAssetOwner = hasSeveralOwners(assetOwners);
  /** 묶음의 차례. 자산 화면이 세우는 구성원 순서를 따른다. */
  const ownerOrder = useMemo(() => people.map((person) => person.name), [people]);

  /** 적용할 검색. 고르지 않은 쪽("언제")의 값을 비운 것이다. */
  const applied = withSearchPeriodMode(draft, periodMode);

  /** 검색 창에서 고른 것을 반영한다. */
  const applySearch = () => {
    onApply(applied, draftUnit);
    onClose();
  };

  /** 고른 기간. 한쪽만 적으면 그쪽이 열린 구간이다. 단위 쪽을 고르면 비어 있다. */
  const draftRange = searchRange(applied);
  /**
   * 잘못 적은 기간인가. 실재하지 않는 날짜이거나, 두 칸이 앞뒤로 뒤집힌 것.
   *
   * 한 칸만 적은 것은 여기 들지 않는다 -- 시작일만 적으면 그날부터 끝까지다.
   * 이 상태에서는 적용을 막는다. 그냥 흘려보내면 기간을 적었는데 걸리지 않는 것이
   * 되어, 사용자는 검색이 고장 났다고 읽는다.
   */
  const isRangeBroken = Boolean(applied.startDate || applied.endDate) && draftRange === null;

  const draftCount =
    (applied.text.trim() ? 1 : 0) +
    applied.categoryIds.length +
    applied.paymentAccountIds.length +
    applied.paymentCardIds.length +
    applied.kinds.length +
    applied.features.length +
    applied.tagIds.length +
    applied.entryPersonIds.length +
    (draftRange ? 1 : 0) +
    // 끊는 자리. 기간을 정했으면 쓰이지 않아 세지 않는다 (훅의 searchCount 와 같다).
    (!draftRange && periodCutOf(applied, draftUnit) ? 1 : 0) +
    // 세는 기준. 기본(회차 기준)이 아닐 때만 하나로 센다.
    (applied.basis !== 'installment' ? 1 : 0);

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => onClose()}
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
            disabled={isRangeBroken}
            onClick={applySearch}
            className="flex-1 rounded-lg bg-blue-600 px-4 py-3 text-base font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {t('tx.search.apply')}
            {draftCount > 0 ? ` (${draftCount})` : ''}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {/*
          템플릿을 맨 위에 둔다. 누르면 그 조건이 바로 걸리고 창이 닫힌다 -- 아래 칸을 하나씩
          고르는 일을 한 번에 건너뛰는 자리라 가장 먼저 눈에 들어와야 한다.
        */}
        <SearchTemplates
          draft={applied}
          draftUnit={draftUnit}
          canSaveDraft={!isRangeBroken}
          applied={{ search: current, unit }}
          onPick={(template) => {
            onApply(template.search, template.unit);
            onClose();
          }}
        />

        {/*
          글자를 그다음에 둔다.

          찾는 것이 이미 머리에 있는 사람에게는 이 한 칸이 검색의 전부다 -- "스타벅스"를
          적는 편이 분류와 카드를 골라 좁히는 것보다 빠르다. 알약을 고르는 칸들은
          무엇이 있는지 보고 고르는 자리라 그 아래에 온다.
        */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
            {t('tx.search.text')}
          </p>
          <input
            type="search"
            value={draft.text}
            onChange={(e) => setDraft((prev) => ({ ...prev, text: e.target.value }))}
            /* 엔터로 바로 적용한다. 글자를 적은 사람은 이미 무엇을 찾는지 알고 있다. */
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || isRangeBroken) return;
              applySearch();
            }}
            placeholder={t('tx.search.textPlaceholder')}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/*
          "언제". 묶는 단위(+끊는 자리)와 직접 정한 기간 중 하나를 고른다 (2026-10-08 사용자 요청).
          둘을 함께 세워 두면 기간을 정했을 때 끊는 자리가 아무 일도 하지 않는데 칸은 그대로라,
          무엇이 걸리는지 읽을 수 없었다. 고른 쪽 칸만 선다.

          고를 수 있는 분류·자산이 없어도 이 칸은 그린다. 기간은 그 목록과 무관하다.
        */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
            {t('tx.search.period')}
          </p>
          <SegmentedTabs
            tabs={[
              { id: 'unit', label: t('tx.unit') },
              { id: 'range', label: t('tx.search.periodRange') },
            ]}
            selected={periodMode}
            onSelect={setPeriodMode}
          />

          {/* 바뀐 칸이 옅은 데서 떠오른다(unfold). key 로 갈 때마다 새로 붙인다. */}
          <div key={periodMode} className="unfold mt-3">
            {periodMode === 'unit' ? (
              <>
                {/*
                  묶는 단위. 거르는 조건이 아니라 목록을 무엇으로 묶을지라 알약도 세지도 않는다.
                  아래 끊는 자리(월 시작일 등)가 이 단위를 따른다.
                */}
                <div className="flex flex-wrap gap-2">
                  {UNITS.map((item) => (
                    <Chip
                      key={item.id}
                      label={t(item.labelKey)}
                      selected={draftUnit === item.id}
                      onClick={() => setDraftUnit(item.id)}
                    />
                  ))}
                </div>

                {/*
                  기간 줄을 어디서 끊을지. 지금 묶는 단위의 것 하나만 선다 -- 달이면 시작일,
                  주면 시작 요일, 해면 시작 월이다. 거르는 조건이 아니라 줄의 경계를 옮긴다.
                */}
                <div className="mt-4">
                  <p className="mb-2 text-xs text-gray-500">
                    {t(
                      draftUnit === 'month'
                        ? 'tx.search.cutMonth'
                        : draftUnit === 'week'
                          ? 'tx.search.cutWeek'
                          : 'tx.search.cutYear',
                    )}
                  </p>
                  {draftUnit === 'month' ? (
                    // 서른한 개를 알약으로 늘어놓으면 칸 하나가 화면을 차지한다. 고르는 상자로 둔다.
                    <select
                      value={draft.monthStartDay}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, monthStartDay: Number(e.target.value) }))
                      }
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                        <option key={day} value={day}>
                          {t('tx.search.cutDay', { day })}
                        </option>
                      ))}
                    </select>
                  ) : draftUnit === 'week' ? (
                    <div className="flex flex-wrap gap-2">
                      <Chip
                        label={t('tx.search.cutDefault')}
                        selected={draft.weekStartDay === null}
                        onClick={() => setDraft((prev) => ({ ...prev, weekStartDay: null }))}
                      />
                      {weekdayNames(0).map((name, weekday) => (
                        <Chip
                          key={name}
                          label={name}
                          selected={draft.weekStartDay === weekday}
                          onClick={() =>
                            setDraft((prev) => ({ ...prev, weekStartDay: weekday as WeekStart }))
                          }
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                        <Chip
                          key={month}
                          label={formatMonthShort(month)}
                          selected={draft.yearStartMonth === month}
                          onClick={() => setDraft((prev) => ({ ...prev, yearStartMonth: month }))}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex flex-1 flex-col gap-1 text-xs text-gray-500">
                    {t('tx.search.periodFrom')}
                    <input
                      type="date"
                      value={draft.startDate}
                      onChange={(e) => setDraft((prev) => ({ ...prev, startDate: e.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </label>
                  <label className="flex flex-1 flex-col gap-1 text-xs text-gray-500">
                    {t('tx.search.periodTo')}
                    <input
                      type="date"
                      value={draft.endDate}
                      onChange={(e) => setDraft((prev) => ({ ...prev, endDate: e.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </label>
                </div>
                {draft.startDate || draft.endDate ? (
                  <button
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, startDate: '', endDate: '' }))}
                    className="mt-2 text-xs font-medium text-blue-600 hover:underline"
                  >
                    {t('tx.search.periodClear')}
                  </button>
                ) : null}
                {/* 잘못 적었을 때만 한 줄 뜬다. */}
                {isRangeBroken ? (
                  <p className="mt-2 text-xs leading-5 text-red-600">
                    {t('tx.search.periodInvalid')}
                  </p>
                ) : (
                  // 정한 기간이 목록의 한 줄이 된다는 것을 알린다. 단위 쪽이 감춰진 까닭이다.
                  <p className="mt-2 text-xs leading-5 text-gray-500">{t('tx.search.cutIgnored')}</p>
                )}
              </>
            )}
          </div>
        </div>

        {categories.length === 0 &&
        accounts.length === 0 &&
        cards.length === 0 ? (
          <p className="text-sm text-gray-600">{t('tx.search.empty')}</p>
        ) : (
          <div className="space-y-5">
          {/*
            유형을 기간 다음에 둔다. 넷뿐이고, 이체나 카드정산만 보려는 사람에게는 이
            칸 하나로 끝난다. 분류가 수십 개라 아래에 두면 굴려서 찾아야 한다.
          */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
              {t('tx.search.kinds')}
            </p>
            <div className="flex flex-wrap gap-2">
              {SEARCHABLE_ENTRY_KINDS.map((kind) => (
                <Chip
                  key={kind}
                  label={t(ENTRY_KIND_LABEL[kind])}
                  selected={draft.kinds.includes(kind)}
                  onClick={() =>
                    setDraft((prev) => ({ ...prev, kinds: toggleId(prev.kinds, kind) }))
                  }
                />
              ))}
            </div>
          </div>

          {/*
            거래를 낸 사람. **화면 제목의 자산주인과 다른 것이다.**

            제목은 돈이 오간 계좌의 주인으로 거르고, 이 칸은 거래를 적을 때 고른
            사람으로 거른다. 남의 카드로 내 몫을 쓴 거래에서 둘이 갈린다.

            사람을 비운 거래(미지정)도 골라 볼 수 있어, 구성원이 하나뿐이어도 선다 (2026-10-10).
          */}
          {people.length > 0 ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
                {t('tx.search.people')}
              </p>
              <div className="flex flex-wrap gap-2">
                {people.map((person) => (
                  <Chip
                    key={person.id}
                    label={person.name}
                    selected={draft.entryPersonIds.includes(person.id)}
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        entryPersonIds: toggleId(prev.entryPersonIds, person.id),
                      }))
                    }
                  />
                ))}
                <Chip
                  label={t('tx.noPerson')}
                  selected={draft.entryPersonIds.includes(NO_PERSON)}
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      entryPersonIds: toggleId(prev.entryPersonIds, NO_PERSON),
                    }))
                  }
                />
              </div>
            </div>
          ) : null}

          {/*
            태그를 사용자 다음에 둔다. 개수가 적고, "이번 여행에 쓴 돈"처럼 태그 하나로
            끝나는 검색이 잦다. 분류 수십 개 아래에 두면 굴려서 찾아야 한다.
          */}
          {tags.length > 0 ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
                {t('tags.pick')}
              </p>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <Chip
                    key={tag.id}
                    label={tag.name}
                    color={tag.color}
                    selected={draft.tagIds.includes(tag.id)}
                    onClick={() =>
                      setDraft((prev) => ({ ...prev, tagIds: toggleId(prev.tagIds, tag.id) }))
                    }
                  />
                ))}
                {/*
                  태그를 하나도 붙이지 않은 거래. 태그 무리의 한 갈래라 고른 태그들과
                  OR 로 이어진다 -- "여행 또는 태그 없음"이 그대로 걸린다.
                */}
                <Chip
                  label={t('tx.search.noTag')}
                  selected={draft.tagIds.includes(NO_TAG)}
                  onClick={() =>
                    setDraft((prev) => ({ ...prev, tagIds: toggleId(prev.tagIds, NO_TAG) }))
                  }
                />
              </div>
            </div>
          ) : null}

          {categories.length > 0 ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
                {t('tx.search.categories')}
              </p>
              {/*
                다른 칸처럼 한 줄로 쭉 이어 붙인다. 상자를 두르지 않는다 -- 칸마다 모양이
                다르면 검색 창 안에서 리듬이 깨지고, 상자의 여백만큼 자리도 넓게 쓴다.

                묶음은 글자로 가른다. **대분류 뒤에는 `|`, 묶음 끝에는 `/`**. 사이에 놓인
                것이 그 대분류의 소분류다.

                **대분류를 고르면 그 소분류는 함께 걸린다** (서버 규칙). 그래서 대분류가
                켜지면 소분류도 켜진 것으로 보이고, 그 상태에서 소분류 하나를 끄면
                대분류가 내려가며 나머지 소분류가 켜진다. 거꾸로 소분류를 마지막 하나까지
                켜면 그 무리가 대분류 하나로 접힌다 (core 의 toggleCategory).
              */}
              <div className="space-y-2">
                {categorySections.map((section) => (
                  <div key={section.type}>
                    {/* 지출·수입을 갈라 적는다. 등록한 차례는 유형마다 따로 매겨져 있다. */}
                    <p className="mb-1.5 text-xs text-gray-500">
                      {t(section.type === 'expense' ? 'tx.kind.expense' : 'tx.kind.income')}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {section.groups.map((group, index) => {
                        const pick = (category: { id: string }) =>
                          setDraft((prev) => ({
                            ...prev,
                            categoryIds: toggleCategory(prev.categoryIds, category, group),
                          }));

                        return (
                          <Fragment key={group.parent?.id ?? 'orphans'}>
                            {group.parent ? (
                              <Chip
                                label={group.parent.name}
                                selected={
                                  categoryPickState(draft.categoryIds, group.parent, group) ===
                                  'on'
                                }
                                onClick={() => pick(group.parent!)}
                              />
                            ) : null}

                            {group.parent && group.children.length > 0 ? (
                              <Divider mark="›" />
                            ) : null}

                            {group.children.map((child) => {
                              const state = categoryPickState(draft.categoryIds, child, group);

                              return (
                                <Chip
                                  key={child.id}
                                  label={child.name}
                                  selected={state === 'on'}
                                  // 대분류를 켜서 함께 걸리는 자리. 켠 것과 다르게 그린다.
                                  covered={state === 'covered'}
                                  onClick={() => pick(child)}
                                  // 한 단 아래다. 옅게 그려 대분류가 먼저 읽히게 한다.
                                  subtle
                                />
                              );
                            })}

                            {/*
                              미분류. 소분류 없이 이 대분류에 바로 적은 거래다.

                              소분류들과 나란히 서는 한 칸이라 알약도 그 줄에 둔다.
                              소분류가 없는 대분류에는 두지 않는다 -- 그 대분류가 곧
                              미분류라 같은 것을 가리키는 알약이 둘이 된다.
                            */}
                            {group.parent && group.children.length > 0
                              ? (() => {
                                  const selfId = selfCategoryPick(group.parent.id);
                                  const state = categoryPickState(
                                    draft.categoryIds,
                                    { id: selfId },
                                    group,
                                  );

                                  return (
                                    <Chip
                                      label={t('category.uncategorized')}
                                      selected={state === 'on'}
                                      covered={state === 'covered'}
                                      onClick={() => pick({ id: selfId })}
                                      subtle
                                    />
                                  );
                                })()
                              : null}

                            {/* 묶음의 끝. 마지막 묶음 뒤에는 가를 것이 없다. */}
                            {index < section.groups.length - 1 ? <Divider mark="/" /> : null}
                          </Fragment>
                        );
                      })}
                    </div>
                  </div>
                ))}

              </div>
            </div>
          ) : null}

          {/*
            계좌 칸은 늘 선다. 통장이 없어도 "자산 미선택"은 고를 수 있다 -- 결제수단을
            비워 둔 지출·수입을 찾는 자리다. 고른 계좌·카드와 OR 로 이어진다.
          */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
              {t('tx.search.accounts')}
            </p>
            {/*
              주인별로 묶는다. "국민은행 통장"이 집에 셋 있으면 이름만으로는 어느
              것을 고르는지 알 수 없다. 주인이 하나뿐이면 묶지 않는다.
            */}
            {accounts.length > 0 ? (
              <OwnerGroups items={accounts}>
                {(account) => (
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
                )}
              </OwnerGroups>
            ) : null}
            <div className={`flex flex-wrap gap-2 ${accounts.length > 0 ? 'mt-3' : ''}`}>
              <Chip
                label={t('tx.search.noAccount')}
                selected={draft.paymentAccountIds.includes(NO_ACCOUNT)}
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    paymentAccountIds: toggleId(prev.paymentAccountIds, NO_ACCOUNT),
                  }))
                }
              />
            </div>
          </div>

          {cards.length > 0 ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
                {t('tx.search.cards')}
              </p>
              {/* 카드는 결제 통장의 주인을 따른다 (core 의 asset-owner). */}
              <OwnerGroups items={orderedCards}>
                {(card) => (
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
                )}
              </OwnerGroups>
            </div>
            ) : null}
          </div>
        )}

        {/*
          형태(분할·할부·차감). 맨 아래 가까이 둔다(2026-10-07 사용자 요청) -- 자주 거르는 것이
          아니다. 유형과 같은 층으로 읽히지만 **다른 무리다** -- 한 거래가 유형은 하나지만 형태는
          둘 다 가질 수 있다(할부로 낸 결제를 둘로 나눠 적은 것). 고를 분류·자산이 없어도 선다.
        */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
            {t('tx.search.features')}
          </p>
          <div className="flex flex-wrap gap-2">
            {ENTRY_FEATURES.map((feature) => (
              <Chip
                key={feature}
                label={t(ENTRY_FEATURE_LABEL[feature])}
                selected={draft.features.includes(feature)}
                onClick={() =>
                  setDraft((prev) => ({ ...prev, features: toggleId(prev.features, feature) }))
                }
              />
            ))}
          </div>
        </div>

        {/*
          세는 기준. 맨 아래, 형태 다음에 둔다(2026-10-07 사용자 요청) -- 거르는 조건이 아니라
          세는 규칙이라 고르는 조건들 뒤에 선다. 기본은 회차 기준이다 (`TransactionSearch.basis`).
          예전엔 더보기에 있었다.
        */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
            {t('tx.basis')}
          </p>
          <div className="flex flex-wrap gap-2">
            {BASES.map((basis) => (
              <Chip
                key={basis}
                label={t(basis === 'accrual' ? 'tx.basis.accrual' : 'tx.basis.installment')}
                selected={draft.basis === basis}
                onClick={() => setDraft((prev) => ({ ...prev, basis }))}
              />
            ))}
          </div>
          <p className="mt-2 text-xs leading-5 text-gray-500">{t('tx.basisHint')}</p>
        </div>
      </div>
    </Modal>
  );
}
