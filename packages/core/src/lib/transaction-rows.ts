/**
 * 거래 화면의 줄 모양과 그것을 만드는 순수한 규칙.
 *
 * 년월 아래의 안쪽 줄(날짜·분류·수단)을 한 모양(`TransactionRow`)으로 맞추고, 줄을 눌렀을 때
 * 그 줄로 좁히는 조회 조건을 만든다. 상태가 없는 일이라 `useTransactions` 밖에 둔다 (2026-10-26).
 * 바깥에서는 `hooks/useTransactions` 로 가져다 쓴다.
 */
import type { CategoryDto, EntryBasis, EntryDto, EntryListItem, ReportDto } from '@money/types';
import { parseCategoryPick, toEntrySearchQuery } from '@money/types';

import type { HomeDataPort } from '../data/home-port';
import { sumEntries } from './entries';
import { formatDateKey, periodLabel, weekdayOf } from './datetime';
import type { TransactionSearch } from './transaction-search';

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

/**
 * 여러 건을 고르는 이유.
 *
 *   delete 골라서 지운다
 *   tag      골라서 태그를 붙인다
 *   category 골라서 분류를 바꾼다 (2026-10-09 사용자 요청). 태그처럼 줄 단위로 고른다.
 *
 * 고르는 절차는 같다. 머리글의 버튼과 끝에 하는 일만 다르다.
 */
export type SelectPurpose = 'delete' | 'tag' | 'category';

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
  /**
   * 날짜별에서만. 일자 옆에 적는 요일이다.
   *
   * 여기서 만들어 두는 것은 값이 바뀌지 않는 한 **같은 객체를 돌려주기 위해서**다.
   * 화면이 그릴 때마다 만들면 줄을 memo 로 감싼 뜻이 없어진다.
   */
  weekday?: { label: string; day: number };
  expense: number;
  income: number;
  /** 수단별에서만. 계좌인지 카드인지에 따라 조회 조건이 다르다. */
  methodKind?: ReportDto.PaymentMethodItem['kind'];
}

/** 한 달의 안쪽 값. 탭마다 따로 받아 두고 탭을 오갈 때 다시 받지 않는다. */
export interface MonthData {
  entries?: EntryListItem[];
  categories?: TransactionCategory[];
  methods?: ReportDto.PaymentMethodItem[];
}

/** 그 탭이 한 달의 안쪽 값 가운데 어느 칸을 쓰는가. */
export function monthFieldOf(tab: TransactionTab): keyof MonthData {
  return tab === 'date' ? 'entries' : tab === 'category' ? 'categories' : 'methods';
}

/**
 * 한 번에 보내는 거래 조회의 수.
 *
 * 2단으로 펼치면 줄마다 조회가 하나씩 나간다. 달 셋에 분류 열이면 서른이고, 한꺼번에
 * 보내면 받는 쪽에서 밀린다. 나눠 보내면 화면이 위에서부터 차례로 채워진다.
 */
export const ROW_BATCH = 6;

/** 거래 id 를 한 번씩만. 분할은 줄마다, 회차는 기간마다 같은 거래가 여러 번 설 수 있다. */
export const uniqueIds = (rows: readonly EntryListItem[]): string[] => [
  ...new Set(rows.map((row) => row.id)),
];

/**
 * 거래 단위 열쇠의 태그 -- **모든 줄이 함께 가진 태그**다. 줄이 없는 전표(이체·카드 대금)는 거래 자체의 태그다.
 *
 * 범위를 체크하면 그 거래의 모든 줄이 대상이 된다. 체크를 풀면 전부에서 떼므로, 한 줄만 가진 태그를 "전부가
 * 가졌다"로 보여 주면 나머지 줄에서 없는 것을 뗀 것으로 읽힌다.
 */
