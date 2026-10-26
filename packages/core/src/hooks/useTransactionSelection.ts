/**
 * 거래 화면에서 여러 건을 고르는 일 -- 지우기·태그 붙이기·분류 바꾸기.
 *
 * 고르는 절차(줄·범위 체크, 부분 선택, 범위 미리 세기)는 같고 끝에 하는 일만 다르다. 무엇을
 * 받아 두었는지는 `useTransactions` 가 알고, 이 훅은 그 값을 받아 고른 것을 들고 있는다.
 * `useTransactions` 에서 떼어 냈다 (2026-10-26). 그 훅의 반환 모양은 그대로다.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { EntryBasis, EntryListItem, EntryScopeQuery, ReportDto } from '@money/types';
import { parseSelectionKey, selectionKey } from '@money/types';

import { entryWritePort } from '../data/entry-write-port';
import { homeDataPort } from '../data/home-port';
import { listRangeOf as listRangeQueryOf } from '../lib/transaction-periods';
import {
  ROW_BATCH,
  narrowQueryOf,
  fetchEntriesWithInstallments,
  sharedTagIdsOf,
  uniqueIds,
  type MonthData,
  type SelectPurpose,
  type TransactionRow,
  type TransactionTab,
} from '../lib/transaction-rows';

/** `useTransactions` 가 받아 둔 것과 조회 규칙. 이 훅은 읽기만 한다. */
export interface TransactionSelectionSource {
  projectId: string | null;
  /** 조건의 열쇠. 바뀌면 고른 것을 버린다. */
  scopeKey: string;
  /** 지금 조건. 도착한 값이 아직 쓸 것인지 판단한다. */
  scopeKeyRef: MutableRefObject<string>;
  /** 나가 있는 조회. 달·줄 받기와 같은 자리를 쓴다. */
  inFlightRef: MutableRefObject<Set<string>>;
  tab: TransactionTab;
  basis: EntryBasis;
  months: ReportDto.EntryMonth[];
  openMonths: string[];
  openMonthsKey: string;
  monthData: Record<string, MonthData>;
  rowEntries: Record<string, EntryListItem[]>;
  groupedByMonth: Map<string, Map<string, EntryListItem[]>>;
  rowEntryViews: Record<string, EntryListItem[]>;
  scope: EntryScopeQuery;
  rowId: (yearMonth: string, key: string) => string;
  rowsOf: (yearMonth: string) => TransactionRow[];
  viewsOf: (yearMonth: string, entries: EntryListItem[]) => EntryListItem[];
  narrowOf: (row: TransactionRow) => ReturnType<typeof narrowQueryOf>;
  listRangeOf: (yearMonth: string) => ReturnType<typeof listRangeQueryOf>;
  fail: (error: unknown) => void;
  /** 받아 둔 것을 전부 버리는 신호를 올린다. */
  setReloadToken: Dispatch<SetStateAction<number>>;
}

