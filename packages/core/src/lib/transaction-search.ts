/**
 * 거래 검색의 모양과 그것을 다루는 순수한 규칙.
 *
 * 검색 창이 고르는 값(`TransactionSearch`), 목록 위에 늘어놓는 조건 알약, "언제" 칸의 두 갈래
 * (단위·기간), 고른 기간을 온전한 구간으로 바꾸는 일이 여기 있다. 거래 탭·분석 탭·자산·분류
 * 화면이 같은 모양을 쓴다. 바깥에서는 `hooks/useTransactions` 로 가져다 쓴다 (2026-10-26 에 그
 * 훅에서 떼어 냈다).
 */
import type { AccountDto, CardDto, CategoryDto, EntryKind, TagDto } from '@money/types';
import {
  NO_ACCOUNT,
  NO_PERSON,
  NO_TAG,
  parseCategoryPick,
  type EntryBasis,
  type EntryFeature,
  type EntryPeriodUnit,
  type WeekStart,
} from '@money/types';

import { assetOwnerNames, hasSeveralOwners } from './asset-owner';
import { formatMonthShort, isDateKey, weekdayNames } from './datetime';
import type { MessageKey } from './i18n';

/** 검색이 고른 것. 무리 안은 OR, 무리끼리는 AND (types 의 parseEntrySearch). */
export interface TransactionSearch {
  /**
   * 설명에서 찾을 글자. 빈 문자열은 "적지 않았다"이다.
   *
   * 다른 조건과 달리 고르는 것이 아니라 적는 것이라, 다른 무리와 AND 로만 이어진다 --
   * "이 글자가 든 것 중에서" 나머지 조건을 본다.
   */
  text: string;
  /**
   * 고른 분류. 고른 것끼리 OR 이고 다른 무리와는 AND 다.
   *
   * **"미분류"가 분류 id 자리에 함께 담긴다** (`selfCategoryPick`). 소분류 없이 대분류에
   * 바로 적은 거래를 가리키는 값이라, 소분류들과 나란히 고를 수 있다 -- "식비는 미분류만,
   * 교통은 전체"가 한 검색에 담기는 까닭이다.
   */
  categoryIds: string[];
  paymentAccountIds: string[];
  paymentCardIds: string[];
  /** 지출·수입·이체·카드정산. 고른 것끼리 OR 이고 다른 무리와는 AND 다. */
  kinds: EntryKind[];
  /**
   * 태그. 고른 것끼리 OR 이고 다른 무리와는 AND 다.
   *
   * `NO_TAG` 가 함께 담긴다. "태그 없음"도 이 무리의 한 갈래라 "여행 또는 태그 없음"이
   * 그대로 표현된다. 따로 두면 태그 무리와 AND 로 이어져 빈 조건이 된다.
   */
  tagIds: string[];
  /**
   * 거래를 낸 사람. 고른 것끼리 OR 이고 다른 무리와는 AND 다.
   *
   * **자산주인 필터와 다른 것이다.** 이쪽은 거래를 적을 때 고른 사람이고, 자산주인은
   * 돈이 오간 계좌의 주인이다(화면 제목이 그것을 고른다). 남의 카드로 내 몫을 쓴
   * 거래에서 둘이 갈린다.
   */
  entryPersonIds: string[];
  /**
   * 거래의 모양(분할·할부). 고른 것끼리 OR 이고 다른 무리와는 AND 다.
   *
   * **유형과 다른 무리다.** 유형은 한 거래가 하나만 갖는 갈래이고, 모양은 그 위에 겹쳐
   * 붙는 표시다 -- 할부로 낸 지출을 둘로 나눠 적으면 둘 다 붙는다.
   */
  features: EntryFeature[];
  /**
   * 기간. 프로젝트 타임존의 달력 날짜 'YYYY-MM-DD' 이고 양끝을 포함한다.
   *
   * 빈 문자열은 "정하지 않았다"이고, **한쪽만 적으면 그쪽만 걸린다**. 시작일만 적으면
   * 그날부터 끝까지, 종료일만 적으면 처음부터 그날까지다. "이 날 이후에 쓴 것"은
   * 적다 만 상태가 아니라 그 자체로 사용자가 묻는 것이다.
   */
  startDate: string;
  endDate: string;
  /**
   * 기간 줄을 어디서 끊을지. **거르는 조건이 아니라 묶는 규칙이다** -- 걸리는 거래는 그대로이고
   * 줄의 경계만 옮긴다. 지금 묶는 단위의 것 하나만 쓰인다.
   *
   *   monthStartDay   달로 묶을 때 그 달이 며칠에 시작하는가 (1~31, 1 이면 달력대로)
   *   weekStartDay    주로 묶을 때 시작 요일 (0=일 … 6=토, null 이면 설정의 요일)
   *   yearStartMonth  해로 묶을 때 시작 월 (1~12, 1 이면 달력대로)
   *
   * 기간(startDate·endDate)을 정하면 이 값들은 쓰이지 않는다. 그때 목록은 그 기간 한 줄이다.
   */
  monthStartDay: number;
  weekStartDay: WeekStart | null;
  yearStartMonth: number;
  /**
   * 무엇을 "그 기간에 쓴 돈"으로 셀지. **거르는 조건이 아니라 세는 규칙이다** -- 끊는 자리와
   * 같이 검색 창에서 고르고(2026-10-07 사용자 요청, 그 전엔 더보기), 조건과 함께 다닌다.
   *
   * 기본은 **회차 기준**이다. 할부는 회차가 서는 달마다 그 달 몫(원금 + 이자)으로 나뉘고,
   * 할부가 아닌 거래는 달라지는 것이 없다. 24개월치를 산 달 하나에 몰아 두면 그 달만 혼자
   * 튀고 나머지 스물세 달은 실제로 나가는 돈이 어디에도 보이지 않는다. 발생 기준(산 달에
   * 전액)은 언제 샀는지를 묻는 때 -- 이를테면 그 달의 카드값을 명세서와 대조할 때 -- 의 것이다.
   * 발생 기준일 때만 알약이 선다.
   */
  basis: EntryBasis;
}

