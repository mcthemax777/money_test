/**
 * 거래 화면의 값과 상태.
 *
 * 화면은 세 겹으로 파고든다. **년월 -> (날짜·분류·수단) -> 거래**. 겹마다 무엇을
 * 보여 줄지는 여기서 정하고, 어떻게 그릴지는 화면이 정한다. 웹과 앱이 같은 훅을 쓴다.
 *
 * 읽기는 전부 `homeDataPort()` 를 거친다. 그래서 이 화면은 서버에서 온 값인지 기기
 * 사본에서 온 값인지 모른 채로 돌고, 오프라인에서도 같은 코드가 그대로 쓰인다.
 *
 * 한 겹씩 받는 것이 요점이다. 전체 기간의 거래를 한 번에 받으면 해가 갈수록 첫 화면이
 * 느려진다. 첫 요청은 "거래가 있는 달" 목록 하나뿐이고, 나머지는 사용자가 편 자리만
 * 받는다. 받아 둔 것은 접었다 펴도 다시 받지 않는다.
 *
 * **여러 달을 함께 펼 수 있다.** 달마다 펼침 정도를 따로 들고 있어서, 8월을 보다가
 * 7월을 열어도 8월이 닫히지 않는다.
 *
 * 순수한 규칙은 lib 로 나눠 두었다 (2026-10-26). 검색의 모양과 알약은 `lib/transaction-search`, 기간
 * 줄이 싣는 구간은 `lib/transaction-periods`, 안쪽 줄의 모양은 `lib/transaction-rows` 에 있고, 기준
 * 목록과 여러 건 고르기는 `useTransactionReference`·`useTransactionSelection` 이 맡는다. 바깥에서는
 * 지금처럼 이 파일에서 가져다 쓴다.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from 'react';
import type { EntryListItem, EntryScopeQuery, ReportDto } from '@money/types';
import {
  DEFAULT_ENTRY_PERIOD,
  entryRows,
  installmentEntryViews,
  toEntrySearchQuery,
  type EntryPeriodUnit,
  type EntryRow,
  type PeriodAnchor,
} from '@money/types';

import { readScreenCache, writeScreenCache } from '../lib/screen-cache';
import { useTranslation } from '../lib/i18n';
import { homeDataPort } from '../data/home-port';
import { useMirrorVersion } from './useMirrorVersion';
import { groupEntriesByBucket } from '../lib/entries';
import { isOfflineError } from '../lib/offline-error';
import { useProject, useProjectTimeZone } from '../store/project';
import { useWeekStart } from '../store/week-start';
import { useUserFilter } from '../store/user-filter';
import { useEntryConditions } from '../store/entry-conditions';
import {
  EMPTY_SEARCH,
  periodCutOf,
  searchChipsOf,
  searchRange,
  withoutChip,
  type TransactionSearch,
} from '../lib/transaction-search';
import {
  collapseToRange,
  entryWindowOf,
  listRangeOf as listRangeQueryOf,
  reportPeriodOf,
  type PeriodGrouping,
} from '../lib/transaction-periods';
import {
  ROW_BATCH,
  buildMonthRows,
  categoryRowsToKeep,
  fetchEntriesWithInstallments,
  monthFieldOf,
  narrowQueryOf,
  type MonthData,
  type MonthLevel,
  type TransactionCategory,
  type TransactionRow,
  type TransactionTab,
} from '../lib/transaction-rows';
import { useTransactionReference } from './useTransactionReference';
import { useTransactionSelection } from './useTransactionSelection';

/*
 * 이 훅에서 떼어 낸 모양과 규칙. 화면과 다른 훅이 지금처럼 `hooks/useTransactions` 로 가져다 쓴다.
 */
export {
  EMPTY_SEARCH,
  ENTRY_FEATURE_LABEL,
  ENTRY_KIND_LABEL,
  periodCutOf,
  searchChipsOf,
  searchPeriodModeOf,
  searchRange,
  withSearchPeriodMode,
  withoutChip,
  type SearchChip,
  type SearchPeriodMode,
  type SearchRange,
  type TransactionSearch,
} from '../lib/transaction-search';
export type { PeriodGrouping } from '../lib/transaction-periods';
export type {
  MonthLevel,
  SelectPurpose,
  TransactionCategory,
  TransactionRow,
  TransactionTab,
} from '../lib/transaction-rows';

/**
 * 펼친 모양의 기간 줄 가운데 한 번에 받아 오는 수.
 *
 * 검색을 켜거나 탭을 다시 눌러 모든 기간이 펼쳐진 모양이 되어도, 그 안을 한꺼번에 받지
 * 않는다. 분류별·수단별은 펼친 기간의 줄마다 조회가 둘씩 나가서, 주로 묶은 몇 년 치를
 * 통째로 받으면 수천 건이 된다. 위에서부터 이만큼 받고, 화면이 받은 곳의 바닥에 가까워질
 * 때마다(`revealMore`) 이만큼 더 받는다. 손으로 편 기간 줄은 이 수와 무관하게 곧바로 받는다.
 */
const REVEAL_STEP = 3;

/*
 * 빈 값은 하나를 나눠 쓴다.
 *
 * `?? []` 로 두면 부를 때마다 새 배열이라, 그것을 받은 화면은 값이 바뀐 줄 알고 다시
 * 그린다. 아무것도 없는 자리가 화면을 흔들면 안 된다.
 */
const EMPTY_ENTRIES: EntryListItem[] = [];
const EMPTY_ROWS: TransactionRow[] = [];
const EMPTY_MONTHS: ReportDto.EntryMonth[] = [];
const EMPTY_GROUP = new Map<string, EntryListItem[]>();

const MONTHS_SLOT = 'transactions.months';

