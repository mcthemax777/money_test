/**
 * 거래 화면의 값과 상태.
 *
 * 화면은 세 겹으로 파고든다. **년월 -> (날짜·분류·수단) -> 거래**. 겹마다 무엇을
 * 보여 줄지는 여기서 정하고, 어떻게 그릴지는 화면이 정한다. 웹과 앱이 같은 훅을 쓴다.
 *
 * 읽기는 전부 `homeDataPort()` 를 거친다. 그래서 이 화면은 서버에서 온 값인지 기기
 * 사본에서 온 값인지 모른 채로 돌고, 오프라인에서도 같은 코드가 그대로 쓰인다.
 * (가계 화면의 분류별·수단별 탭은 `apiClient` 를 직접 불러서 오프라인이면 빈다.)
 *
 * 한 겹씩 받는 것이 요점이다. 전체 기간의 거래를 한 번에 받으면 해가 갈수록 첫 화면이
 * 느려진다. 첫 요청은 "거래가 있는 달" 목록 하나뿐이고, 나머지는 사용자가 편 자리만
 * 받는다. 받아 둔 것은 접었다 펴도 다시 받지 않는다.
 *
 * **여러 달을 함께 펼 수 있다.** 달마다 펼침 정도를 따로 들고 있어서, 8월을 보다가
 * 7월을 열어도 8월이 닫히지 않는다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AccountDto,
  CardDto,
  CategoryDto,
  EntryKind,
  EntryListItem,
  PersonDto,
  EntryScopeQuery,
  ReportDto,
} from '@money/types';
import { HIDDEN_ACCOUNT_TYPES, toEntrySearchQuery } from '@money/types';

import { entryWritePort } from '../data/entry-write-port';
import { homeDataPort } from '../data/home-port';
import { useMirrorVersion } from './useMirrorVersion';
import { countedShare, groupEntriesByDate, sumEntries, type CountedShare } from '../lib/entries';
import { isOfflineError } from '../lib/offline-error';
import { useProject, useProjectTimeZone } from '../store/project';
import { useUserFilter } from '../store/user-filter';

/** 년월 아래에서 무엇으로 나눠 볼지. */
export type TransactionTab = 'date' | 'category' | 'method';

/**
 * 년월 줄의 펼침 정도. 누를 때마다 한 칸 오르고 돌아온다.
 *
 *   0  접힘
 *   1  안쪽 목록까지 (날짜·분류·수단)
 *   2  그 목록의 거래까지 전부
 *
 * 두 단계로 나눈 이유가 있다. 한 달에 분류가 열 몇 개면 거래까지 한꺼번에 펴면 화면이
 * 수백 줄이 된다. 훑을 때는 1단이 맞고, 그 달을 통째로 읽을 때는 2단이 맞다.
 */
export type MonthLevel = 0 | 1 | 2;

/** 검색이 고른 것. 무리 안은 OR, 무리끼리는 AND (types 의 parseEntrySearch). */
export interface TransactionSearch {
  categoryIds: string[];
  paymentAccountIds: string[];
  paymentCardIds: string[];
  /** 지출·수입·이체·카드정산. 고른 것끼리 OR 이고 다른 무리와는 AND 다. */
  kinds: EntryKind[];
}

export const EMPTY_SEARCH: TransactionSearch = {
  categoryIds: [],
  paymentAccountIds: [],
  paymentCardIds: [],
  kinds: [],
};

/**
 * 분류별 목록의 한 줄.
 *
 * 구성비는 지출과 수입을 따로 물어야 해서 두 목록을 이어 붙인다. 이어 붙이고 나면
 * 줄만 보고는 어느 쪽인지 알 수 없으므로, 붙이는 자리에서 유형을 적어 둔다. 화면이
 * 분류를 다시 찾아보게 두면 롤업된 대분류에서 어긋난다.
 */
export interface TransactionCategory extends ReportDto.CategoryBreakdownItem {
  type: 'income' | 'expense';
}

/**
 * 안쪽 목록의 한 줄. 세 탭이 같은 모양으로 내려온다.
 *
 * 화면이 탭마다 다른 모양을 받아 갈라 그리면 같은 줄을 세 번 적게 된다. 여기서 한
 * 모양으로 맞춰 주고, 탭에 따라 다른 것은 `key` 가 무엇을 가리키는지뿐이다.
 */
export interface TransactionRow {
  /** 이 줄을 가리키는 값. 날짜 키, 분류 id, 결제수단 id. */
  key: string;
  label: string;
  sub?: string;
  /** 그 줄에 든 거래 수. 수단별은 세지 않아 없다. */
  count?: number;
  expense: number;
  income: number;
  /** 수단별에서만. 계좌인지 카드인지에 따라 조회 조건이 다르다. */
  methodKind?: ReportDto.PaymentMethodItem['kind'];
}

/** 한 달의 안쪽 값. 탭마다 따로 받아 두고 탭을 오갈 때 다시 받지 않는다. */
interface MonthData {
  entries?: EntryListItem[];
  categories?: TransactionCategory[];
  methods?: ReportDto.PaymentMethodItem[];
}