/** 끊는 자리의 처음 값. 달력대로 끊는다. */
const DEFAULT_PERIOD_CUT = { monthStartDay: 1, weekStartDay: null, yearStartMonth: 1 } as const;

/**
 * 지금 단위에서 끊는 자리를 바꿔 두었는가. 알약과 조건 수가 이것을 본다.
 *
 * 다른 단위의 값은 세지 않는다 -- 달 시작일을 정해 두고 주로 묶어 보면 그 값은 아무 일도
 * 하지 않으므로, 걸린 조건으로 세면 알약이 거르지도 않는 것을 말한다.
 */
export function periodCutOf(
  search: TransactionSearch,
  unit: EntryPeriodUnit,
): { kind: 'month'; day: number } | { kind: 'week'; weekday: WeekStart } | { kind: 'year'; month: number } | null {
  if (unit === 'month' && search.monthStartDay > 1) return { kind: 'month', day: search.monthStartDay };
  if (unit === 'week' && search.weekStartDay !== null) return { kind: 'week', weekday: search.weekStartDay };
  if (unit === 'year' && search.yearStartMonth > 1) return { kind: 'year', month: search.yearStartMonth };
  return null;
}

export const EMPTY_SEARCH: TransactionSearch = {
  text: '',
  categoryIds: [],
  paymentAccountIds: [],
  paymentCardIds: [],
  kinds: [],
  tagIds: [],
  entryPersonIds: [],
  features: [],
  startDate: '',
  endDate: '',
  ...DEFAULT_PERIOD_CUT,
  basis: 'installment',
};