export function useTransactions(
  projectId: string | null,
  {
    periodsOnly = false,
    initial,
    shared = false,
  }: {
    /**
     * 기간 줄(과 그 수입·지출)만 쓴다. 분석 화면이 켠다 -- 검색·단위·세는 방식은 거래
     * 화면과 같은 것을 쓰지만, 기간 줄을 펴서 안을 받을 일은 없다. 켜면 어느 줄도 펴지지
     * 않아(`levelOf` 가 늘 0) 안쪽 조회가 한 건도 나가지 않는다.
     */
    periodsOnly?: boolean;
    /**
     * 처음 걸어 둘 검색(세는 기준 포함)과 묶는 단위. 거래 탭의 분석 아이콘이 연 분석 보기와
     * 분석 탭의 거래내역 단추가 연 거래 화면이 건너온 탭의 것으로 연다. 첫 그림부터 이
     * 값이라 빈 검색으로 한 번 받았다가 다시 받지 않는다.
     */
    initial?: { search: TransactionSearch; unit: EntryPeriodUnit };
    /**
     * 검색·묶는 단위·세는 방식을 거래 탭과 분석 탭이 함께 쓰는 자리(`useEntryConditions`)에서
     * 읽고 쓴다. 두 탭 화면만 켠다 -- 상세에서 건너온 거래 화면이나 거래 탭 안의 분석은 제
     * 조건을 따로 든다. 부르는 동안 바꾸지 않는다 (아래 상태를 고르는 갈래가 바뀐다).
     */
    shared?: boolean;
  } = {},
) {
  const { t } = useTranslation();
  const timeZone = useProjectTimeZone();
  /** 주로 묶을 때 한 주를 어디서 끊을지. 설정에서 고른 값이다. */
  const weekStart = useWeekStart();
  const projects = useProject((state) => state.projects);
  const selectedPersonIds = useUserFilter((state) => state.selectedPersonIds);
  /** 동기화가 사본을 채우면 올라간다. 이 값이 바뀌면 화면이 다시 읽는다. */
  const mirrorVersion = useMirrorVersion();

  /*
   * 검색·묶는 단위·세는 방식. shared 면 탭끼리 함께 쓰는 자리의 것이고, 아니면 이 훅의 것이다.
   * 두 갈래 다 늘 불러 두고 고르기만 한다 -- 훅을 부르는 차례가 그림마다 같아야 한다.
   * 함께 쓰는 검색은 그 가계부의 것일 때만 쓴다. 다른 가계부의 분류·자산 id 로 거르면 빈 목록이다.
   */
  const sharedConditions = useEntryConditions();
  const [localSearch, setLocalSearch] = useState<TransactionSearch>(
    initial?.search ?? EMPTY_SEARCH,
  );
  const search = shared
    ? sharedConditions.projectId === projectId && sharedConditions.search
      ? sharedConditions.search
      : EMPTY_SEARCH
    : localSearch;
  const setSharedSearch = sharedConditions.setSearch;
  const setSearch = useCallback(
    (update: SetStateAction<TransactionSearch>) => {
      if (shared) setSharedSearch(projectId, update, EMPTY_SEARCH);
      else setLocalSearch(update);
    },
    [shared, projectId, setSharedSearch],
  );
  /** 무엇을 "그 달에 쓴 돈"으로 셀지. 검색 창에서 고른다 (`TransactionSearch.basis`). */
  const basis = search.basis;
  const [tab, setTab] = useState<TransactionTab>('date');
  /**
   * 바깥 묶음 -- 해·달·주. 안쪽 탭(날짜별·분류별·수단별)과는 다른 축이다.
   *
   * 오래 쓴 가계부에서는 달이 예순 줄이 되어 한 해를 한눈에 볼 수 없고, 반대로 이번
   * 달만 촘촘히 보려는 사람에게는 달이 너무 성기다. 기본은 지금까지의 달이다.
   */
  const [localUnit, setLocalUnit] = useState<EntryPeriodUnit>(
    initial?.unit ?? DEFAULT_ENTRY_PERIOD,
  );
  const unit = shared ? sharedConditions.unit : localUnit;
  const setUnit = shared ? sharedConditions.setUnit : setLocalUnit;
  /**
   * 사용자가 직접 정한 펼침 정도. 손대지 않은 달은 아래 기본값을 따른다.
   *
   * 열쇠가 `탭|달` 이다. **탭마다 따로 접고 펴야 한다** -- 날짜별에서 8월을 펼쳐 둔
   * 것과 분류별에서 8월을 펼쳐 둔 것은 다른 이야기이고, 한 벌로 두면 탭을 옮길 때마다
   * 보려던 것이 아닌 자리가 펼쳐져 있다.
   */
  const [levels, setLevels] = useState<Record<string, MonthLevel>>({});
  /**
   * 탭마다의 **바닥 펼침**. 손대지 않은 기간 줄이 이 단계로 선다.
   *
   * 고른 탭을 한 번 더 누르면 여기가 한 단 오른다 -- 기간 줄 하나를 누르는 것이 그
   * 줄만 펴는 일이라면, 탭을 누르는 것은 그 탭을 통째로 펴는 일이다. 목록이 예순 줄일
   * 때 한 줄씩 눌러 펴는 것 말고는 길이 없던 자리다.
   */
  const [tabLevels, setTabLevels] = useState<Partial<Record<TransactionTab, MonthLevel>>>({});
  /** 펼친 모양의 기간 줄 가운데 위에서부터 받아 온 수 (`REVEAL_STEP`). */
  const [reveal, setReveal] = useState(REVEAL_STEP);
  /** 1단에서 손으로 편 줄. 2단에서는 이것과 무관하게 전부 펼친다. */
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});

  const [hasError, setHasError] = useState(false);
  const fail = useCallback((error: unknown) => {
    // 오프라인은 오류가 아니다. 사본이 답할 수 없을 때만 화면에 알린다.
    if (!isOfflineError(error)) setHasError(true);
  }, []);

  // 기준 목록 (검색이 고를 것과 제목의 이름). 가계부마다 한 번 받는다.
  const { people, pickerCategories, pickerAccounts, pickerCards, pickerTags } =
    useTransactionReference(projectId, mirrorVersion, fail);

  /**
   * 거래가 있는 달과, 그 목록을 받은 조건(`scopeKey`).
   *
   * 조건을 함께 적어 두는 이유는 아래 `months` 에 있다.
   */
  const [monthsState, setMonthsState] = useState<{
    scopeKey: string;
    rows: ReportDto.EntryMonth[];
  }>({ scopeKey: '', rows: EMPTY_MONTHS });
  const [monthData, setMonthData] = useState<Record<string, MonthData>>({});
  /** 줄 하나의 거래. 열쇠는 `달|탭|줄`. 접었다 펴도 다시 받지 않는다. */
  const [rowEntries, setRowEntries] = useState<Record<string, EntryListItem[]>>({});

  /**
   * 지금 나가 있는 조회.
   *
   * **결과를 버리지 않기 위한 장치다.** 줄 하나가 도착하면 `rowEntries` 가 바뀌어 효과가
   * 다시 도는데, 예전에는 그때 정리 함수가 `alive = false` 를 세워 **아직 나가 있던 형제
   * 줄들의 결과를 버렸다.** 그러면 그 줄들은 거래를 받지 못한 채 로딩 표시도 꺼지지
   * 않아 "로딩 중"에서 멈춘다 (수단별·분류별에서 실제로 그랬다).
   *
   * 나가 있는 것을 여기 적어 두면 같은 줄을 두 번 부르지 않으므로 정리 함수가 필요
   * 없고, 도착한 값은 조건이 그대로인지만 보고 그대로 쓴다.
   */
  const inFlightRef = useRef<Set<string>>(new Set());

  /**
   * 2단 효과가 "이미 받아 뒀는가"를 볼 때 쓰는 사본.
   *
   * 상태로 보면 그 효과가 monthData 에 의존해야 하고, 그러면 채울 때마다 다시 돌아
   * 그치지 않는다. 조건이 바뀔 때 이 사본을 비우는 자리는 아래 초기화 효과다.
   */
  const monthDataRef = useRef<Record<string, MonthData>>({});

  const [isLoadingMonths, setIsLoadingMonths] = useState(false);
  const [loadingMonths, setLoadingMonths] = useState<Record<string, boolean>>({});
  const [loadingRows, setLoadingRows] = useState<Record<string, boolean>>({});
  /** 거래를 고치고 나면 올린다. 받아 둔 것을 전부 버리는 신호다. */
  const [reloadToken, setReloadToken] = useState(0);

  /**
   * 조회에 함께 실어 보내는 조건.
   *
   * 사람 필터에 검색이 얹힌 한 덩이다. 세 겹 모두 이것을 그대로 받아야 년월 줄에 적힌
   * 금액과 그 안을 펴서 나온 거래의 합이 어긋나지 않는다.
   */
  const scope: EntryScopeQuery = useMemo(
    () => ({
      personIds: selectedPersonIds.join(','),
      ...toEntrySearchQuery(search),
      // 세는 방식. 발생 기준이면 싣지 않는다 -- 옛 서버와 사본이 그 칸을 모른다.
      ...(basis === 'installment' ? { basis } : {}),
    }),
    [selectedPersonIds, search, basis],
  );

  /**
   * 고른 기간. 온전할 때만 선다.
   *
   * **scope 에 섞지 않는다.** 구간 조회(분류별·수단별)는 조회 대상 기간을 따로 받는데,
   * apiClient 가 필터를 그 뒤에 펼쳐 넣는다. 여기서 섞으면 필터의 날짜가 그 달을 덮어써
   * 어느 달을 펴도 같은 목록이 나온다.
   */
  const range = useMemo(() => searchRange(search), [search]);
  /*
   * 기간 줄을 끊는 규칙. 검색이 고른 시작 요일이 설정의 요일보다 앞선다. 달·해의 시작은
   * 1 이 아닐 때만 싣는다 -- 늘 실으면 그 칸을 모르는 옛 서버에까지 뜻 없는 조건이 붙는다.
   */
  const groupWeekStart = search.weekStartDay ?? weekStart;
  const anchor = useMemo<PeriodAnchor>(
    () => ({
      ...(unit === 'month' && search.monthStartDay > 1 ? { monthStartDay: search.monthStartDay } : {}),
      ...(unit === 'year' && search.yearStartMonth > 1 ? { yearStartMonth: search.yearStartMonth } : {}),
    }),
    [unit, search.monthStartDay, search.yearStartMonth],
  );
  /** 년월 목록에 실어 보내는 기간. 그 구간에 걸친 달만, 걸친 만큼만 세어 온다. */
  const monthsQuery = useMemo(
    () => ({
      unit,
      /*
       * 시작 요일은 주로 묶을 때만 싣는다. 달·해의 경계는 이 값과 무관하고, 늘 실으면
       * 그 칸을 모르는 옛 서버에까지 뜻 없는 조건이 하나 붙는다.
       */
      ...(unit === 'week' ? { weekStart: groupWeekStart } : {}),
      ...anchor,
      ...(range
        ? {
            ...(range.startKey ? { startDate: range.startKey } : {}),
            ...(range.endKey ? { endDate: range.endKey } : {}),
          }
        : {}),
    }),
    [range, unit, groupWeekStart, anchor],
  );

  /*
   * 타임존도 열쇠에 넣는다. 기간을 인스턴트로 바꾸는 일이 그 값에 매여 있어서,
   * 프로젝트 타임존을 바꾸면 받아 둔 목록이 옛 경계의 것이 된다. 시작 요일도 같다 --
   * 설정에서 요일을 바꾸면 받아 둔 주 줄은 옛 요일에서 끊은 것이라 통째로 버려야 한다.
   */
  /*
   * 가계부도 넣는다 (2026-10-16). 가계부를 바꾼 직후 사람 선택이 아직 앞 가계부의 것이면 조건이
   * 같아 보여, 앞 가계부의 달 목록이 그대로 서거나 저장소(screen-cache)에서 꺼내졌다.
   */
  const scopeKey = JSON.stringify([projectId, scope, range, timeZone, monthsQuery]);
  /*
   * 지금 조건. 도착한 값이 아직 쓸 것인지 판단한다.
   *
   * 조회를 보낼 때의 조건과 다르면 그 값은 옛 조건의 것이라 버려야 한다. 이것만 보면
   * 되므로 효과가 다시 도는 것과 결과를 쓰는 것을 갈라 둘 수 있다.
   */
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey;

  /*
   * 지금 조건으로 받은 달 목록. 옛 조건의 것은 없는 것으로 본다.
   *
   * 새 목록이 도착하기 전까지 옛 목록을 세워 두면, 그 줄들이 펼쳐진 채로 새 조건의
   * 2단·3단 조회를 부른다. 묶는 단위를 바꾸면 옛 열쇠("2026-W38")로 해 단위 조건의
   * 조회가 나가고, 검색이 걸려 있으면(전부 펼침) 그것이 줄마다 나간다. 주·월·년을 몇 번
   * 번갈아 누르면 그 조회가 수천 건 쌓여 JS 가 몇 분씩 멈췄다.
   *
   * 같은 조건으로 다시 받는 것(거래를 고친 뒤)은 열쇠가 같아 그대로 서 있다 -- 그때
   * 목록이 사라지면 스크롤이 맨 위로 튄다(아래 1단의 "로딩 중" 설명).
   */
  const isMonthsStale = monthsState.scopeKey !== scopeKey;
  /*
   * 옛 조건의 목록 대신, 이 조건으로 전에 받아 둔 목록이 있으면 그것을 곧바로 세운다
   * (lib/screen-cache, 2026-10-15 사용자 요청 -- 탭을 옮겨 화면이 새로 서도 "로딩 중" 없이).
   * 새 목록은 뒤에서 받아 그 자리에서 바뀐다.
   */
  const cachedMonths = isMonthsStale
    ? readScreenCache<ReportDto.EntryMonth[]>(MONTHS_SLOT, scopeKey)
    : undefined;
  const months = isMonthsStale ? (cachedMonths ?? EMPTY_MONTHS) : monthsState.rows;

  /**
   * 걸려 있는 조건 알약. 목록 위에 늘어놓고, 하나를 누르면 그 조건만 빠진다.
   *
   * 이름을 검색 창이 쓰던 목록에서 가져오므로 그 목록이 도착하기 전에는 무리 이름으로
   * 적힌다. 알약을 감추지 않는 것이 요점이다 -- 거르고 있는데 보이지 않으면 사용자는
   * 결과가 왜 비었는지 알 수 없다.
   */
  const searchChips = useMemo(
    () =>
      searchChipsOf(search, {
        t,
        categories: pickerCategories,
        accounts: pickerAccounts,
        cards: pickerCards,
        tags: pickerTags,
        people,
        unit,
      }),
    [search, t, pickerCategories, pickerAccounts, pickerCards, pickerTags, people, unit],
  );

  /** 알약 하나를 뺀다. 나머지 조건은 그대로 둔다. */
  // setSearch 를 의존성에 둔다. 비워 두면 처음 그린 때의 것(그때의 가계부)이 남아, 가계부를 바꾼 뒤 알약을
  // 빼면 함께 쓰는 검색이 다른 가계부 이름으로 적혀 조건이 통째로 사라졌다 (2026-10-16).
  const removeSearchChip = useCallback(
    (chipId: string) => {
      setSearch((prev) => withoutChip(prev, chipId));
    },
    [setSearch],
  );

  /*
   * 거르는 조건의 수. 세는 기준은 넣지 않는다 -- 거래를 거르지 않으므로, 이것으로 정하는 일
   * (검색 중이면 줄을 다 펴기, 기간 줄의 순수입 감추기)에 끼면 안 된다.
   */
  const filterCount =
    (search.text.trim() ? 1 : 0) +
    search.categoryIds.length +
    search.paymentAccountIds.length +
    search.paymentCardIds.length +
    search.kinds.length +
    search.tagIds.length +
    search.entryPersonIds.length +
    search.features.length +
    // 기간은 두 칸이지만 조건 하나다. 사용자가 고른 것은 구간 하나다.
    (range ? 1 : 0) +
    // 끊는 자리. 기간을 정했으면 쓰이지 않아 세지 않는다 (알약과 같다).
    (!range && periodCutOf(search, unit) ? 1 : 0);
  /** 걸린 조건의 수. 알약 수와 같다 -- 검색 단추 옆 숫자다. */
  const searchCount = filterCount + (search.basis !== 'installment' ? 1 : 0);

  const isSearching = filterCount > 0;
  /** 기간 줄이 목록의 몇 번째인가. 검색 중에 어디까지 폈는지 이것으로 가른다. */
  const monthOrder = useMemo(
    () => new Map(months.map((month, index) => [month.yearMonth, index])),
    [months],
  );
  /** 펼침을 적어 두는 열쇠. 탭이 다르면 다른 자리다. */
  const levelKey = useCallback((yearMonth: string) => `${tab}|${yearMonth}`, [tab]);
  /*
   * 기간 줄의 단계. 손으로 정한 것, 탭의 바닥, 검색의 기본값 차례다.
   *
   * 검색을 켜도 손대지 않은 줄은 **접힌 채로** 선다(2026-10-07 사용자 요청). 예전엔 걸러 낸 것을
   * 보러 왔으니 거래까지 다 펴 두었는데, 조건 하나에 수백 건이 한꺼번에 펼쳐져 기간 줄을
   * 훑어볼 수 없었다. 펴는 것은 줄이나 탭을 눌러서다. 탭의 바닥은 검색을 바꾸면 지워진다
   * (아래 조건 효과).
   */
  const levelOf = useCallback(
    (yearMonth: string): MonthLevel => {
      if (periodsOnly) return 0;
      const chosen = levels[levelKey(yearMonth)];
      if (chosen !== undefined) return chosen;
      return tabLevels[tab] ?? 0;
    },
    [periodsOnly, levels, levelKey, tabLevels, tab],
  );

  /**
   * 펼친 모양으로만 선 다음 기간 줄들의 안을 받는다. 화면이 받은 곳의 바닥에 가까워질 때 부른다.
   *
   * 이미 다 받았으면 아무 일도 없다 -- 바닥 감지는 내용이 짧으면 길이가 바뀔 때마다
   * 부르므로, 그때 값을 올리면 뜻 없이 다시 그린다.
   */
  const revealMore = useCallback(() => {
    setReveal((count) => (count < months.length ? count + REVEAL_STEP : count));
  }, [months.length]);

  /** 구간 조회가 볼 기간 (`reportPeriodOf`). */
  const periodOf = useCallback(
    (yearMonth: string) => reportPeriodOf(yearMonth, range),
    [range],
  );

  /** 목록 조회가 볼 기간. 인스턴트다 (`listRangeOf`). */
  const listRangeOf = useCallback(
    (yearMonth: string) => listRangeQueryOf(yearMonth, range, timeZone),
    [range, timeZone],
  );

  /** 그 기간 줄이 보는 구간. 인스턴트 두 개다 (`entryWindowOf`). */
  const windowOf = useCallback(
    (yearMonth: string): { start: Date; end: Date } => entryWindowOf(yearMonth, range, timeZone),
    [range, timeZone],
  );

  monthDataRef.current = monthData;

  /**
   * 값이 바뀌어 다시 받아야 하는 회차의 표.
   *
   * **조건이 바뀐 것과 다르다.** 검색이나 프로젝트가 바뀌면 받아 둔 것이 남의 값이
   * 되므로 비우고 처음부터 받는다. 반대로 거래 하나를 고쳐서 다시 받는 것은 같은
   * 조건의 같은 화면이다 -- 그때 비우면 목록이 사라졌다가 돌아오고, 그 사이에 화면이
   * 짧아져 **스크롤이 맨 위로 튄다.**
   *
   * 그래서 값이 바뀔 때는 비우지 않고 **덮어쓴다.** 받아 둔 것은 새 값이 도착할 때까지
   * 그대로 서 있고, 도착하면 그 자리에서 바뀐다. 앱에서 한 번 고칠 때 사본 커밋과
   * 서버 응답으로 번호가 두 번 오르는데, 그 두 번이 모두 보이지 않게 지나간다.
   */
  const refreshToken = `${mirrorVersion}|${reloadToken}`;
  const monthRefreshRef = useRef(refreshToken);
  /** 나가 있는 동안 값이 바뀌어, 끝나면 한 번 더 받을 달 (`month|탭|달`). */
  const monthRefetchRef = useRef<Set<string>>(new Set());
  const rowRefreshRef = useRef(refreshToken);
  /** 이 조건으로 달 목록을 한 번이라도 받았는가. 처음 받을 때만 "로딩 중"을 띄운다. */
  const monthsLoadedRef = useRef(false);

  /** 조건이 바뀌면 받아 둔 것을 버린다. 남겨 두면 옛 조건의 값이 화면에 남는다. */
  useEffect(() => {
    /*
     * 2단이 보는 사본도 **여기서** 비운다.
     *
     * 아래 setMonthData 는 다음 그림에서야 반영되는데, 2단 효과는 이 효과 바로 뒤
     * 같은 그림에서 돈다. 그때 이 ref 에 옛 조건의 값이 남아 있으면 "이미 받아 뒀다"로
     * 읽고 조회를 건너뛴다. 그 뒤에는 달 목록이 그대로여서(openMonthsKey) 효과가 다시
     * 돌지도 않아, 달을 펴도 "이 달에 거래가 없습니다"가 남는다 -- 검색에서 알약 하나를
     * 뺐을 때 실제로 그랬다.
     */
    monthDataRef.current = {};
    setMonthData({});
    setRowEntries({});
    monthsLoadedRef.current = false;
    /*
     * 나가 있던 것도 잊는다.
     *
     * 그 조회들은 옛 조건의 것이라 도착해도 버려진다(위 scopeKeyRef). 여기서 지워
     * 두지 않으면 새 조건으로 같은 줄을 다시 부를 때 "이미 나가 있다"로 막혀, 그 줄이
     * 영영 비어 있게 된다.
     */
    inFlightRef.current = new Set();
    monthRefetchRef.current = new Set();
    // 옛 받기의 로딩 표시도 지운다. 그 받기는 끝나도 표시를 끄지 않는다(새 조건의 표시를 끄지 않게).
    setLoadingMonths({});
    setLoadingRows({});
  }, [scopeKey, projectId]);

  /** 조건이 바뀌면 손으로 정한 펼침도 지운다. 그 달이 목록에서 사라질 수 있다. */
  useEffect(() => {
    setLevels({});
    setOpenRows({});
    /*
     * 탭의 바닥도 되돌린다.
     *
     * 남겨 두면 프로젝트나 묶음 단위를 바꾸는 순간 새 목록이 통째로 펼쳐진 채 서고,
     * 그만큼의 조회가 한꺼번에 나간다. 펼치는 것은 사용자가 그 목록을 보고 고르는 일이다.
     */
    setTabLevels({});
    // 받아 온 곳도 처음으로 돌린다. 새 목록은 위에서부터 다시 받는다.
    setReveal(REVEAL_STEP);
    // 고른 것은 `useTransactionSelection` 이 같은 조건으로 버린다.
  }, [scopeKey, projectId]);

  // ── 1단. 거래가 있는 달 ──
  useEffect(() => {
    const askedScope = scopeKey;
    if (!projectId) {
      setMonthsState({ scopeKey: askedScope, rows: EMPTY_MONTHS });
      return;
    }

    let alive = true;
    /*
     * 이미 받아 둔 목록이 있으면 "로딩 중"을 띄우지 않는다.
     *
     * 띄우면 화면이 목록 대신 한 줄짜리 문구로 바뀌고, 그만큼 짧아진 화면에서 스크롤이
     * 맨 위로 튄다. 거래 하나를 고쳤을 뿐인데 보던 자리를 잃는다.
     */
    if (!monthsLoadedRef.current && !readScreenCache(MONTHS_SLOT, askedScope)) {
      setIsLoadingMonths(true);
    }
    setHasError(false);

    homeDataPort()
      .getEntryMonths(projectId, { ...scope, ...monthsQuery })
      .then((rows) => {
        if (!alive) return;
        /*
         * 기간을 정했으면 그 기간이 줄 하나다. 받은 줄들은 이미 그 기간으로 잘라 센 값이라
         * 더하면 기간 전체의 합이다 (`collapseToRange`).
         */
        const shown = range ? collapseToRange(rows, range) : rows;
        setMonthsState({ scopeKey: askedScope, rows: shown });
        monthsLoadedRef.current = true;
        writeScreenCache(MONTHS_SLOT, askedScope, shown);
      })
      .catch((error) => {
        if (!alive) return;
        setMonthsState({ scopeKey: askedScope, rows: EMPTY_MONTHS });
        fail(error);
      })
      .finally(() => {
        if (alive) setIsLoadingMonths(false);
      });

    return () => {
      alive = false;
    };
  }, [projectId, scopeKey, mirrorVersion, reloadToken, fail]);

  /** 펼친 모양인 달. 목록에 있는 것만 본다 (검색으로 사라진 달은 세지 않는다). */
  const shownMonths = useMemo(
    () => months.map((month) => month.yearMonth).filter((yearMonth) => levelOf(yearMonth) >= 1),
    [months, levelOf],
  );
  /**
   * 펼친 모양으로만 서고 아직 안을 받지 않는 달인가.
   *
   * 손으로 편 달은 곧바로 받는다. 검색이나 탭이 한꺼번에 편 달만 위에서부터 `reveal` 개를
   * 받는다. 화면은 이런 달을 "불러오는 중"으로 세우고 그 아래는 그리지 않는다 -- 아래를
   * 그려 봐야 빈 상자들이고, 받은 곳의 바닥이 멀어져 다음 몫을 부르지 못한다.
   */
  const isMonthWaiting = useCallback(
    (yearMonth: string) => {
      if (levelOf(yearMonth) === 0) return false;
      if (levels[levelKey(yearMonth)] !== undefined) return false;
      const order = monthOrder.get(yearMonth);
      return order === undefined || order >= reveal;
    },
    [levelOf, levels, levelKey, monthOrder, reveal],
  );
  /** 지금 안을 받는 달. 조회는 모두 이것을 본다. */
  const openMonths = useMemo(
    () => shownMonths.filter((yearMonth) => !isMonthWaiting(yearMonth)),
    [shownMonths, isMonthWaiting],
  );
  const openMonthsKey = openMonths.join(',');
  /**
   * 거래까지 보이는 곳이 하나라도 있는가. 2단으로 편 달이나, 1단에서 손으로 편 줄이다.
   *
   * 줄의 열쇠는 `달|탭|줄` 이다. 접힌 달에 남은 자국은 접을 때 지우지만, 달의 단계도 함께
   * 본다 -- 2단에서 1단으로 내려온 달에는 옮겨 적은 줄이 남아 있다(`toggleRow`).
   */
  const entriesShown = useMemo(() => {
    if (shownMonths.some((yearMonth) => levelOf(yearMonth) === 2)) return true;
    return Object.entries(openRows).some(([id, open]) => {
      if (!open) return false;
      const [yearMonth, rowTab] = id.split('|');
      return rowTab === tab && levelOf(yearMonth) === 1;
    });
  }, [shownMonths, levelOf, openRows, tab]);

  // ── 2단. 펼친 달의 안쪽 값 ──
  useEffect(() => {
    if (!projectId || openMonths.length === 0) return;

    /*
     * 값이 바뀌어 도는 회차인가. 그때는 받아 둔 것을 믿지 않고 다시 받는다.
     *
     * 비우지 않으므로(위 "값이 바뀌어 다시 받아야 하는 회차의 표") 이 표시가 없으면
     * "이미 받아 뒀다"로 읽고 건너뛴다 -- 고친 거래가 목록에 반영되지 않는다.
     */
    const refreshing = monthRefreshRef.current !== refreshToken;
    monthRefreshRef.current = refreshToken;

    /*
     * 다시 받는 회차에는 **이번에 다시 받지 않는 것**을 버린다 (2026-10-16). 받는 것은 지금 탭의 펼친 달뿐이라,
     * 다른 탭과 접힌 달의 값은 옛 것으로 남아 나중에 펴면 "이미 받아 뒀다"로 그대로 섰다 -- 고른 것과 지우기도
     * 그 옛 id 를 보았다. 버려 두면 펼 때 새로 받는다. 지금 탭의 펼친 달은 남긴다(곧 덮이고, 그 사이 비지 않게).
     */
    if (refreshing) {
      const field = monthFieldOf(tab);
      const open = new Set(openMonths);
      setMonthData((prev) => {
        const next: typeof prev = {};
        for (const [yearMonth, data] of Object.entries(prev)) {
          if (open.has(yearMonth) && data?.[field]) next[yearMonth] = { [field]: data[field] };
        }
        return next;
      });
    }

    const port = homeDataPort();
    const askedScope = scopeKey;

    const load = async (yearMonth: string, force = refreshing) => {
      // 이미 받아 둔 탭은 다시 받지 않는다. ref 로 보는 것은 이 효과가 monthData 에
      // 의존하면 채울 때마다 다시 돌아 그치지 않기 때문이다.
      const have = force ? undefined : monthDataRef.current[yearMonth];
      if (have?.[monthFieldOf(tab)]) return;

      // 나가 있는 것은 다시 부르지 않는다. 줄 조회와 같은 자리를 쓴다.
      const flightId = `month|${tab}|${yearMonth}`;
      if (inFlightRef.current.has(flightId)) {
        /*
         * 값이 바뀌어 다시 받아야 하는데 앞 받기가 나가 있다. 그 받기는 바뀌기 전에 나간 것이라
         * 옛 값을 가져온다 -- 끝나면 한 번 더 받도록 적어 둔다 (2026-10-16). 예전에는 여기서 그냥
         * 물러나, 동기화 신호가 그 사이에 오면 고친 거래가 그 달에 반영되지 않았다.
         */
        if (force) monthRefetchRef.current.add(flightId);
        return;
      }
      /*
       * 이 받기가 적힌 자리. 조건이 바뀌면 `inFlightRef` 가 새 자리로 바뀌는데, 옛 받기가 끝날 때 새 자리에서
       * 지우면 새 조건으로 나간 같은 달의 받기가 "끝났다"로 보여 한 번 더 나가고 로딩 표시가 먼저 꺼졌다
       * (2026-10-16). 그래서 적은 자리에서 지우고, 표시는 같은 조건일 때만 끈다.
       */
      const flights = inFlightRef.current;
      flights.add(flightId);

      setLoadingMonths((prev) => ({ ...prev, [yearMonth]: true }));
      try {
        const period = periodOf(yearMonth);
        /*
         * 날짜별은 그 달의 거래를 통째로 받아 화면에서 묶는다.
         *
         * 날짜마다 따로 물으면 한 달에 서른 번 왕복한다. 그리고 그 목록은 3단(날짜
         * 하나의 거래)에서도 그대로 쓰이므로, 받아 두면 날짜를 눌러도 요청이 없다.
         */
        if (tab === 'date') {
          /*
           * 회차 기준이면 **지난달에 산 할부도 이 달의 줄이 된다.**
           *
           * 목록 질의는 전표의 날짜로 자르므로 그 거래는 여기 오지 않는다. 따로 받아
           * 합쳐 두면 회차를 고르고 구간 밖을 버리는 일은 `viewsOf` 가 한다.
           */
          const rows = await fetchEntriesWithInstallments(
            port,
            { ...scope, ...listRangeOf(yearMonth) },
            projectId,
            basis,
          );
          if (scopeKeyRef.current === askedScope) {
            setMonthData((prev) => ({
              ...prev,
              [yearMonth]: { ...prev[yearMonth], entries: rows },
            }));
          }
        } else if (tab === 'category') {
          // 지출과 수입을 함께 보여 준다. 탭을 하나 더 두는 것보다 한 줄 아래로 잇는 편이 짧다.
          const [expense, income] = await Promise.all([
            port.getCategoryBreakdown(period, 'expense', projectId, scope),
            port.getCategoryBreakdown(period, 'income', projectId, scope),
          ]);
          const rows: TransactionCategory[] = [
            ...expense.map((row) => ({ ...row, type: 'expense' as const })),
            ...income.map((row) => ({ ...row, type: 'income' as const })),
          ];
          if (scopeKeyRef.current === askedScope) {
            setMonthData((prev) => ({
              ...prev,
              [yearMonth]: { ...prev[yearMonth], categories: rows },
            }));
          }
        } else {
          const rows = await port.getPaymentMethods(period, projectId, scope);
          if (scopeKeyRef.current === askedScope) {
            setMonthData((prev) => ({
              ...prev,
              [yearMonth]: { ...prev[yearMonth], methods: rows },
            }));
          }
        }
      } catch (error) {
        fail(error);
      } finally {
        // 어떤 경우에도 지운다. 남으면 그 달이 "로딩 중"에서 멈춘다.
        flights.delete(flightId);
        if (scopeKeyRef.current === askedScope) {
          setLoadingMonths((prev) => ({ ...prev, [yearMonth]: false }));
        }
        // 나가 있는 동안 값이 바뀌었으면 지금 값으로 한 번 더 받는다 (위 적어 둔 자리).
        if (monthRefetchRef.current.delete(flightId) && scopeKeyRef.current === askedScope) {
          void load(yearMonth, true);
        }
      }
    };

    /*
     * 나눠 보낸다. 줄 조회와 같은 규칙이다 (`ROW_BATCH`).
     *
     * 예전에는 한꺼번에 던져도 괜찮았다. 펼치는 일이 달 하나씩이었기 때문이다. 지금은
     * 탭을 두 번 눌러 **목록을 통째로 펼 수 있어서**, 오래 쓴 가계부에서는 예순 개가
     * 한 번에 나간다. 나눠 보내면 화면이 위에서부터 차례로 채워진다.
     */
    void (async () => {
      for (let index = 0; index < openMonths.length; index += ROW_BATCH) {
        /*
         * 조건이 바뀌었으면 남은 묶음은 보내지 않는다. 도착해도 버려질 값이다.
         *
         * 나간 묶음은 끝맺게 두고(끊으면 로딩 표시가 남는다), 아직 나가지 않은 것만
         * 거둔다. 이것이 없으면 단위를 바꿀 때마다 옛 조건의 조회가 끝까지 돌아 쌓인다.
         */
        if (scopeKeyRef.current !== askedScope) return;
        await Promise.all(openMonths.slice(index, index + ROW_BATCH).map((yearMonth) => load(yearMonth)));
      }
    })();

    // 정리 함수를 두지 않는다 (3단 효과와 같은 이유).
  }, [projectId, openMonthsKey, tab, scopeKey, refreshToken, fail]);

  /** 검색이 고른 분류에 드는 줄만 남긴다. 고르지 않았으면 null (`categoryRowsToKeep`). */
  const keepCategoryIds = useMemo(
    () => categoryRowsToKeep(search.categoryIds, pickerCategories),
    [search.categoryIds, pickerCategories],
  );
  /** 검색이 고른 자산. 고르지 않았으면 null. */
  const keepMethodIds = useMemo(() => {
    const selected = new Set([...search.paymentAccountIds, ...search.paymentCardIds]);
    return selected.size === 0 ? null : selected;
  }, [search.paymentAccountIds, search.paymentCardIds]);

  /**
   * 날짜별 탭의 안쪽 줄을 무엇으로 끊는가.
   *
   * 바깥 묶음이 해면 달이다 -- 날로 끊으면 한 해에 줄이 삼백예순 개가 되어 펼치는
   * 뜻이 없어진다. 달과 주는 지금처럼 날이다.
   */
  const innerBucket: 'day' | 'month' = unit === 'year' ? 'month' : 'day';

  /**
   * 그 기간 줄이 보는 거래. 회차 기준이면 **회차로 옮긴 거래**다.
   *
   * 옮기는 일을 한 곳에서 하는 까닭은 날짜 때문이다. 회차는 그 달의 같은 날로 옮겨지고
   * (`installmentEntryViews`), 날짜별 줄도 달력도 그 날짜를 보고 선다 -- 옮기기 전의
   * 목록으로 묶으면 지난달에 산 할부가 지난달 날짜로 이번 달 안에 선다.
   */
  const viewsOf = useCallback(
    (yearMonth: string, entries: EntryListItem[]): EntryListItem[] => {
      if (basis !== 'installment') return entries;
      const window = windowOf(yearMonth);
      return installmentEntryViews(entries, { timeZone, from: window.start, to: window.end });
    },
    [basis, windowOf, timeZone],
  );

  /**
   * 달마다 한 번만 날짜로 묶어 둔다.
   *
   * **화면이 부를 때마다 묶으면 안 된다.** 2단(그 달을 전부 펼침)에서는 날짜 줄 서른
   * 개가 저마다 자기 거래를 물어 오는데, 그때마다 그 달 200건을 처음부터 다시 묶으면
   * 한 번 그리는 데 묶기가 예순 번 돈다. 묶기는 거래마다 Intl 로 타임존을 따지는
   * 일이라(`groupEntriesByDate` 머리말), 그 예순 번이 곧 "전체 열기가 버벅인다"였다.
   *
   * 여기서 한 번 묶어 두면 줄과 거래가 같은 Map 을 나눠 본다.
   */
  const groupedByMonth = useMemo(() => {
    const grouped = new Map<string, Map<string, EntryListItem[]>>();
    for (const [yearMonth, data] of Object.entries(monthData)) {
      if (data?.entries) {
        grouped.set(
          yearMonth,
          groupEntriesByBucket(viewsOf(yearMonth, data.entries), timeZone, innerBucket),
        );
      }
    }
    return grouped;
  }, [monthData, timeZone, innerBucket, viewsOf]);

  /**
   * 분류별·수단별 줄이 펼쳐 보여 주는 거래. 날짜별과 같은 규칙으로 옮긴다.
   *
   * 한 번 만들어 두는 것은 같은 배열을 돌려주기 위해서다 -- 부를 때마다 옮기면 줄이
   * 매번 새 목록을 받아 다시 그린다.
   */
  const rowEntryViews = useMemo(() => {
    if (basis !== 'installment') return rowEntries;

    const views: Record<string, EntryListItem[]> = {};
    for (const [id, entries] of Object.entries(rowEntries)) {
      // 열쇠는 `${yearMonth}|${tab}|${key}` 다. 앞자리가 그 줄이 선 기간이다.
      views[id] = viewsOf(id.slice(0, id.indexOf('|')), entries);
    }
    return views;
  }, [rowEntries, basis, viewsOf]);

  /**
   * 받아 둔 달의 안쪽 줄. 탭에 따라 무엇을 세는지가 다르다.
   *
   * 세 탭을 한 모양(`TransactionRow`)으로 맞춰 준다. 화면이 탭마다 갈라 그리면 같은
   * 줄을 세 번 적게 된다.
   *
   * 미리 다 만들어 두는 것은 값이 바뀌지 않는 한 **같은 배열을 돌려주기 위해서**다.
   * 부를 때마다 새 배열을 만들면 3단 효과가 줄 목록을 새 것으로 보고 다시 돌고,
   * 화면도 줄마다 새로 그린다.
   */
  const rowsByMonth = useMemo(() => {
    const rows = new Map<string, TransactionRow[]>();
    for (const yearMonth of Object.keys(monthData)) {
      rows.set(
        yearMonth,
        buildMonthRows({
          tab,
          data: monthData[yearMonth],
          grouped: groupedByMonth.get(yearMonth) ?? EMPTY_GROUP,
          innerBucket,
          keepCategoryIds,
          keepMethodIds,
          unassignedLabel: () => t('method.unassigned'),
        }),
      );
    }
    return rows;
  }, [monthData, groupedByMonth, tab, keepCategoryIds, keepMethodIds, t]);

  const rowsOf = useCallback(
    (yearMonth: string): TransactionRow[] => rowsByMonth.get(yearMonth) ?? EMPTY_ROWS,
    [rowsByMonth],
  );

  const rowId = useCallback((yearMonth: string, key: string) => `${yearMonth}|${tab}|${key}`, [tab]);

  /** 그 줄로 좁히는 조회 조건. 3단 조회와 선택 모드가 함께 쓴다 (`narrowQueryOf`). */
  const narrowOf = useCallback(
    (row: TransactionRow) => narrowQueryOf(row, tab, search, pickerCategories),
    [tab, pickerCategories, search],
  );

  /** 이 줄이 거래를 보여 주는 상태인가. 2단이면 전부 보여 준다. */
  const isRowOpen = useCallback(
    (yearMonth: string, key: string) =>
      levelOf(yearMonth) === 2 || openRows[rowId(yearMonth, key)] === true,
    [levelOf, openRows, rowId],
  );

  /*
   * ── 3단. 펼친 줄의 거래 ──
   *
   * 날짜별은 이미 받아 둔 그 달의 목록에서 고르므로 여기 오지 않는다.
   */
  useEffect(() => {
    if (!projectId || tab === 'date') return;

    // 값이 바뀐 회차에는 받아 둔 줄도 다시 받는다 (2단과 같은 규칙).
    const refreshing = rowRefreshRef.current !== refreshToken;
    rowRefreshRef.current = refreshToken;
    if (refreshing) {
      // 이번에 다시 받지 않는 줄(다른 탭·접힌 줄)은 버린다. 펼 때 새로 받는다 (2단의 같은 자리 주석).
      const openIds = new Set(
        openMonths.flatMap((yearMonth) =>
          rowsOf(yearMonth)
            .filter((row) => isRowOpen(yearMonth, row.key))
            .map((row) => rowId(yearMonth, row.key)),
        ),
      );
      setRowEntries((prev) => {
        const next: typeof prev = {};
        for (const [id, rows] of Object.entries(prev)) if (openIds.has(id)) next[id] = rows;
        return next;
      });
    }

    const needed: Array<{ yearMonth: string; row: TransactionRow }> = [];
    for (const yearMonth of openMonths) {
      for (const row of rowsOf(yearMonth)) {
        if (!isRowOpen(yearMonth, row.key)) continue;
        const id = rowId(yearMonth, row.key);
        if (!refreshing && rowEntries[id]) continue;
        // 이미 나가 있는 줄은 다시 부르지 않는다. 이것이 중복을 막는 유일한 자리다.
        if (inFlightRef.current.has(id)) continue;
        needed.push({ yearMonth, row });
      }
    }
    if (needed.length === 0) return;

    const port = homeDataPort();
    const askedScope = scopeKey;

    const load = async ({ yearMonth, row }: { yearMonth: string; row: TransactionRow }) => {
      const id = rowId(yearMonth, row.key);
      // 적은 자리에서 지운다 (달 받기의 `flights` 주석).
      const flights = inFlightRef.current;
      flights.add(id);
      setLoadingRows((prev) => ({ ...prev, [id]: true }));
      try {
        const narrow = {
          // 검색 키는 narrowOf 가 통째로 정한다(태그와 글자까지). 사람 필터만 남긴다.
          personIds: scope.personIds,
          ...listRangeOf(yearMonth),
          ...narrowOf(row),
        };
        // 회차 기준이면 지난 할부도 이 줄에 설 수 있다 (날짜별 탭과 같은 규칙이다).
        const rows = await fetchEntriesWithInstallments(port, narrow, projectId, basis);
        /*
         * 조건이 그대로일 때만 쓴다.
         *
         * 효과가 다시 돌았는지는 보지 않는다. 이 조회가 나가 있는 동안 형제 줄이
         * 도착해 효과가 여러 번 돌지만, 그것과 이 값이 쓸 만한지는 무관하다. 예전에는
         * 그 둘을 묶어 두어(`alive`) 형제가 도착할 때마다 남은 결과를 버렸다.
         */
        if (scopeKeyRef.current === askedScope) {
          setRowEntries((prev) => ({ ...prev, [id]: rows }));
        }
      } catch (error) {
        fail(error);
      } finally {
        // 어떤 경우에도 지운다. 남으면 그 줄이 "로딩 중"에서 멈춘다.
        flights.delete(id);
        if (scopeKeyRef.current === askedScope) {
          setLoadingRows((prev) => ({ ...prev, [id]: false }));
        }
      }
    };

    void (async () => {
      // 나눠 보낸다. 서른 개를 한꺼번에 던지면 받는 쪽에서 밀린다.
      for (let index = 0; index < needed.length; index += ROW_BATCH) {
        // 조건이 바뀌었으면 남은 묶음은 보내지 않는다 (2단과 같은 규칙).
        if (scopeKeyRef.current !== askedScope) return;
        await Promise.all(needed.slice(index, index + ROW_BATCH).map(load));
      }
    })();

    /*
     * 정리 함수를 두지 않는다.
     *
     * 나가 있는 조회는 그대로 끝맺어야 한다. 중간에 끊으면 그 줄의 거래가 오지 않고
     * 로딩 표시도 남는다. 두 번 부르는 것은 위의 `inFlightRef` 가 막는다.
     */
  }, [
    projectId,
    tab,
    openMonthsKey,
    monthData,
    openRows,
    levels,
    scopeKey,
    /*
     * 값이 바뀐 회차를 알아채려면 여기 있어야 한다.
     *
     * 예전에는 받아 둔 것을 비워 `monthData` 가 달라지는 바람에 저절로 돌았다. 이제는
     * 비우지 않으므로 이 값이 없으면 고친 거래가 3단에 반영되지 않는다.
     */
    refreshToken,
    rowEntries,
    rowsOf,
    isRowOpen,
    rowId,
    narrowOf,
    scope.personIds,
    fail,
  ]);

  /** 그 줄의 거래. 날짜별은 받아 둔 달 목록에서 고른다. */
  const entriesOf = useCallback(
    (yearMonth: string, key: string): EntryListItem[] => {
      if (tab === 'date') {
        return (groupedByMonth.get(yearMonth) ?? EMPTY_GROUP).get(key) ?? EMPTY_ENTRIES;
      }
      return rowEntryViews[rowId(yearMonth, key)] ?? EMPTY_ENTRIES;
    },
    [tab, groupedByMonth, rowEntryViews, rowId],
  );

  /**
   * 화면에 그릴 줄. 분할은 분류 줄마다, 회차 기준이면 그 구간에 선 회차만이다.
   *
   * 펴는 일을 화면이 아니라 여기서 하는 까닭은 회차 기준 때문이다 -- 줄을 세려면 그
   * 기간 줄이 보는 구간을 알아야 하는데, 그 구간을 아는 곳이 이 갈고리다.
   */
  const entryRowsOf = useCallback(
    // 회차로 옮기는 일은 `entriesOf` 가 이미 했다. 여기서는 분류 줄로 펴기만 한다.
    (yearMonth: string, key: string): EntryRow[] => entryRows(entriesOf(yearMonth, key)),
    [entriesOf],
  );

  // ── 여러 건 고르기 (지우기·태그·분류) ──
  const selection = useTransactionSelection({
    projectId,
    scopeKey,
    scopeKeyRef,
    inFlightRef,
    tab,
    basis,
    months,
    openMonths,
    openMonthsKey,
    monthData,
    rowEntries,
    groupedByMonth,
    rowEntryViews,
    scope,
    rowId,
    rowsOf,
    viewsOf,
    narrowOf,
    listRangeOf,
    fail,
    setReloadToken,
  });
  const { setSelected } = selection;

  /**
   * 년월 줄을 누른다. 접힘 -> 목록 -> 거래까지 -> 접힘 으로 돈다.
   *
   * **안쪽 줄을 하나라도 펴 두었으면 그 다음 누름은 곧바로 접는다.** 한 줄을 열어
   * 거래까지 본 사람이 년월 줄을 누르는 것은 "그만 보겠다"는 뜻이지 나머지 줄까지
   * 마저 펴 달라는 뜻이 아니다. 다시 펴려면 한 번 더 누르면 된다.
   *
   * 다른 달을 건드리지 않는다. 8월을 보다가 7월을 열어도 8월은 그대로 있어야 한다.
   */
  const cycleMonth = useCallback(
    (yearMonth: string) => {
      const level = levelOf(yearMonth);
      /*
       * 손으로 펴 둔 줄이 있는가. 열쇠가 `달|탭|줄` 이라 앞 두 조각으로 가른다.
       *
       * 2단은 줄마다 펴 둔 것과 무관하게 전부 펼친 상태고 다음이 이미 접힘이라
       * 1단에서만 본다. 접힌 달(0단)에 남은 자국은 없다 -- 접을 때 함께 지운다.
       */
      const hasOpenRow =
        level === 1 &&
        Object.entries(openRows).some(
          ([id, open]) => open && id.startsWith(`${yearMonth}|${tab}|`),
        );
      const next = (hasOpenRow ? 0 : (level + 1) % 3) as MonthLevel;
      setLevels((prev) => ({ ...prev, [levelKey(yearMonth)]: next }));
      // 접으면 이 탭에서 그 달에 손으로 편 줄도 함께 정리한다. 다른 탭은 그대로 둔다.
      if (next === 0) {
        setOpenRows((prev) => {
          const kept: Record<string, boolean> = {};
          for (const [id, open] of Object.entries(prev)) {
            if (!id.startsWith(`${yearMonth}|${tab}|`)) kept[id] = open;
          }
          return kept;
        });
      }
    },
    [levelOf, levelKey, openRows, tab],
  );

  /** 안쪽 줄을 누른다. */
  const toggleRow = useCallback(
    (yearMonth: string, key: string) => {
      const id = rowId(yearMonth, key);
      /*
       * 2단에서 한 줄을 누르면 그 달을 1단으로 내리고, 누른 줄만 접는다.
       *
       * 2단은 "전부 펼침"이라 줄마다 접힘을 적어 둘 자리가 없다. 그래서 내려오면서
       * 화면에 보이던 것을 그대로 옮겨 적는다 -- 그 달의 줄을 전부 열림으로 두고,
       * 누른 줄 하나만 닫는다. 예전에는 누른 줄만 열어 두었는데, 한 줄을 접으려던
       * 사람에게는 나머지가 다 접히는 것으로 보였다.
       */
      if (levelOf(yearMonth) === 2) {
        setLevels((prev) => ({ ...prev, [levelKey(yearMonth)]: 1 }));
        setOpenRows((prev) => {
          const next = { ...prev };
          for (const row of rowsOf(yearMonth)) {
            next[rowId(yearMonth, row.key)] = row.key !== key;
          }
          return next;
        });
        return;
      }
      setOpenRows((prev) => ({ ...prev, [id]: !prev[id] }));
    },
    [levelOf, levelKey, rowId, rowsOf],
  );

  /**
   * 탭을 옮긴다.
   *
   * 펼침과 열어 둔 줄은 탭별 열쇠로 적혀 있어 그대로 둔다. 옮겨 갔다 돌아오면 그
   * 탭에서 보던 자리가 남아 있다.
   *
   * **고른 것은 지운다.** 탭마다 줄이 가리키는 것이 달라서, 날짜별에서 고른 것을
   * 들고 수단별로 넘어가면 화면의 체크와 실제로 골라진 거래가 어긋난다. 지우는
   * 일에서 그런 어긋남은 두면 안 된다.
   */
  const changeTab = useCallback(
    (next: TransactionTab) => {
      /*
       * 이미 고른 탭을 또 누르면 **화면에 보이는 것을 보고 한 단씩 돈다.**
       *
       *   거래가 하나라도 보인다        → 전부 접는다
       *   안쪽 줄만 펴져 있다          → 거래까지 전부 편다
       *   전부 접혀 있다              → 안쪽 줄만 편다
       *
       * 탭의 바닥이 아니라 화면에 보이는 것을 따른다 -- 9월 하나를 거래까지 펴 둔 사람이
       * 탭을 누르는 것은 "그만 보겠다"는 뜻이다 (`cycleMonth` 와 같은 규칙이다).
       *
       * 거래까지 전부 펴도 한꺼번에 받지 않는다. 위에서부터 `REVEAL_STEP` 개의 달만 받고,
       * 아래는 화면이 내려갈 때 받는다(`isMonthWaiting`). 예전에는 수백 줄이 섰다 사라지는
       * 것을 걱정해 이 단을 건너뛰었는데, 그리기와 받기를 모두 나눠 하면서 그 걱정이 없어졌다.
       *
       * 손으로 정해 둔 줄은 지운다. 남겨 두면 "전부 펴라"고 눌렀는데 접어 둔 줄이
       * 그대로 접혀 있어, 눌러도 아무 일이 없는 것처럼 보인다.
       */
      if (next === tab) {
        const level: MonthLevel = entriesShown ? 0 : shownMonths.length > 0 ? 2 : 1;
        setTabLevels((prev) => ({ ...prev, [next]: level }));
        setLevels((prev) => {
          const kept: Record<string, MonthLevel> = {};
          for (const [id, value] of Object.entries(prev)) {
            if (!id.startsWith(`${next}|`)) kept[id] = value;
          }
          return kept;
        });
        /*
         * 이 탭에서 손으로 편 줄도 정리한다. 접을 때는 남길 까닭이 없고, 전부 펼 때는
         * 2단이 줄마다의 값을 보지 않는다. 안쪽 줄만 펼 때는 이미 다 접혀 있다.
         *
         * 줄의 열쇠는 `달|탭|줄` 이라 탭 이름이 가운데에 있다. 그 조각으로 가른다 --
         * 다른 탭에서 펴 둔 줄은 그대로 남는다.
         */
        setOpenRows((prev) => {
          const kept: Record<string, boolean> = {};
          for (const [id, open] of Object.entries(prev)) {
            if (!id.includes(`|${next}|`)) kept[id] = open;
          }
          return kept;
        });
        // 받는 곳도 위에서부터 다시 센다. 앞서 내려가며 늘려 둔 수만큼 한꺼번에 받으면 안 된다.
        setReveal(REVEAL_STEP);
        return;
      }

      setTab(next);
      setSelected({});
    },
    [tab, entriesShown, shownMonths],
  );

  /**
   * 묶는 단위를 바꾼다.
   *
   * 받아 둔 목록과 펼침은 `scopeKey` 가 단위를 들고 있어 저절로 비워진다 -- 열쇠의
   * 모양 자체가 달라지므로("2026-09" → "2026"), 남겨 두면 어느 줄도 맞지 않는다.
   * 고른 것만 여기서 지운다. 탭을 옮길 때와 같은 까닭이다.
   */
  const changeUnit = useCallback((next: EntryPeriodUnit) => {
    setUnit(next);
    setSelected({});
  }, [setUnit]);

  /**
   * 검색 창의 적용. 묶는 단위도 검색 창에서 고르므로(2026-10-07 사용자 요청, 그 전엔 더보기)
   * 검색과 함께 건다. 단위가 그대로면 고른 것을 지우지 않는다.
   */
  const applySearch = useCallback(
    (next: TransactionSearch, nextUnit: EntryPeriodUnit) => {
      setSearch(next);
      if (nextUnit !== unit) changeUnit(nextUnit);
    },
    [setSearch, unit, changeUnit],
  );

  /**
   * 그 달의 안쪽을 아직 그릴 수 없는가.
   *
   * **받아 둔 것이 있으면 로딩이라고 말하지 않는다.** 거래 하나를 고쳐 다시 받는 중에도
   * 앞선 값이 그대로 서 있어야 한다. "로딩 중" 한 줄로 바꿔 버리면 목록이 사라졌다가
   * 돌아오고, 그 사이에 짧아진 화면에서 스크롤이 맨 위로 튄다.
   */
  const isLoadingMonth = useCallback(
    (yearMonth: string) => {
      // 아직 받을 차례가 아닌 달도 화면에는 "불러오는 중"이다.
      if (isMonthWaiting(yearMonth)) return true;
      if (loadingMonths[yearMonth] !== true) return false;
      return !monthData[yearMonth]?.[monthFieldOf(tab)];
    },
    [isMonthWaiting, loadingMonths, monthData, tab],
  );
  /** 그 줄의 거래를 아직 그릴 수 없는가. 달과 같은 규칙이다. */
  const isLoadingRow = useCallback(
    (yearMonth: string, key: string) => {
      const id = rowId(yearMonth, key);
      if (loadingRows[id] !== true) return false;
      // 날짜별은 그 달의 목록에서 고르므로 줄마다 따로 받지 않는다.
      return tab === 'date' ? true : !rowEntries[id];
    },
    [loadingRows, rowEntries, rowId, tab],
  );

  /**
   * 펼친 곳 가운데 아직 값이 오지 않은 것이 있는가.
   *
   * 그동안은 `revealMore` 를 부르지 않는다. 받는 중인 줄은 짧게 서 있어 화면이 바닥에
   * 가까워 보이는데, 그때 또 펴면 받기도 전에 다음 묶음이 나가 결국 한꺼번에 편다.
   *
   * **로딩 표시(`loadingMonths`)로 보지 않는다.** 그 표시는 펼친 뒤의 효과가 켜므로,
   * 펼친 그림과 표시가 켜지는 그림 사이에 틈이 있다. 그 틈에 바닥 감지가 불려 다음 묶음이
   * 곧바로 펴지는 것을 기기에서 보았다(3 -> 6 -> 9 가 51ms 사이). 값이 있는지로 보면 틈이
   * 없다. 받다가 실패한 곳도 값이 없으므로 여기서 멈춘다 -- 받지 못하는 곳 아래를 더 펴 봐야
   * 같은 실패가 늘 뿐이다.
   */
  const isLoadingOpen = useMemo(() => {
    for (const yearMonth of openMonths) {
      if (!monthData[yearMonth]?.[monthFieldOf(tab)]) return true;
      // 날짜별은 그 달의 목록에서 고르므로 줄마다 따로 받지 않는다.
      if (tab === 'date') continue;
      for (const row of rowsOf(yearMonth)) {
        if (isRowOpen(yearMonth, row.key) && !rowEntries[rowId(yearMonth, row.key)]) return true;
      }
    }
    return false;
  }, [openMonths, monthData, tab, rowsOf, isRowOpen, rowEntries, rowId]);

  return {
    // 1단
    months,
    /*
     * 조건을 바꾼 직후, 1단 효과가 돌기 전의 한 그림도 로딩으로 본다. 그 그림에서는
     * 목록이 비어 있어 "거래가 없습니다"가 한 번 스친다.
     */
    isLoadingMonths: isLoadingMonths || (isMonthsStale && cachedMonths === undefined),
    levelOf,
    cycleMonth,
    revealMore,
    /** 펼친 모양으로만 서고 아직 받지 않은 기간 줄이 남았는가. */
    canRevealMore: shownMonths.some(isMonthWaiting),
    /**
     * 기간 줄을 나누는 규칙 (`PeriodGrouping`). 분석 화면이 같은 규칙으로 오늘이 든 기간을
     * 연다. 기간을 정했으면 그 한 줄의 열쇠가 `rangeKey` 다.
     */
    grouping: useMemo<PeriodGrouping>(
      () => ({
        unit,
        weekStart: groupWeekStart,
        anchor,
        rangeKey: range ? (months[0]?.yearMonth ?? null) : null,
      }),
      [unit, groupWeekStart, anchor, range, months],
    ),
    isMonthWaiting,
    isLoadingOpen,
    // 2단
    tab,
    changeTab,
    /**
     * 거래가 하나라도 보이는가. 곧 **고른 탭을 다시 누르면 전부 접힌다**는 뜻이다.
     *
     * 화면이 이 값으로 탭의 꺾쇠 방향을 정한다 -- 다음 누름이 펴는 것인지 접는 것인지를
     * 미리 말해 주지 않으면, 이미 고른 탭을 다시 누를 까닭을 아무도 모른다.
     */
    tabOpen: entriesShown,
    /**
     * 고른 탭을 다시 눌러 정한 바닥. 손대지 않았으면 null.
     *
     * 화면이 그리기 몫(`useRenderBudget`)의 열쇠에 넣는다. 탭을 눌러 모두 펴거나 접는 것은
     * 보는 목록을 통째로 바꾸는 일이라, 앞에서 늘려 둔 몫이 남으면 받은 줄을 한꺼번에 다
     * 그리고 그 아래 달까지 줄줄이 받는다.
     */
    tabLevel: tabLevels[tab] ?? null,
    /** 바깥 묶음 -- 해·달·주. 화면의 더보기 메뉴가 바꾼다. */
    unit,
    changeUnit,
    rowsOf,
    isLoadingMonth,
    // 3단
    isRowOpen,
    toggleRow,
    entriesOf,
    entryRowsOf,
    basis,
    isLoadingRow,
    // 검색
    search,
    setSearch,
    applySearch,
    /**
     * 조회에 실어 보내는 조건 (사람 필터 + 검색 + 세는 방식). 기간은 들지 않는다 -- `range` 가 따로 든다.
     * 거래 분석 창이 목록과 같은 조건으로 그래프를 그리려고 받는다.
     */
    scope,
    /** 검색이 고른 기간. 온전하지 않거나 없으면 null. */
    range,
    searchCount,
    /** 거르는 조건이 걸려 있는가. 세는 기준만 바꿨으면 거르는 것이 없다. */
    isFiltering: isSearching,
    searchChips,
    removeSearchChip,
    // 지울 것 고르기 (`useTransactionSelection`)
    isSelecting: selection.isSelecting,
    startSelecting: selection.startSelecting,
    stopSelecting: selection.stopSelecting,
    selectedCount: selection.selectedCount,
    selectedShapes: selection.selectedShapes,
    isEntrySelected: selection.isEntrySelected,
    toggleEntrySelected: selection.toggleEntrySelected,
    monthChecked: selection.monthChecked,
    rowChecked: selection.rowChecked,
    toggleRange: selection.toggleRange,
    /** 그 범위의 거래를 세는 중인가. 체크박스가 눌린 것을 보여 주는 자리다. */
    isRangePending: selection.isRangePending,
    deleteSelected: selection.deleteSelected,
    /** 상세에서 한 건만 지운다. 고르는 상태는 건드리지 않는다. */
    deleteEntry: selection.deleteEntry,
    isDeleting: selection.isDeleting,
    /** 지금 고르는 것이 무엇을 위한 것인가. 머리글의 버튼이 이 값으로 갈린다. */
    selectPurpose: selection.selectPurpose,
    startDeleteWith: selection.startDeleteWith,
    tagSelected: selection.tagSelected,
    isTagging: selection.isTagging,
    recategorizeSelected: selection.recategorizeSelected,
    isRecategorizing: selection.isRecategorizing,
    /** 고른 거래가 **모두** 가진 태그. 창이 체크된 채로 연다. */
    commonTagIds: selection.commonTagIds,
    /** 고른 거래 중 **일부만** 가진 태그. 창이 "일부"로 표시한다. */
    partialTagIds: selection.partialTagIds,
    /** 이 프로젝트의 구성원. 제목(자산주인)과 `usePersonFilterSync` 가 쓴다. */
    people,
    pickerCategories,
    pickerAccounts,
    pickerCards,
    /** 태그로 고를 수 있는 것. 검색 창과 태그 붙이기 창이 함께 쓴다. */
    pickerTags,
    // 그 밖
    hasError,
    timeZone,
    hasProject: projects.length > 0,
    reload: useCallback(() => setReloadToken((token) => token + 1), []),
  };
}