export function sharedTagIdsOf(row: EntryListItem): string[] {
  if (row.lines.length === 0) return row.tags.map((tag) => tag.id);
  let shared: string[] = row.lines[0].tags.map((tag) => tag.id);
  for (const line of row.lines.slice(1)) {
    const own = new Set(line.tags.map((tag) => tag.id));
    shared = shared.filter((id) => own.has(id));
  }
  return shared;
}

/**
 * 조건에 맞는 거래 전부와, 회차 기준이면 **이 구간에 회차가 서는 지난 할부**.
 *
 * 목록 질의는 전표의 날짜로 자르므로 지난달에 산 할부는 여기 오지 않는다. 따로 받아 합쳐
 * 두면 회차를 고르고 구간 밖을 버리는 일은 부르는 쪽(`viewsOf`)이 한다. 2단(날짜별 달)·3단
 * (분류별·수단별 줄)·범위 세기가 같은 규칙으로 받는다.
 */
export async function fetchEntriesWithInstallments(
  port: HomeDataPort,
  query: EntryDto.ListQuery,
  projectId: string,
  basis: EntryBasis,
): Promise<EntryListItem[]> {
  const [own, past] = await Promise.all([
    port.getAllEntries({ ...query, limit: 200 }, projectId),
    basis === 'installment'
      ? port.getInstallmentRows(query, projectId)
      : Promise.resolve([] as EntryListItem[]),
  ]);
  return past.length > 0 ? [...own, ...past] : own;
}

/**
 * 검색이 고른 분류에 드는 줄만 남긴다. 고르지 않았으면 null.
 *
 * 구성비는 **전표 수준**으로 걸러 온다. 그래서 생활비를 찾으면 생활비가 섞인 분할
 * 거래가 통째로 들고, 그 거래의 다른 분류(식비)까지 줄로 나온다. 합계로는 맞지만
 * 목록으로는 틀리다 -- 고르지 않은 분류가 목록에 있으면 검색이 듣지 않는 것처럼 보인다.
 *
 * 줄과 고른 것이 층이 다를 수 있어 **위아래 양쪽으로** 편다.
 *
 * 롤업이 켜져 있으면 줄은 대분류다. 고른 것이 소분류면 그 부모 줄을 남겨야 한다.
 * 거꾸로 줄이 소분류인데(롤업을 끈 자리) 고른 것이 대분류이면 그 자식 줄을 남겨야
 * 한다 -- 대분류를 고르면 소분류까지 걸리는 것이 검색의 규칙이라, 한쪽만 펴 두면
 * 걸려 온 거래가 줄에서만 사라진다.
 */
export function categoryRowsToKeep(
  selected: readonly string[],
  categories: readonly CategoryDto.Response[],
): Set<string> | null {
  if (selected.length === 0) return null;

  /*
   * 미분류로 고른 것은 그 대분류 줄만 남긴다. 그 아래 소분류는 걸리지 않는다.
   * 펴서 고른 것(`spread`)만 위아래로 넓힌다.
   */
  const spread = new Set<string>();
  const keep = new Set<string>();
  for (const value of selected) {
    const { id, self } = parseCategoryPick(value);
    keep.add(id);
    if (!self) spread.add(id);
  }

  for (const row of categories) {
    if (!row.parentId) continue;
    // 고른 것이 소분류면 그 부모 줄을 남긴다 (줄이 대분류로 롤업되어 있다).
    if (spread.has(row.id)) keep.add(row.parentId);
    // 대분류를 폈으면 그 소분류 줄도 남긴다.
    if (spread.has(row.parentId)) keep.add(row.id);
  }
  return keep;
}

/**
 * 받아 둔 달 하나의 안쪽 줄. 탭에 따라 무엇을 세는지가 다르다.
 *
 * 세 탭을 한 모양(`TransactionRow`)으로 맞춰 준다. 화면이 탭마다 갈라 그리면 같은
 * 줄을 세 번 적게 된다.
 */