/** 유형의 이름. 열쇠를 이어 붙이지 않고 적어 두어 사전에서 찾을 수 있게 한다. */
export const ENTRY_KIND_LABEL: Record<EntryKind, MessageKey> = {
  expense: 'tx.kind.expense',
  income: 'tx.kind.income',
  payback: 'tx.kind.payback',
  transfer: 'tx.kind.transfer',
  card_payment: 'tx.kind.card_payment',
  adjustment: 'entry.adjustment',
};

/** 모양의 이름. 유형과 같은 방식으로 적어 두어 사전에서 찾을 수 있게 한다. */
export const ENTRY_FEATURE_LABEL: Record<EntryFeature, MessageKey> = {
  split: 'tx.search.feature.split',
  installment: 'tx.search.feature.installment',
  discount: 'tx.search.feature.discount',
};

/**
 * 고른 기간. 없는 쪽은 열려 있다 (시작일만 적으면 그날부터 끝까지).
 */
export interface SearchRange {
  startKey?: string;
  endKey?: string;
}

/**
 * 지금 걸려 있는 조건 하나. 화면이 알약으로 그리고, 누르면 그 조건만 빠진다.
 *
 * 검색 창을 열어야 무엇을 골랐는지 알 수 있으면, 결과가 비었을 때 이유를 찾기 위해
 * 창을 다시 열게 된다. 목록 위에 늘어놓으면 그 걸음이 사라진다.
 */
export interface SearchChip {
  /** 무엇을 뺄지 가리키는 값. 무리와 대상을 콜론으로 잇는다. */
  id: string;
  label: string;
}

/**
 * 걸려 있는 조건을 알약으로 펼친다.
 *
 * 이름은 검색 창이 고를 때 쓰던 목록에서 가져온다. 그 목록에 없는 id 는 무리 이름으로
 * 적는다 -- 프로젝트를 옮기면 지난 프로젝트의 분류 id 가 남아 있을 수 있는데, 이름을
 * 못 찾는다고 알약을 감추면 **거르고 있는데 보이지 않는** 조건이 된다.
 */