/**
 * 한 달을 가리키는 조회 조건.
 *
 * **달 이름을 그대로 넘긴다.** 예전에는 `-01 ~ -31` 구간을 만들어 넘겼는데 두 가지가
 * 어긋났다.
 *
 *   ① `new Date('2026-11-31')` 은 오류가 아니라 **2026-12-01 로 넘어간다**(2월은 3월
 *      3일까지). 그래서 30일 이하인 달을 고르면 다음 달 초하루가 함께 골라졌다 --
 *      그 달이 "일부 선택"으로 보이는 것이 그 흔적이다.
 *   ② UTC 자정은 한국의 오전 9시다. 그 앞 아홉 시간의 거래가 목록에서 빠지는데 월
 *      합계는 그것을 세고 있었다.
 *
 * 경계를 만드는 일은 각자 아는 쪽이 한다. 서버는 프로젝트 타임존으로, 기기는 동기화할
 * 때 박아 둔 `yearMonth` 컬럼으로.
 */
const monthRange = (yearMonth: string) => ({ yearMonth });

/**
 * 한 번에 보내는 거래 조회의 수.
 *
 * 2단으로 펼치면 줄마다 조회가 하나씩 나간다. 달 셋에 분류 열이면 서른이고, 한꺼번에
 * 보내면 받는 쪽에서 밀린다. 나눠 보내면 화면이 위에서부터 차례로 채워진다.
 */
const ROW_BATCH = 6;