export function useTransactionSelection({
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
}: TransactionSelectionSource) {
  /**
   * 고르는 중이라면 무엇을 하려고 고르는가.
   *
   * 이 화면은 훑어보는 자리라 평소에는 누르면 상세가 뜬다. 고르는 중에는 같은 누름이
   * 체크가 되어야 하므로, 두 뜻을 한 상태로 갈라 둔다.
   *
   * 고르는 절차는 같고 끝에 하는 일만 다르다(지우기 / 태그 붙이기). 두 모드를 따로
   * 만들면 체크·범위·부분선택 규칙을 두 벌 갖게 되므로, 목적만 값으로 들고 있는다.
   * null 이면 고르는 중이 아니다.
   */
  const [selectPurpose, setSelectPurpose] = useState<SelectPurpose | null>(null);
  const isSelecting = selectPurpose !== null;
  /**
   * 골라 둔 줄. 열쇠는 `selectionKey` 가 만든다.
   *
   * 태그가 줄에 붙으므로 고르는 단위도 줄이다. 다만 접힌 달을 통째로 체크할 때는 그
   * 거래들이 화면에 없어 줄 키를 알 수 없고, 그때는 "그 거래의 모든 줄"을 뜻하는
   * 거래 단위 열쇠가 들어간다 (`selectionKey(id)`).
   */
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
   * 범위 조회에서 알게 된 거래별 태그. 열쇠는 거래 id 다.
   *
   * 목록에 그려진 거래는 `monthData`·`rowEntries` 에서 태그를 읽을 수 있지만, 접힌 달을
   * 통째로 체크하면 그 거래들은 화면에 없다. 그때 나가는 조회가 이미 온전한 줄을 받아
   * 오므로(`getAllEntries`) 태그만 여기 적어 둔다 -- 그러지 않으면 "고른 것 전부가 가진
   * 태그"를 셀 수 없다.
   */
  const [rangeTags, setRangeTags] = useState<Record<string, string[]>>({});
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
  const [isTagging, setIsTagging] = useState(false);
  const [isRecategorizing, setIsRecategorizing] = useState(false);

  /*
   * 조건이 바뀌면 고른 것을 버린다.
   *
   * 목록에 보이지 않는 거래가 골라진 채로 남으면, 삭제 버튼의 숫자가 화면에 없는
   * 것을 세게 된다. 지우는 일에서 그런 어긋남은 그냥 두면 안 된다. 세던 표시도 지운다 --
   * 그 조회는 옛 조건의 것이라 끝나도 버려진다.
   */
  useEffect(() => {
    setRangePending({});
    setSelected({});
    setRangeIds({});
    setRangeTags({});
  }, [scopeKey, projectId]);

  /** 고르기를 마친다. 지우기·태그·분류 바꾸기가 끝난 뒤 함께 부른다 (setter 만 쓴다). */
  const finishSelecting = () => {
    setSelectPurpose(null);
    setSelected({});
    setRangeIds({});
    setRangeTags({});
  };

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
      /*
       * 받아 둔 그 달의 목록이 있으면 그것이 먼저다. 화면에 선 줄과 같은 것이고(회차 기준이면
       * 회차로 옮긴 것), 세어 둔 값은 그 목록이 오기 전의 것일 수 있다.
       */
      const entries = monthData[yearMonth]?.entries;
      if (entries) return uniqueIds(viewsOf(yearMonth, entries));
      return rangeIds[monthKeyOf(yearMonth)] ?? null;
    },
    [rangeIds, monthKeyOf, monthData, viewsOf],
  );

  /** 이미 알고 있는 그 줄의 거래 id. */
  const knownRowIds = useCallback(
    (yearMonth: string, key: string): string[] | null => {
      // 받아 둔 줄의 거래가 먼저다. 그 달 목록과 같은 까닭이다 (`knownMonthIds`).
      if (tab === 'date') {
        const rows = groupedByMonth.get(yearMonth)?.get(key);
        if (rows) return uniqueIds(rows);
      } else {
        // 회차 기준이면 회차로 옮긴 줄이다. 화면에 선 거래와 같은 것을 센다.
        const rows = rowEntryViews[rowId(yearMonth, key)];
        if (rows) return uniqueIds(rows);
      }
      return rangeIds[rowKeyOf(yearMonth, key)] ?? null;
    },
    [rangeIds, rowKeyOf, tab, groupedByMonth, rowEntryViews, rowId],
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
        ? { personIds: scope.personIds, ...listRangeOf(yearMonth), ...narrowOf(row) }
        : { ...scope, ...listRangeOf(yearMonth) };

      if (!options?.quiet) setRangePending((prev) => ({ ...prev, [cacheKey]: true }));
      /*
       * 묻는 사이 검색 조건이 바뀌면 이 답은 옛 범위의 것이다 (2026-10-16). 적어 두면 바뀐 조건의 같은
       * 칸(`m|년월`)에 옛 id 가 남아, 년월 체크가 보이지 않는 거래를 고르고 그대로 지울 수 있었다.
       */
      const askedScope = scopeKeyRef.current;
      try {
        /*
         * 목록을 그릴 때와 같은 거래를 센다. 회차 기준이면 **지난달에 산 할부의 회차**도 이
         * 범위의 줄이다 -- 목록 질의는 전표 날짜로 잘라 그 거래가 오지 않으므로 따로 받고,
         * 구간 밖 회차는 `viewsOf` 가 버린다. 빼고 세면 회차만 있는 달(12월)이 "0건"으로
         * 적혀 년월 체크가 아무것도 고르지 못한다 (2026-10-08 실기기에서 겪었다).
         */
        const fetched = await fetchEntriesWithInstallments(homeDataPort(), query, projectId, basis);
        if (scopeKeyRef.current !== askedScope) return [];
        const rows = viewsOf(yearMonth, fetched);
        const ids = uniqueIds(rows);
        setRangeIds((prev) => ({ ...prev, [cacheKey]: ids }));
        // 태그도 함께 적어 둔다. 이 줄들은 화면에 없을 수 있다.
        setRangeTags((prev) => {
          const next = { ...prev };
          // 목록과 같은 규칙으로 적는다(`sharedTagIdsOf`). 지출·수입의 태그는 줄에 있어 row.tags 는 비어
          // 있다 -- 그것을 적으면 함께 가진 태그가 "일부만"으로 보였다 (2026-10-16).
          for (const row of rows) next[row.id] = sharedTagIdsOf(row);
          return next;
        });
        return ids;
      } finally {
        if (!options?.quiet) setRangePending((prev) => ({ ...prev, [cacheKey]: false }));
      }
    },
    [
      rowKeyOf,
      monthKeyOf,
      knownRowIds,
      knownMonthIds,
      projectId,
      scope,
      narrowOf,
      listRangeOf,
      basis,
      viewsOf,
    ],
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

  /**
   * 이 줄이 골라져 있는가.
   *
   * 그 줄을 따로 골랐거나, 그 거래가 통째로 골라졌으면 참이다. 범위 체크는 거래 단위로
   * 들어오므로 둘을 함께 봐야 한다.
   */
  const isEntrySelected = useCallback(
    (id: string, lineKey?: string | null) =>
      selected[id] === true || (lineKey !== undefined && selected[selectionKey(id, lineKey)] === true),
    [selected],
  );

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

  /**
   * 줄 하나를 고르거나 푼다.
   *
   * 줄 키를 주지 않으면 그 거래 전부다 (분류 줄이 없는 이체·카드 대금 결제의 자리).
   *
   * 거래가 통째로 골라져 있는데 그 안의 한 줄을 풀면, 거래 단위 열쇠를 줄 단위 열쇠들로
   * 편 뒤 그 하나만 뺀다. 그러지 않으면 누른 줄이 풀리지 않는다.
   */
  const toggleEntrySelected = useCallback(
    (id: string, requestedLineKey?: string | null, siblingKeys?: readonly string[]) => {
      /*
       * 지울 것을 고를 때는 분할의 줄 하나도 그 거래 전부다 (2026-10-08 사용자 결정). 줄
       * 하나만 지우는 길은 없다 -- 줄만 체크해 두면 "그 줄만 지워진다"로 읽히는데 실제로는
       * 거래가 통째로 지워진다. 거래 열쇠로 고르면 그 거래의 모든 줄이 함께 켜진다.
       */
      const lineKey = selectPurpose === 'delete' ? undefined : requestedLineKey;
      const key = selectionKey(id, lineKey);
      setSelected((prev) => {
        if (prev[key]) {
          const { [key]: _dropped, ...rest } = prev;
          return rest;
        }
        if (prev[id] && lineKey !== undefined) {
          const { [id]: _whole, ...rest } = prev;
          for (const sibling of siblingKeys ?? []) {
            if (sibling === lineKey) continue;
            rest[selectionKey(id, sibling)] = true;
          }
          return rest;
        }
        return { ...prev, [key]: true };
      });
    },
    [selectPurpose],
  );

  /** 받아 둔 거래의 모양. 할부·분할인지, 어느 원거래에 걸린 환불·페이백인지. */
  const knownShapes = useMemo(() => {
    const shapeOf = new Map<
      string,
      { installment: boolean; split: boolean; paybackOf: string | null }
    >();
    const put = (rows: readonly EntryListItem[]) => {
      for (const row of rows) {
        shapeOf.set(row.id, {
          installment: (row.installmentMonths ?? 1) > 1,
          split: row.lines.length > 1,
          paybackOf: row.paybackOfEntryId ?? null,
        });
      }
    };
    for (const data of Object.values(monthData)) if (data?.entries) put(data.entries);
    for (const rows of Object.values(rowEntries)) put(rows);
    return shapeOf;
  }, [monthData, rowEntries]);

  /**
   * 고른 것 가운데 할부·분할 거래의 수. 확인 창이 "모든 회차·모든 줄에 함께"를 알린다
   * (2026-10-08 사용자 결정) -- 회차 하나를 눌러도 원거래 전체가, 분할 줄 하나를 지워도
   * 거래 전체가 대상이라 그 까닭이 보여야 한다. 받아 둔 목록에 없는 거래는 세지 않는다.
   */
  const selectedShapes = useMemo(() => {
    const ids = new Set(Object.keys(selected).map((key) => parseSelectionKey(key).entryId));
    let installment = 0;
    let split = 0;
    for (const id of ids) {
      const shape = knownShapes.get(id);
      if (shape?.installment) installment += 1;
      if (shape?.split) split += 1;
    }
    /*
     * 원거래를 지우면 걸린 환불·페이백도 함께 지워진다 (PAYBACK_DESIGN 7-6). 고르지 않았는데
     * 함께 사라지는 것을 센다. 받아 둔 목록에 선 것만 알 수 있다 -- 다른 달에 들어온 환불은
     * 그 달을 펴 보기 전에는 모른다.
     */
    let paybacks = 0;
    for (const [id, shape] of knownShapes) {
      if (shape.paybackOf && ids.has(shape.paybackOf) && !ids.has(id)) paybacks += 1;
    }
    return { installment, split, paybacks };
  }, [knownShapes, selected]);

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
          const picked = new Set(ids);
          const next: typeof prev = {};
          /*
           * 그 거래의 줄 열쇠는 거래 열쇠 하나로 갈음한다 (2026-10-16). 줄 열쇠를 남기면 고른 수가 부풀고, 달 체크를
           * 풀어도 앞서 고른 줄은 골라진 채 남았다. 넣을 때도 뺄 때도 그 거래의 줄 열쇠는 걷어 낸다.
           */
          for (const key of Object.keys(prev)) {
            const { entryId, lineKey } = parseSelectionKey(key);
            if (lineKey !== undefined && picked.has(entryId)) continue;
            next[key] = true;
          }
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

    /*
     * 회차 기준이면 **접힌 달도** 센다(보이는 달 다음에). 한 할부가 여러 달에 회차로 서서,
     * 12월을 고르면 같은 할부만 든 11월도 다 골라진 것이다. 접힌 달은 받은 목록도 세어 둔
     * 값도 없어 체크가 빈 칸으로 남았다 -- 그 달을 한 번 눌러 세어 둔 뒤에야 함께 움직였다
     * (2026-10-09 실기기). 발생 기준은 한 거래가 한 달에만 서므로 접힌 달을 세지 않는다.
     */
    if (basis === 'installment') {
      for (const { yearMonth } of months) {
        if (!openMonths.includes(yearMonth) && !knownMonthIds(yearMonth)) {
          needed.push({ yearMonth });
        }
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
    basis,
    months,
    openMonthsKey,
    rowsOf,
    knownMonthIds,
    knownRowIds,
    rowKeyOf,
    monthKeyOf,
    idsOfRange,
    fail,
  ]);

  /**
   * 줄을 길게 눌러 삭제할 거래 고르기로 들어선다. 누른 것을 골라 둔 채로 연다 (2026-10-09 사용자
   * 요청). 년월·안쪽 줄은 그 범위 전부를, 거래 한 줄은 그 거래를 통째로 고른다 -- 지우는 것은
   * 전표 단위다 (`toggleEntrySelected` 의 삭제 규칙과 같다).
   *
   * 이미 고르는 중이면 아무 일도 하지 않는다. 그때의 길게 누름은 무엇을 뜻하는지 정해지지 않았다.
   */
  const startDeleteWith = useCallback(
    (target: { yearMonth: string; row?: TransactionRow } | { entryId: string }) => {
      if (selectPurpose !== null) return;
      setSelectPurpose('delete');
      if ('entryId' in target) {
        setSelected({ [target.entryId]: true });
        return;
      }
      // 범위는 세어 봐야 무엇이 드는지 안다. 비운 다음 범위 체크와 같은 길로 고른다.
      setSelected({});
      void toggleRange(target.yearMonth, target.row);
    },
    [selectPurpose, toggleRange],
  );

  const startSelecting = useCallback((purpose: SelectPurpose = 'delete') => {
    setSelectPurpose(purpose);
    setSelected({});
  }, []);
  const stopSelecting = useCallback(() => {
    setSelectPurpose(null);
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
    // 지우는 것은 거래다. 줄 하나만 지울 수는 없다 -- 그것은 분할을 고치는 일이다.
    const picked = new Set(Object.keys(selected).map((key) => parseSelectionKey(key).entryId));
    /*
     * 원거래가 함께 골라진 환불·페이백은 보내지 않는다. 원거래를 지우면 함께 지워지므로
     * (PAYBACK_DESIGN 7-6) 따로 보내면 늦게 닿은 쪽이 "없는 거래"로 실패해 지우지 못했다고
     * 잘못 알린다 (2026-10-08 확인, api payback-smoke 15절).
     */
    const ids = [...picked].filter((id) => {
      const paybackOf = knownShapes.get(id)?.paybackOf;
      return !(paybackOf && picked.has(paybackOf));
    });
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
      finishSelecting();
      // 지운 뒤에는 받아 둔 것을 전부 버린다. 년월 합계까지 달라진다.
      setReloadToken((token) => token + 1);
    }

    return { deleted, failed };
  }, [selected, knownShapes]);

  /**
   * 한 건을 지운다. 상세에서 지우기를 눌렀을 때.
   *
   * 고른 것 지우기(`deleteSelected`)와 같은 창구를 쓴다 -- 온라인이면 서버로,
   * 오프라인이면 사본과 아웃박스로 간다. 다른 점은 고르는 상태를 건드리지 않는
   * 것뿐이다. 상세에서 지우는 것은 고르기를 거치지 않은 길이라, 거기서 체크를
   * 비우면 고르던 중이던 사람의 손이 지워진다.
   *
   * 지운 뒤에는 받아 둔 것을 전부 버린다. 년월 합계까지 달라진다.
   */
  const deleteEntry = useCallback(async (id: string): Promise<boolean> => {
    setIsDeleting(true);
    try {
      await entryWritePort().deleteEntry(id);
      return true;
    } catch {
      return false;
    } finally {
      setIsDeleting(false);
      setReloadToken((token) => token + 1);
    }
  }, []);

  /**
   * 아는 거래별 태그. 열쇠는 거래 id 다.
   *
   * 세 곳에서 모은다. 그 달의 목록(날짜별 탭), 줄의 거래(분류별·수단별 탭), 그리고 접힌
   * 범위를 체크할 때 나간 조회(`rangeTags`). 고를 수 있는 길이 그 셋뿐이므로 여기 없는
   * 거래는 고를 수도 없다 -- 다만 화면이 그 사이에 목록을 버릴 수 있어(검색을 바꾸면)
   * 아래에서 "하나라도 모르면 모른다"로 다룬다.
   */
  const tagsById = useMemo(() => {
    const map = new Map<string, string[]>();
    const put = (rows: EntryListItem[]) => {
      for (const row of rows) {
        // 거래 단위 열쇠에는 모든 줄이 함께 가진 태그를 (`sharedTagIdsOf`), 줄 열쇠에는 그 줄의 태그를.
        map.set(row.id, sharedTagIdsOf(row));
        if (row.lines.length > 0) {
          for (const line of row.lines) {
            map.set(selectionKey(row.id, line.lineKey), line.tags.map((tag) => tag.id));
          }
        }
      }
    };

    for (const data of Object.values(monthData)) {
      if (data?.entries) put(data.entries);
    }
    for (const rows of Object.values(rowEntries)) put(rows);
    for (const [id, ids] of Object.entries(rangeTags)) map.set(id, ids);

    return map;
  }, [monthData, rowEntries, rangeTags]);

  /**
   * 고른 거래의 태그를 세 갈래로 나눈다.
   *
   *   common  전부가 가졌다. 창이 체크된 채로 연다. 체크를 풀면 전부에서 뗀다.
   *   partial 일부만 가졌다. 체크되지 않은 채로 열되 "일부"라고 표시한다.
   *   (나머지) 아무도 가지지 않았다.
   *
   * **일부만 가진 것을 체크로 보이면 안 된다.** "이미 다 붙어 있다"로 읽히는데 그렇지
   * 않다. 그렇다고 아무 표시 없이 두는 것도 곤란하다 -- 체크를 풀어 두면 떼는 것으로
   * 읽히는데, 이 창은 처음부터 꺼져 있던 것을 떼지 않는다. 그래서 갈래를 셋으로 둔다.
   *
   * **하나라도 태그를 모르면 둘 다 빈 값이다.** 모르는 것을 "없다"로 세면 이미 붙어
   * 있는 태그가 꺼진 채로 보이는데, 그 상태에서 확인을 누르면 아무 일도 일어나지
   * 않는다(꺼진 채로 둔 것은 건드리지 않는다). 그 반대(붙어 있지 않은 것을 붙어 있다고
   * 보여 주는 것)는 체크를 풀었을 때 없는 것을 뗀 것으로 읽혀 훨씬 나쁘다.
   */
  const tagSpread = useMemo(() => {
    const ids = Object.keys(selected);
    if (ids.length === 0) return { common: [] as string[], partial: [] as string[] };

    const seen = new Map<string, number>();
    for (const id of ids) {
      const tagIds = tagsById.get(id);
      // 하나라도 모르면 아무것도 말하지 않는다.
      if (!tagIds) return { common: [] as string[], partial: [] as string[] };

      for (const tagId of tagIds) seen.set(tagId, (seen.get(tagId) ?? 0) + 1);
    }

    const common: string[] = [];
    const partial: string[] = [];
    for (const [tagId, count] of seen) {
      if (count === ids.length) common.push(tagId);
      else partial.push(tagId);
    }
    return { common, partial };
  }, [selected, tagsById]);

  const commonTagIds = tagSpread.common;
  const partialTagIds = tagSpread.partial;

  /**
   * 고른 거래의 태그를 바꾼다. 더할 것과 뗄 것을 따로 받는다.
   *
   * 창구(`entryWritePort`)를 거친다. 명령의 모양은 수정과 다르다 -- 전표를 고치는 것이
   * 아니라 연결만 넣고 빼는 일이라, `entry.replace` 로 표현하면 분할 거래가 뭉개진다.
   * 그래서 `entry.tags` 라는 갈래가 따로 있고, **오프라인에서도 된다.**
   */
  const tagSelected = useCallback(
    async (
      addTagIds: string[],
      removeTagIds: string[] = [],
    ): Promise<{ tagged: number; failed: boolean; skipped: number }> => {
      const targets = Object.keys(selected).map(parseSelectionKey);
      if (targets.length === 0 || (addTagIds.length === 0 && removeTagIds.length === 0)) {
        return { tagged: 0, failed: false, skipped: 0 };
      }

      setIsTagging(true);
      try {
        const result = await entryWritePort().changeEntryTags({
          targets,
          addTagIds,
          removeTagIds,
          projectId,
        });
        /*
         * 적용하지 못한 줄. 다른 기기가 그 사이 분할을 고쳐 없어진 자리다.
         *
         * 화면이 이 수로 한 번 알린다. 조용히 넘기면 사용자는 표시가 된 줄 알고, 다음
         * 동기화가 태그 없는 모습으로 덮을 때에야 알게 된다.
         */
        return { tagged: result.entries, failed: false, skipped: result.skipped.length };
      } catch (error) {
        fail(error);
        return { tagged: 0, failed: true, skipped: 0 };
      } finally {
        setIsTagging(false);
        finishSelecting();
        /*
         * 받아 둔 것을 버린다. 목록 한 줄에 태그가 실려 있어(EntryListItem.tags) 그
         * 줄을 다시 받아야 새 칩이 보인다.
         *
         * 사본은 사본 창구가 이미 고쳐 두었고(오프라인에서도 곧바로 보인다), 서버가
         * 재생하면서 전표의 변경 번호를 올리므로 다음 델타가 같은 값을 덮어쓴다.
         */
        setReloadToken((token) => token + 1);
      }
    },
    [selected, projectId, fail],
  );

  /**
   * 고른 줄의 분류를 한 분류로 바꾼다. 태그 바꾸기와 같은 길이다 -- 창구를 거쳐 사본에 먼저 적고
   * `entry.category` 명령을 쌓으므로 오프라인에서도 된다.
   *
   * 같은 유형(지출·수입)의 줄만 바뀐다. `excluded` 는 유형이 달라서, 또는 분류 줄이 없는 거래라서
   * 건드리지 않은 수다. 화면이 한 번 알린다.
   */
  const recategorizeSelected = useCallback(
    async (
      categoryId: string,
    ): Promise<{ changed: number; failed: boolean; skipped: number; excluded: number }> => {
      const targets = Object.keys(selected).map(parseSelectionKey);
      if (targets.length === 0 || !categoryId) {
        return { changed: 0, failed: false, skipped: 0, excluded: 0 };
      }

      setIsRecategorizing(true);
      try {
        const result = await entryWritePort().changeEntryCategory({
          targets,
          categoryId,
          projectId,
        });
        return {
          changed: result.entries,
          failed: false,
          skipped: result.skipped.length,
          excluded: result.excluded,
        };
      } catch (error) {
        fail(error);
        return { changed: 0, failed: true, skipped: 0, excluded: 0 };
      } finally {
        setIsRecategorizing(false);
        finishSelecting();
        // 목록 한 줄에 분류가 실려 있어 그 줄을 다시 받아야 새 분류가 보인다 (태그와 같다).
        setReloadToken((token) => token + 1);
      }
    },
    [selected, projectId, fail],
  );

  /** 그 범위의 거래를 세는 중인가. 체크박스가 눌린 것을 보여 주는 자리다. */
  const isRangePending = useCallback(
    (yearMonth: string, key?: string) =>
      rangePending[key === undefined ? monthKeyOf(yearMonth) : rowKeyOf(yearMonth, key)] === true,
    [rangePending, monthKeyOf, rowKeyOf],
  );

  return {
    /** 탭·단위를 옮길 때 고른 것을 비운다. */
    setSelected,
    isSelecting,
    startSelecting,
    stopSelecting,
    selectedCount: Object.keys(selected).length,
    selectedShapes,
    isEntrySelected,
    toggleEntrySelected,
    monthChecked,
    rowChecked,
    toggleRange,
    isRangePending,
    deleteSelected,
    deleteEntry,
    isDeleting,
    selectPurpose,
    startDeleteWith,
    tagSelected,
    isTagging,
    recategorizeSelected,
    isRecategorizing,
    commonTagIds,
    partialTagIds,
  };
}