export function searchChipsOf(
  search: TransactionSearch,
  labels: {
    t: (key: MessageKey, values?: Record<string, string | number>) => string;
    categories: CategoryDto.Response[];
    accounts: AccountDto.Response[];
    cards: CardDto.Response[];
    tags: TagDto.Response[];
    /** 통장·카드의 주인을 적을 때 쓴다. 계좌에 주인이 실려 오지 않는 경우의 대비다. */
    people?: Array<{ id: string; name: string }>;
    /** 지금 묶는 단위. 끊는 자리의 알약이 이 단위의 것만 선다 (`periodCutOf`). */
    unit?: EntryPeriodUnit;
  },
): SearchChip[] {
  const { t, categories, accounts, cards, tags, people = [], unit = 'month' } = labels;
  const chips: SearchChip[] = [];

  const range = searchRange(search);
  if (range) {
    // 열린 쪽은 비워 둔다. "2026-03-01 ~" 하나로 "그날 이후"가 읽힌다.
    chips.push({ id: 'period', label: `${range.startKey ?? ''} ~ ${range.endKey ?? ''}`.trim() });
  }

  // 끊는 자리. 기간을 정했으면 쓰이지 않으므로 알약도 세우지 않는다.
  const cut = range ? null : periodCutOf(search, unit);
  if (cut) {
    chips.push({
      id: 'periodCut',
      label:
        cut.kind === 'month'
          ? t('tx.search.cutMonthChip', { day: cut.day })
          : cut.kind === 'week'
            ? t('tx.search.cutWeekChip', { weekday: weekdayNames(cut.weekday, 'long')[0] })
            : t('tx.search.cutYearChip', { month: formatMonthShort(cut.month) }),
    });
  }

  // 세는 기준. 기본(회차 기준)이 아닐 때만 -- 빼면 회차 기준으로 돌아간다.
  if (search.basis !== 'installment') {
    chips.push({ id: 'basis', label: t('tx.basis.accrual') });
  }

  // 적은 글자를 그대로 보여 준다. 무엇으로 좁혔는지는 그 글자가 곧 이름이다.
  if (search.text.trim()) {
    chips.push({ id: 'text', label: `"${search.text.trim()}"` });
  }

  for (const kind of search.kinds) {
    chips.push({ id: `kind:${kind}`, label: t(ENTRY_KIND_LABEL[kind]) });
  }

  const parentOf = new Map(categories.map((row) => [row.id, row.parentId]));
  const categoryName = new Map(categories.map((row) => [row.id, row.name]));
  for (const value of search.categoryIds) {
    const { id, self } = parseCategoryPick(value);
    const name = categoryName.get(id);
    const parentName = categoryName.get(parentOf.get(id) ?? '');
    // 같은 이름의 소분류가 여럿 있다. 검색 창과 같은 모양으로 적는다.
    const full = name ? (parentName ? `${parentName} > ${name}` : name) : t('tx.search.categories');

    chips.push({
      id: `category:${value}`,
      // 미분류는 무엇의 미분류인지 함께 적는다. "미분류" 하나로는 어느 대분류인지 모른다.
      label: self ? t('category.exact', { name: full }) : full,
    });
  }

  /*
   * 통장·카드는 주인을 함께 적는다. 같은 이름의 통장이 집집마다 있어 이름만으로는
   * 어느 것을 거르고 있는지 알 수 없다. 주인이 하나뿐인 가계부에서는 적지 않는다.
   */
  const owners = assetOwnerNames(accounts, cards, people);
  const withOwner = (id: string, name: string) => {
    const owner = hasSeveralOwners(owners) ? owners.get(id) : undefined;
    return owner ? t('tx.search.assetOwner', { name, owner }) : name;
  };

  const accountName = new Map(accounts.map((row) => [row.id, row.name]));
  for (const id of search.paymentAccountIds) {
    // "자산 미선택"은 계좌 무리의 한 갈래다. 이름은 사전에서 온다.
    if (id === NO_ACCOUNT) {
      chips.push({ id: `account:${NO_ACCOUNT}`, label: t('tx.search.noAccount') });
      continue;
    }
    const name = accountName.get(id);
    chips.push({
      id: `account:${id}`,
      label: name ? withOwner(id, name) : t('tx.search.accounts'),
    });
  }

  const cardName = new Map(cards.map((row) => [row.id, row.name]));
  for (const id of search.paymentCardIds) {
    const name = cardName.get(id);
    chips.push({ id: `card:${id}`, label: name ? withOwner(id, name) : t('tx.search.cards') });
  }

  const tagName = new Map(tags.map((row) => [row.id, row.name]));
  for (const id of search.tagIds) {
    // "태그 없음"은 태그 무리의 한 갈래다. 이름은 사전에서 온다.
    if (id === NO_TAG) {
      chips.push({ id: `tag:${NO_TAG}`, label: t('tx.search.noTag') });
      continue;
    }
    chips.push({ id: `tag:${id}`, label: tagName.get(id) ?? t('tags.pick') });
  }

  const personName = new Map(people.map((row) => [row.id, row.name]));
  for (const id of search.entryPersonIds) {
    if (id === NO_PERSON) {
      chips.push({ id: `person:${NO_PERSON}`, label: t('tx.noPerson') });
      continue;
    }
    chips.push({ id: `person:${id}`, label: personName.get(id) ?? t('tx.search.people') });
  }

  for (const feature of search.features) {
    chips.push({ id: `feature:${feature}`, label: t(ENTRY_FEATURE_LABEL[feature]) });
  }

  return chips;
}