export function useTransactions(projectId: string | null) {
  const timeZone = useProjectTimeZone();
  const projects = useProject((state) => state.projects);
  const selectedPersonIds = useUserFilter((state) => state.selectedPersonIds);
  /** 동기화가 사본을 채우면 올라간다. 이 값이 바뀌면 화면이 다시 읽는다. */
  const mirrorVersion = useMirrorVersion();

  const [search, setSearch] = useState<TransactionSearch>(EMPTY_SEARCH);
  const [tab, setTab] = useState<TransactionTab>('date');
  /**
   * 사용자가 직접 정한 펼침 정도. 손대지 않은 달은 아래 기본값을 따른다.
   *
   * 열쇠가 `탭|달` 이다. **탭마다 따로 접고 펴야 한다** -- 날짜별에서 8월을 펼쳐 둔
   * 것과 분류별에서 8월을 펼쳐 둔 것은 다른 이야기이고, 한 벌로 두면 탭을 옮길 때마다
   * 보려던 것이 아닌 자리가 펼쳐져 있다.
   */
  const [levels, setLevels] = useState<Record<string, MonthLevel>>({});
  /** 1단에서 손으로 편 줄. 2단에서는 이것과 무관하게 전부 펼친다. */
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});

  const [people, setPeople] = useState<PersonDto.Response[]>([]);
  /*
   * 검색이 고를 목록. 프로젝트가 바뀔 때 한 번만 받는다.
   *
   * 검색 조건이 바뀔 때마다 다시 받지 않는다. 고를 수 있는 분류와 자산은 검색 결과와
   * 무관하고, 결과에 따라 목록이 줄어들면 방금 켠 조건을 되돌릴 수 없게 된다.
   */
  const [pickerCategories, setPickerCategories] = useState<CategoryDto.Response[]>([]);
  const [pickerAccounts, setPickerAccounts] = useState<AccountDto.Response[]>([]);
  const [pickerCards, setPickerCards] = useState<CardDto.Response[]>([]);

  const [months, setMonths] = useState<ReportDto.EntryMonth[]>([]);
  const [monthData, setMonthData] = useState<Record<string, MonthData>>({});
  /** 줄 하나의 거래. 열쇠는 `달|탭|줄`. 접었다 펴도 다시 받지 않는다. */
  const [rowEntries, setRowEntries] = useState<Record<string, EntryListItem[]>>({});

  /*
   * 지울 것을 고르는 중인가.
   *
   * 이 화면은 훑어보는 자리라 평소에는 누르면 상세가 뜬다. 고르는 중에는 같은 누름이
   * 체크가 되어야 하므로, 두 뜻을 한 상태로 갈라 둔다.
   */
  const [isSelecting, setIsSelecting] = useState(false);
  /** 고른 거래. 열쇠는 거래 id 다. */
  const [selected, setSelected] = useState<Record<string, true>>({});
  /**
   * 범위(달·줄)에 든 거래 id.
   *
   * 년월 줄을 체크하면 그 달의 거래를 전부 고르는 것인데, 펼치지 않은 달은 목록을 아직
   * 받지 않았다. 그때 한 번 조회해 여기 적어 두고, 체크 상태(전부/일부)를 판단할 때도
   * 같은 값을 본다.
   */
  const [rangeIds, setRangeIds] = useState<Record<string, string[]>>({});
  /**
   * 범위의 거래를 세는 조회가 나가 있는 자리.
   *
   * 날짜별은 그 달의 목록을 이미 받아 두어 체크가 곧바로 걸린다. **수단별·분류별은
   * 그렇지 않다** -- 그 탭이 받아 둔 것은 수단·분류 줄이라, 달을 체크하려면 그 달의
   * 거래를 새로 물어야 한다. 그 사이에 아무 표시가 없으면 눌러도 안 걸리는 것처럼
   * 보인다(수단별에서 실제로 그랬다).
   */
  const [rangePending, setRangePending] = useState<Record<string, boolean>>({});
  const [isDeleting, setIsDeleting] = useState(false);

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

  const [isLoadingMonths, setIsLoadingMonths] = useState(false);
  const [loadingMonths, setLoadingMonths] = useState<Record<string, boolean>>({});
  const [loadingRows, setLoadingRows] = useState<Record<string, boolean>>({});
  const [hasError, setHasError] = useState(false);
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
      /*
       * 일반/과소비는 여기서 거르지 않는다.
       *
       * 거래 화면은 훑어보는 자리라 기본이 전부다. 가계 화면이 그 필터를 들고 있고,
       * 여기 다시 두면 두 화면이 각자 상태를 가져 오가는 동안 조건이 어긋난다.
       */
      ...toEntrySearchQuery(search),
    }),
    [selectedPersonIds, search],
  );

  /** 금액을 셀 때 어느 몫을 세는지. 목록 소계가 서버 합계와 같아야 한다. */
  const share: CountedShare = countedShare(scope);
  const scopeKey = JSON.stringify(scope);
  /*
   * 지금 조건. 도착한 값이 아직 쓸 것인지 판단한다.
   *
   * 조회를 보낼 때의 조건과 다르면 그 값은 옛 조건의 것이라 버려야 한다. 이것만 보면
   * 되므로 효과가 다시 도는 것과 결과를 쓰는 것을 갈라 둘 수 있다.
   */
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey;

  const searchCount =
    search.categoryIds.length +
    search.paymentAccountIds.length +
    search.paymentCardIds.length +
    search.kinds.length;

  /**
   * 손대지 않은 달의 펼침 정도.
   *
   * **검색을 켜면 전부 펼친다.** 검색은 이미 좁힌 결과라, 그 안에서 다시 한 줄씩 눌러
   * 열게 하면 좁힌 뜻이 사라진다. 검색을 켠 사람이 보고 싶은 것은 남은 거래 전부다.
   */
  const defaultLevel: MonthLevel = searchCount > 0 ? 2 : 0;
  /** 펼침을 적어 두는 열쇠. 탭이 다르면 다른 자리다. */
  const levelKey = useCallback((yearMonth: string) => `${tab}|${yearMonth}`, [tab]);
  const levelOf = useCallback(
    (yearMonth: string): MonthLevel => levels[levelKey(yearMonth)] ?? defaultLevel,
    [levels, levelKey, defaultLevel],
  );

  const fail = useCallback((error: unknown) => {
    // 오프라인은 오류가 아니다. 사본이 답할 수 없을 때만 화면에 알린다.
    if (!isOfflineError(error)) setHasError(true);
  }, []);

  /** 조건이 바뀌면 받아 둔 것을 버린다. 남겨 두면 옛 조건의 값이 화면에 남는다. */
  useEffect(() => {
    setMonthData({});
    setRowEntries({});
    setLoadingMonths({});
    setLoadingRows({});
    /*
     * 나가 있던 것도 잊는다.
     *
     * 그 조회들은 옛 조건의 것이라 도착해도 버려진다(위 scopeKeyRef). 여기서 지워
     * 두지 않으면 새 조건으로 같은 줄을 다시 부를 때 "이미 나가 있다"로 막혀, 그 줄이
     * 영영 비어 있게 된다.
     */
    inFlightRef.current = new Set();
    setRangePending({});
  }, [scopeKey, projectId, mirrorVersion, reloadToken]);

  /** 조건이 바뀌면 손으로 정한 펼침도 지운다. 그 달이 목록에서 사라질 수 있다. */
  useEffect(() => {
    setLevels({});
    setOpenRows({});
    /*
     * 고른 것도 버린다.
     *
     * 목록에 보이지 않는 거래가 골라진 채로 남으면, 삭제 버튼의 숫자가 화면에 없는
     * 것을 세게 된다. 지우는 일에서 그런 어긋남은 그냥 두면 안 된다.
     */
    setSelected({});
    setRangeIds({});
  }, [scopeKey, projectId]);

  // ── 기준 목록 (검색이 고를 것과 제목의 이름) ──
  useEffect(() => {
    if (!projectId) {
      setPeople([]);
      setPickerCategories([]);
      setPickerAccounts([]);
      setPickerCards([]);
      return;
    }

    let alive = true;
    const port = homeDataPort();

    Promise.all([
      port.getPeople(projectId),
      port.getCategories(projectId),
      port.getAccountsV2(projectId),
      port.getCards(projectId),
    ])
      .then(([personRows, categoryRows, accountRows, cardRows]) => {
        if (!alive) return;
        setPeople(personRows);
        setPickerCategories(categoryRows.filter((row) => row.isActive));
        /*
         * 고를 수 없는 계좌를 목록에서 뺀다.
         *
         * 신용카드의 부채 계정과 기초잔액 계정은 사용자가 "결제수단"으로 인식하는
         * 것이 아니다. 카드로 쓴 것은 카드 줄에서 고르고, 기초잔액은 결제가 아니다.
         */
        setPickerAccounts(
          accountRows.filter((row) => row.isActive && !HIDDEN_ACCOUNT_TYPES.includes(row.type)),
        );
        setPickerCards(cardRows.filter((row) => row.isActive));
      })
      .catch(fail);

    return () => {
      alive = false;
    };
  }, [projectId, mirrorVersion, fail]);

  // ── 1단. 거래가 있는 달 ──
  useEffect(() => {
    if (!projectId) {
      setMonths([]);
      return;
    }

    let alive = true;
    setIsLoadingMonths(true);
    setHasError(false);

    homeDataPort()
      .getEntryMonths(projectId, scope)
      .then((rows) => {
        if (alive) setMonths(rows);
      })
      .catch((error) => {
        if (!alive) return;
        setMonths([]);
        fail(error);
      })
      .finally(() => {
        if (alive) setIsLoadingMonths(false);
      });

    return () => {
      alive = false;
    };
  }, [projectId, scopeKey, mirrorVersion, reloadToken, fail]);

  /** 지금 펼쳐진 달. 목록에 있는 것만 본다 (검색으로 사라진 달은 세지 않는다). */
  const openMonths = useMemo(
    () => months.map((month) => month.yearMonth).filter((yearMonth) => levelOf(yearMonth) >= 1),
    [months, levelOf],
  );
  const openMonthsKey = openMonths.join(',');

  // ── 2단. 펼친 달의 안쪽 값 ──
  const monthDataRef = useRef(monthData);
  monthDataRef.current = monthData;

  useEffect(() => {
    if (!projectId || openMonths.length === 0) return;

    const port = homeDataPort();
    const askedScope = scopeKey;

    const load = async (yearMonth: string) => {
      // 이미 받아 둔 탭은 다시 받지 않는다. ref 로 보는 것은 이 효과가 monthData 에
      // 의존하면 채울 때마다 다시 돌아 그치지 않기 때문이다.
      const have = monthDataRef.current[yearMonth];
      if (tab === 'date' && have?.entries) return;
      if (tab === 'category' && have?.categories) return;
      if (tab === 'method' && have?.methods) return;

      // 나가 있는 것은 다시 부르지 않는다. 줄 조회와 같은 자리를 쓴다.
      const flightId = `month|${tab}|${yearMonth}`;
      if (inFlightRef.current.has(flightId)) return;
      inFlightRef.current.add(flightId);

      setLoadingMonths((prev) => ({ ...prev, [yearMonth]: true }));
      try {
        const period = { yearMonth } as const;
        /*
         * 날짜별은 그 달의 거래를 통째로 받아 화면에서 묶는다.
         *
         * 날짜마다 따로 물으면 한 달에 서른 번 왕복한다. 그리고 그 목록은 3단(날짜
         * 하나의 거래)에서도 그대로 쓰이므로, 받아 두면 날짜를 눌러도 요청이 없다.
         */
        if (tab === 'date') {
          const rows = await port.getAllEntries(
            { ...scope, ...monthRange(yearMonth), limit: 200 },
            projectId,
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
        inFlightRef.current.delete(flightId);
        setLoadingMonths((prev) => ({ ...prev, [yearMonth]: false }));
      }
    };

    void Promise.all(openMonths.map(load));

    // 정리 함수를 두지 않는다 (3단 효과와 같은 이유).
  }, [projectId, openMonthsKey, tab, scopeKey, mirrorVersion, reloadToken, fail]);

  /** 검색이 고른 분류에 드는 줄만 남긴다. 고르지 않았으면 null. */
  const keepCategoryIds = useMemo(() => {
    const selected = search.categoryIds;
    if (selected.length === 0) return null;

    /*
     * 구성비는 **전표 수준**으로 걸러 온다. 그래서 생활비를 찾으면 생활비가 섞인 분할
     * 거래가 통째로 들고, 그 거래의 다른 분류(식비)까지 줄로 나온다. 합계로는 맞지만
     * 목록으로는 틀리다 -- 고르지 않은 분류가 목록에 있으면 검색이 듣지 않는 것처럼 보인다.
     *
     * 롤업 때문에 줄은 대분류다. 고른 것이 소분류면 그 부모 줄을 남긴다.
     */
    const parentOf = new Map(pickerCategories.map((row) => [row.id, row.parentId]));
    const keep = new Set<string>();
    for (const id of selected) {
      keep.add(id);
      const parent = parentOf.get(id);
      if (parent) keep.add(parent);
    }
    return keep;
  }, [search.categoryIds, pickerCategories]);

  /** 검색이 고른 자산. 고르지 않았으면 null. */
  const keepMethodIds = useMemo(() => {
    const selected = new Set([...search.paymentAccountIds, ...search.paymentCardIds]);
    return selected.size === 0 ? null : selected;
  }, [search.paymentAccountIds, search.paymentCardIds]);

  /**
   * 그 달의 안쪽 줄. 탭에 따라 무엇을 세는지가 다르다.
   *
   * 세 탭을 한 모양(`TransactionRow`)으로 맞춰 준다. 화면이 탭마다 갈라 그리면 같은
   * 줄을 세 번 적게 된다.
   */
  const rowsOf = useCallback(
    (yearMonth: string): TransactionRow[] => {
      const data = monthData[yearMonth];

      if (tab === 'date') {
        const grouped = groupEntriesByDate(data?.entries ?? [], timeZone);
        return [...grouped.entries()]
          .sort(([a], [b]) => b.localeCompare(a))
          .map(([dateKey, rows]) => {
            const totals = sumEntries(rows, share);
            return {
              key: dateKey,
              label: String(Number(dateKey.slice(8, 10))),
              count: rows.length,
              expense: totals.expenseTotal,
              income: totals.incomeTotal,
            };
          });
      }

      if (tab === 'category') {
        return (data?.categories ?? [])
          .filter((row) => !keepCategoryIds || keepCategoryIds.has(row.categoryId))
          .map((row) => ({
            key: row.categoryId,
            label: row.parentCategoryName
              ? `${row.parentCategoryName} > ${row.categoryName}`
              : row.categoryName,
            count: row.count,
            expense: row.type === 'expense' ? Number(row.amount) : 0,
            income: row.type === 'income' ? Number(row.amount) : 0,
          }));
      }

      /*
       * 수단별 목록은 그 달에 쓰지 않은 계좌·카드까지 0원으로 담아 온다(가계 화면이
       * 그것을 쓴다). 검색을 켠 화면에서는 고르지 않은 카드가 0원 줄로 남으면 안 된다.
       */
      return (data?.methods ?? [])
        .filter((row) => !keepMethodIds || keepMethodIds.has(row.id))
        .map((row) => ({
          key: row.id,
          label: row.name,
          sub: row.ownerName ?? undefined,
          expense: Number(row.amount),
          income: Number(row.income),
          methodKind: row.kind,
        }));
    },
    [monthData, tab, timeZone, share, keepCategoryIds, keepMethodIds],
  );

  const rowId = useCallback((yearMonth: string, key: string) => `${yearMonth}|${tab}|${key}`, [tab]);

  /**
   * 그 줄로 좁히는 조회 조건.
   *
   * **검색과 같은 파라미터**로 한다. 무리 하나를 그 줄로 바꾸고 다른 무리는 검색이
   * 고른 것을 그대로 둔다. 단일 파라미터(`categoryId`·`paymentCardId`)를 쓰지 않는
   * 이유가 있다 -- 서버는 그것을 알지만 기기 사본은 모른다. 사본이 조용히 무시하면
   * 어느 줄을 눌러도 그 달 전체가 나온다(실제로 그랬다).
   *
   * 3단 조회와 선택 모드(그 줄에 든 거래를 모을 때)가 함께 쓴다.
   */
  const narrowOf = useCallback(
    (row: TransactionRow) => {
      if (tab === 'category') {
        const parentOf = new Map(pickerCategories.map((c) => [c.id, c.parentId]));
        // 줄은 롤업된 대분류다. 고른 소분류가 있으면 그것만 남긴다.
        const chosen = search.categoryIds.filter(
          (cid) => cid === row.key || parentOf.get(cid) === row.key,
        );
        return toEntrySearchQuery({
          categoryIds: chosen.length > 0 ? chosen : [row.key],
          paymentAccountIds: search.paymentAccountIds,
          paymentCardIds: search.paymentCardIds,
          kinds: search.kinds,
        });
      }

      return toEntrySearchQuery({
        categoryIds: search.categoryIds,
        paymentAccountIds: row.methodKind === 'account' ? [row.key] : [],
        paymentCardIds: row.methodKind === 'account' ? [] : [row.key],
        kinds: search.kinds,
      });
    },
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

    const needed: Array<{ yearMonth: string; row: TransactionRow }> = [];
    for (const yearMonth of openMonths) {
      for (const row of rowsOf(yearMonth)) {
        if (!isRowOpen(yearMonth, row.key)) continue;
        const id = rowId(yearMonth, row.key);
        if (rowEntries[id]) continue;
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
      inFlightRef.current.add(id);
      setLoadingRows((prev) => ({ ...prev, [id]: true }));
      try {
        const rows = await port.getAllEntries(
          {
            // 검색 키는 narrowOf 가 통째로 정한다. 사람 필터만 남긴다.
            personIds: scope.personIds,
            ...monthRange(yearMonth),
            ...narrowOf(row),
            limit: 200,
          },
          projectId,
        );
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
        inFlightRef.current.delete(id);
        setLoadingRows((prev) => ({ ...prev, [id]: false }));
      }
    };

    void (async () => {
      // 나눠 보낸다. 서른 개를 한꺼번에 던지면 받는 쪽에서 밀린다.
      for (let index = 0; index < needed.length; index += ROW_BATCH) {
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
    defaultLevel,
    scopeKey,
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
        const grouped = groupEntriesByDate(monthData[yearMonth]?.entries ?? [], timeZone);
        return grouped.get(key) ?? [];
      }
      return rowEntries[rowId(yearMonth, key)] ?? [];
    },
    [tab, monthData, timeZone, rowEntries, rowId],
  );

  // ── 지울 것 고르기 ──

  /** 범위를 적어 두는 열쇠. 달과 줄을 갈라 둔다. */
  const monthKeyOf = useCallback((yearMonth: string) => `m|${yearMonth}`, []);
  const rowKeyOf = useCallback(
    (yearMonth: string, key: string) => `r|${yearMonth}|${tab}|${key}`,
    [tab],
  );

  /**
   * 이미 알고 있는 그 달의 거래 id.
   *
   * 날짜별 탭은 그 달의 목록을 통째로 받아 두므로 조회가 필요 없다. 다른 탭에서는 한
   * 번 조회해 `rangeIds` 에 적어 둔 것을 본다.
   */
  const knownMonthIds = useCallback(
    (yearMonth: string): string[] | null => {
      const cached = rangeIds[monthKeyOf(yearMonth)];
      if (cached) return cached;
      const entries = monthData[yearMonth]?.entries;
      return entries ? entries.map((row) => row.id) : null;
    },
    [rangeIds, monthKeyOf, monthData],
  );

  /** 이미 알고 있는 그 줄의 거래 id. */
  const knownRowIds = useCallback(
    (yearMonth: string, key: string): string[] | null => {
      const cached = rangeIds[rowKeyOf(yearMonth, key)];
      if (cached) return cached;
      if (tab === 'date') {
        const grouped = groupEntriesByDate(monthData[yearMonth]?.entries ?? [], timeZone);
        const rows = grouped.get(key);
        return rows ? rows.map((row) => row.id) : null;
      }
      const rows = rowEntries[rowId(yearMonth, key)];
      return rows ? rows.map((row) => row.id) : null;
    },
    [rangeIds, rowKeyOf, tab, monthData, timeZone, rowEntries, rowId],
  );

  /**
   * 그 범위에 든 거래 id. 모르면 한 번 조회해 적어 둔다.
   *
   * 조회는 목록을 그릴 때와 **같은 조건**으로 한다. 다르면 화면에 보이지 않는 거래가
   * 함께 지워진다.
   */
  const idsOfRange = useCallback(
    async (
      yearMonth: string,
      row?: TransactionRow,
      /**
       * 누른 것이 아니라 미리 세어 두는 조회다.
       *
       * 회전 표시를 띄우지 않는다. 배경으로 세는 것까지 표시하면 고르기로 들어서는
       * 순간 체크박스 열 개가 한꺼번에 돌아 무엇을 눌렀는지 알 수 없다.
       */
      options?: { quiet?: boolean },
    ): Promise<string[]> => {
      const cacheKey = row ? rowKeyOf(yearMonth, row.key) : monthKeyOf(yearMonth);
      const known = row ? knownRowIds(yearMonth, row.key) : knownMonthIds(yearMonth);
      if (known) return known;
      if (!projectId) return [];

      const query = row
        ? { personIds: scope.personIds, ...monthRange(yearMonth), ...narrowOf(row), limit: 200 }
        : { ...scope, ...monthRange(yearMonth), limit: 200 };

      if (!options?.quiet) setRangePending((prev) => ({ ...prev, [cacheKey]: true }));
      try {
        const rows = await homeDataPort().getAllEntries(query, projectId);
        const ids = rows.map((item) => item.id);
        setRangeIds((prev) => ({ ...prev, [cacheKey]: ids }));
        return ids;
      } finally {
        if (!options?.quiet) setRangePending((prev) => ({ ...prev, [cacheKey]: false }));
      }
    },
    [rowKeyOf, monthKeyOf, knownRowIds, knownMonthIds, projectId, scope, narrowOf],
  );

  /**
   * 그 범위에서 골라진 거래의 수. 세어 보지 않았으면 null.
   *
   * `null`(모른다)과 `0`(하나도 아니다)을 가른다. 둘을 같게 두면 아직 세지 않은 줄이
   * "아무것도 안 골랐다"로 읽혀 물려받기가 틀린 답을 낸다.
   */
  const pickedOf = useCallback(
    (ids: string[] | null): { picked: number; total: number } | null => {
      if (!ids) return null;
      return { picked: ids.filter((id) => selected[id]).length, total: ids.length };
    },
    [selected],
  );

  const isEntrySelected = useCallback((id: string) => selected[id] === true, [selected]);

  /**
   * 년월 줄의 체크.
   *
   * **하나라도 빠지면 체크하지 않는다.** 반쯤 골라진 상태를 따로 그리지 않기로 했다 --
   * 지우는 화면에서 애매한 표시는 "이걸 누르면 무엇이 지워지는가"를 흐린다.
   */
  const monthChecked = useCallback(
    (yearMonth: string): boolean => {
      const counted = pickedOf(knownMonthIds(yearMonth));
      return counted !== null && counted.total > 0 && counted.picked === counted.total;
    },
    [pickedOf, knownMonthIds],
  );
  /**
   * 안쪽 줄의 체크. 년월 줄과 같은 규칙이다 -- 하나라도 빠지면 체크하지 않는다.
   *
   * 그 달이 전부 골라졌으면 줄도 전부다. 그 달의 거래가 모두 골라져 있으니 어느 줄에
   * 속하든 골라진 것이 맞다. 이 물려받기가 없으면 수단별·분류별에서 년월을 체크해도
   * 줄이 빈 칸으로 남는다 -- 그 탭이 받아 둔 것은 수단·분류 줄이라, 어느 거래가 어느
   * 줄에 속하는지는 세어 봐야 알기 때문이다.
   *
   * 반대쪽도 물려받는다. 그 달에서 골라진 것이 하나도 없으면 어느 줄도 골라져 있을 수
   * 없다. 세는 것이 아직 끝나지 않았어도 이 둘은 곧바로 답할 수 있다.
   */
  const rowChecked = useCallback(
    (yearMonth: string, key: string): boolean => {
      const month = pickedOf(knownMonthIds(yearMonth));
      if (month && month.total > 0) {
        if (month.picked === month.total) return true;
        if (month.picked === 0) return false;
      }
      const own = pickedOf(knownRowIds(yearMonth, key));
      return own !== null && own.total > 0 && own.picked === own.total;
    },
    [pickedOf, knownMonthIds, knownRowIds],
  );

  const toggleEntrySelected = useCallback((id: string) => {
    setSelected((prev) => {
      if (prev[id]) {
        const { [id]: _dropped, ...rest } = prev;
        return rest;
      }
      return { ...prev, [id]: true };
    });
  }, []);

  /** 범위를 한꺼번에 고르거나 푼다. 전부 골라져 있으면 푸는 것이 뜻에 맞는다. */
  const toggleRange = useCallback(
    async (yearMonth: string, row?: TransactionRow) => {
      const cacheKey = row ? rowKeyOf(yearMonth, row.key) : monthKeyOf(yearMonth);
      // 세는 중에 또 누르면 조회가 겹치고, 두 번째 것이 첫 번째를 되돌린다.
      if (rangePending[cacheKey]) return;

      try {
        const ids = await idsOfRange(yearMonth, row);
        if (ids.length === 0) return;

        setSelected((prev) => {
          const allPicked = ids.every((id) => prev[id]);
          const next = { ...prev };
          for (const id of ids) {
            if (allPicked) delete next[id];
            else next[id] = true;
          }
          return next;
        });
      } catch (error) {
        fail(error);
      }
    },
    [idsOfRange, rangePending, rowKeyOf, monthKeyOf, fail],
  );

  /*
   * ── 고르는 중에는 보이는 범위를 미리 세어 둔다 ──
   *
   * 체크 상태는 그 범위에 든 거래 id 를 알아야 정확하다. 날짜별은 그 달의 목록을 통째로
   * 받아 두어 세지 않아도 알지만, **수단별·분류별은 그렇지 않다** -- 받아 둔 것이 수단·
   * 분류 줄이라 어느 거래가 어느 줄에 속하는지는 물어봐야 안다.
   *
   * 달이 전부/하나도 골라지지 않은 상태는 물려받아 답할 수 있다(`rowChecked`). 그러나
   * **일부만 골라진 상태는 물려받을 수 없다.** 그때 줄마다 정확히 그리려면 세어 두는
   * 수밖에 없다. 그래서 고르는 중에만, 보이는 범위에 대해서만 미리 센다.
   *
   * 고르는 중이 아니면 한 건도 나가지 않는다. 훑어보는 사람에게는 필요 없는 조회다.
   */
  useEffect(() => {
    if (!isSelecting || !projectId) return;

    const needed: Array<{ yearMonth: string; row?: TransactionRow }> = [];
    for (const yearMonth of openMonths) {
      // 달 자신도 센다. 그러지 않으면 줄만 고른 뒤 년월 체크가 빈 칸으로 남는다.
      if (!knownMonthIds(yearMonth)) needed.push({ yearMonth });
      if (tab === 'date') continue;

      for (const row of rowsOf(yearMonth)) {
        if (knownRowIds(yearMonth, row.key)) continue;
        needed.push({ yearMonth, row });
      }
    }

    const fresh = needed.filter(({ yearMonth, row }) => {
      const flightId = `count|${row ? rowKeyOf(yearMonth, row.key) : monthKeyOf(yearMonth)}`;
      return !inFlightRef.current.has(flightId);
    });
    if (fresh.length === 0) return;

    const run = async ({ yearMonth, row }: { yearMonth: string; row?: TransactionRow }) => {
      const flightId = `count|${row ? rowKeyOf(yearMonth, row.key) : monthKeyOf(yearMonth)}`;
      inFlightRef.current.add(flightId);
      try {
        await idsOfRange(yearMonth, row, { quiet: true });
      } catch (error) {
        fail(error);
      } finally {
        // 어떤 경우에도 지운다. 남으면 그 범위를 다시 세지 못한다.
        inFlightRef.current.delete(flightId);
      }
    };

    void (async () => {
      // 나눠 보낸다. 한 달에 줄이 열 몇 개면 한꺼번에 던질 수가 없다.
      for (let index = 0; index < fresh.length; index += ROW_BATCH) {
        await Promise.all(fresh.slice(index, index + ROW_BATCH).map(run));
      }
    })();
  }, [
    isSelecting,
    projectId,
    tab,
    openMonthsKey,
    rowsOf,
    knownMonthIds,
    knownRowIds,
    rowKeyOf,
    monthKeyOf,
    idsOfRange,
    fail,
  ]);

  const startSelecting = useCallback(() => {
    setIsSelecting(true);
    setSelected({});
  }, []);
  const stopSelecting = useCallback(() => {
    setIsSelecting(false);
    setSelected({});
  }, []);

  /**
   * 고른 거래를 지운다.
   *
   * 창구를 거치므로 온라인이면 서버로, 오프라인이면 사본과 아웃박스로 간다. 하나가
   * 실패해도 나머지는 계속 지운다 -- 열 건을 고른 사람에게 첫 건에서 멈추는 것은
   * 도움이 되지 않고, 무엇이 남았는지는 숫자로 돌려준다.
   */
  const deleteSelected = useCallback(async (): Promise<{ deleted: number; failed: number }> => {
    const ids = Object.keys(selected);
    if (ids.length === 0) return { deleted: 0, failed: 0 };

    setIsDeleting(true);
    let deleted = 0;
    let failed = 0;
    try {
      const port = entryWritePort();
      for (let index = 0; index < ids.length; index += ROW_BATCH) {
        const batch = ids.slice(index, index + ROW_BATCH);
        const results = await Promise.allSettled(batch.map((id) => port.deleteEntry(id)));
        for (const result of results) {
          if (result.status === 'fulfilled') deleted += 1;
          else failed += 1;
        }
      }
    } finally {
      setIsDeleting(false);
      setIsSelecting(false);
      setSelected({});
      setRangeIds({});
      // 지운 뒤에는 받아 둔 것을 전부 버린다. 년월 합계까지 달라진다.
      setReloadToken((token) => token + 1);
    }

    return { deleted, failed };
  }, [selected]);

  /**
   * 년월 줄을 누른다. 접힘 -> 목록 -> 거래까지 -> 접힘 으로 돈다.
   *
   * 다른 달을 건드리지 않는다. 8월을 보다가 7월을 열어도 8월은 그대로 있어야 한다.
   */
  const cycleMonth = useCallback(
    (yearMonth: string) => {
      const next = ((levelOf(yearMonth) + 1) % 3) as MonthLevel;
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
    [levelOf, levelKey, tab],
  );

  /** 안쪽 줄을 누른다. */
  const toggleRow = useCallback(
    (yearMonth: string, key: string) => {
      const id = rowId(yearMonth, key);
      /*
       * 2단에서 한 줄을 누르면 그 달을 1단으로 내리고 누른 줄만 열어 둔다.
       *
       * 2단은 "전부 펼침"이라 한 줄만 접을 자리가 없다. 누른 사람의 뜻은 "이것만 보자"에
       * 가깝다.
       */
      if (levelOf(yearMonth) === 2) {
        setLevels((prev) => ({ ...prev, [levelKey(yearMonth)]: 1 }));
        setOpenRows((prev) => ({ ...prev, [id]: true }));
        return;
      }
      setOpenRows((prev) => ({ ...prev, [id]: !prev[id] }));
    },
    [levelOf, levelKey, rowId],
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
  const changeTab = useCallback((next: TransactionTab) => {
    setTab(next);
    setSelected({});
  }, []);

  const isLoadingMonth = useCallback(
    (yearMonth: string) => loadingMonths[yearMonth] === true,
    [loadingMonths],
  );
  const isLoadingRow = useCallback(
    (yearMonth: string, key: string) => loadingRows[rowId(yearMonth, key)] === true,
    [loadingRows, rowId],
  );

  return {
    // 1단
    months,
    isLoadingMonths,
    levelOf,
    cycleMonth,
    // 2단
    tab,
    changeTab,
    rowsOf,
    isLoadingMonth,
    // 3단
    isRowOpen,
    toggleRow,
    entriesOf,
    isLoadingRow,
    // 검색
    search,
    setSearch,
    searchCount,
    // 지울 것 고르기
    isSelecting,
    startSelecting,
    stopSelecting,
    selectedCount: Object.keys(selected).length,
    isEntrySelected,
    toggleEntrySelected,
    monthChecked,
    rowChecked,
    toggleRange,
    /** 그 범위의 거래를 세는 중인가. 체크박스가 눌린 것을 보여 주는 자리다. */
    isRangePending: useCallback(
      (yearMonth: string, key?: string) =>
        rangePending[key === undefined ? monthKeyOf(yearMonth) : rowKeyOf(yearMonth, key)] === true,
      [rangePending, monthKeyOf, rowKeyOf],
    ),
    deleteSelected,
    isDeleting,
    /** 이 프로젝트의 구성원. 제목(자산주인)과 `usePersonFilterSync` 가 쓴다. */
    people,
    pickerCategories,
    pickerAccounts,
    pickerCards,
    // 그 밖
    hasError,
    timeZone,
    share,
    hasProject: projects.length > 0,
    reload: useCallback(() => setReloadToken((token) => token + 1), []),
  };
}