export function buildMonthRows(input: {
  tab: TransactionTab;
  data: MonthData | undefined;
  /** 날짜별에서만. 그 달을 날짜(해로 묶으면 달)로 묶어 둔 것. */
  grouped: Map<string, EntryListItem[]>;
  innerBucket: 'day' | 'month';
  keepCategoryIds: Set<string> | null;
  keepMethodIds: Set<string> | null;
  /** 미지정 칸의 이름. 이름이 비어 오므로 사전으로 붙인다. */
  unassignedLabel: () => string;
}): TransactionRow[] {
  const { tab, data, grouped, innerBucket, keepCategoryIds, keepMethodIds } = input;

  if (tab === 'date') {
    return [...grouped.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([dateKey, rows]) => {
        const totals = sumEntries(rows);
        /*
         * 날짜는 해까지 적는다. "19" 하나만 두면 그 줄이 어느 달의 며칟날인지
         * 줄 자신이 말하지 못한다 -- 위의 기간 줄을 눈으로 되짚어야 하고, 분류별·
         * 수단별에서 넘어오면 그 기간 줄도 화면 밖일 수 있다.
         *
         * 해로 묶어 볼 때는 안쪽이 달이라 요일이 없다.
         */
        return {
          key: dateKey,
          label: innerBucket === 'month' ? periodLabel(dateKey) : formatDateKey(dateKey),
          ...(innerBucket === 'day' ? { weekday: weekdayOf(dateKey) } : {}),
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
   * 그것을 쓴다). 여기서는 펴도 아무것도 나오지 않는 줄이라 숨긴다(`hasEntries`).
   * 값이 없으면 그 칸을 모르는 옛 서버의 답이라 그대로 둔다.
   *
   * 검색을 켠 화면에서는 고르지 않은 카드가 0원 줄로 남으면 안 된다.
   */
  return (data?.methods ?? [])
    .filter((row) => row.hasEntries !== false)
    .filter((row) => !keepMethodIds || keepMethodIds.has(row.id))
    .map((row) => ({
      key: row.id,
      // 미지정 칸은 이름이 비어 온다. 사전으로 붙인다.
      label: row.unassigned ? input.unassignedLabel() : row.name,
      sub: row.ownerName ?? undefined,
      expense: Number(row.amount),
      income: Number(row.income),
      methodKind: row.kind,
    }));
}

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
export function narrowQueryOf(
  row: TransactionRow,
  tab: TransactionTab,
  search: TransactionSearch,
  categories: readonly CategoryDto.Response[],
) {
  // 기간과 세는 기준은 넣지 않는다. 기간은 부르는 쪽이 그 줄의 기간으로 따로 싣는다.
  const base = {
    text: search.text,
    categoryIds: search.categoryIds,
    paymentAccountIds: search.paymentAccountIds,
    paymentCardIds: search.paymentCardIds,
    kinds: search.kinds,
    tagIds: search.tagIds,
    entryPersonIds: search.entryPersonIds,
    features: search.features,
  };

  if (tab === 'category') {
    const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));
    /*
     * 줄은 롤업된 대분류다. 고른 소분류가 있으면 그것만 남긴다.
     *
     * 미분류로 고른 것도 그대로 이어받는다 -- 줄에 적힌 금액이 이미 그 조건으로
     * 걸러 온 값이라, 여기서 펴 버리면 줄의 합계와 펼친 목록의 합이 어긋난다.
     */
    const chosen = search.categoryIds.filter((value) => {
      const { id } = parseCategoryPick(value);
      return id === row.key || parentOf.get(id) === row.key;
    });
    return toEntrySearchQuery({ ...base, categoryIds: chosen.length > 0 ? chosen : [row.key] });
  }

  return toEntrySearchQuery({
    ...base,
    paymentAccountIds: row.methodKind === 'account' ? [row.key] : [],
    paymentCardIds: row.methodKind === 'account' ? [] : [row.key],
  });
}