/** 알약 하나가 가리키는 조건을 뺀다. 모르는 열쇠면 그대로 둔다. */
export function withoutChip(search: TransactionSearch, chipId: string): TransactionSearch {
  if (chipId === 'period') return { ...search, startDate: '', endDate: '' };
  if (chipId === 'text') return { ...search, text: '' };
  if (chipId === 'periodCut') return { ...search, ...DEFAULT_PERIOD_CUT };
  if (chipId === 'basis') return { ...search, basis: 'installment' };

  const divider = chipId.indexOf(':');
  if (divider < 0) return search;

  const group = chipId.slice(0, divider);
  const id = chipId.slice(divider + 1);
  const drop = <T extends string>(ids: T[]) => ids.filter((value) => value !== id);

  switch (group) {
    case 'kind':
      return { ...search, kinds: drop(search.kinds) };
    case 'category':
      return { ...search, categoryIds: drop(search.categoryIds) };
    case 'account':
      return { ...search, paymentAccountIds: drop(search.paymentAccountIds) };
    case 'card':
      return { ...search, paymentCardIds: drop(search.paymentCardIds) };
    case 'tag':
      return { ...search, tagIds: drop(search.tagIds) };
    case 'person':
      return { ...search, entryPersonIds: drop(search.entryPersonIds) };
    case 'feature':
      return { ...search, features: drop(search.features) };
    default:
      return search;
  }
}

/**
 * 검색 창의 "언제" 칸이 무엇으로 정하는가. 둘 중 하나다 (2026-10-08 사용자 요청).
 *
 *   unit   묶는 단위와 끊는 자리(시작 요일·시작일·시작 월). 목록이 그 기간들로 나뉜다.
 *   range  직접 정한 기간(startDate·endDate). 목록이 그 기간 한 줄이다.
 *
 * 기간을 정하면 끊는 자리는 원래 쓰이지 않았다(`searchChipsOf`·`searchCount` 가 세지 않는다).
 * 그래서 둘 다 적힌 검색(예전에 저장한 것, 템플릿)이 들어오면 **기간 쪽**으로 연다 -- 그 검색이
 * 실제로 걸던 것이 기간이다.
 */
export type SearchPeriodMode = 'unit' | 'range';

export function searchPeriodModeOf(search: TransactionSearch): SearchPeriodMode {
  return search.startDate || search.endDate ? 'range' : 'unit';
}

/**
 * 고른 쪽만 남기고 다른 쪽 값을 비운다. 검색 창이 적용할 때 부른다 -- 감춘 칸에 남은 값이
 * 조용히 걸려 있으면 알약도 칸도 없이 목록이 달라진다.
 */
export function withSearchPeriodMode(
  search: TransactionSearch,
  mode: SearchPeriodMode,
): TransactionSearch {
  return mode === 'range'
    ? { ...search, ...DEFAULT_PERIOD_CUT }
    : { ...search, startDate: '', endDate: '' };
}

/**
 * 검색이 고른 기간. 한쪽이 비어 있으면 그쪽이 열린 구간이다.
 *
 * 적은 칸이 실재하지 않는 날짜이거나(2월 31일) 두 칸이 뒤집혀 있으면 null 이다. 아무
 * 칸도 적지 않은 것도 null 이다 -- 조건이 없는 것과 잘못 적은 것을 부르는 쪽이
 * `startDate || endDate` 로 가른다.
 *
 * 화면도 같은 것을 보고 막지만, 그 검사를 지나온 값만 조회에 실리게 하는 자리가 하나 있어야
 * 한다 -- `new Date('2026-02-31')` 은 오류가 아니라 3월 3일이라, 걸러 내지 않으면 오류 없이
 * 결과만 조용히 어긋난다.
 */
export function searchRange(search: TransactionSearch): SearchRange | null {
  const { startDate, endDate } = search;
  if (!startDate && !endDate) return null;
  if (startDate && !isDateKey(startDate)) return null;
  if (endDate && !isDateKey(endDate)) return null;
  if (startDate && endDate && startDate > endDate) return null;

  return {
    ...(startDate ? { startKey: startDate } : {}),
    ...(endDate ? { endKey: endDate } : {}),
  };
}
