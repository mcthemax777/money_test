import type { EntryKind } from './entities';

/**
 * 거래 화면의 검색 조건을 읽는 규칙.
 *
 * 사용자가 고르는 것은 몇 무리다. 분류들, 자산들(계좌·카드), 유형들, 태그들. 규칙은
 * 한 줄로 적힌다.
 * **같은 무리 안에서는 OR, 무리끼리는 AND.** "식비 또는 교통비를, 신한카드 또는
 * 국민통장으로 쓴 것"이 검색이 묻는 것이다.
 *
 * 무리 안까지 AND 로 묶으면 둘을 고르는 순간 결과가 언제나 빈다. 무리끼리 OR 로 묶으면
 * 고를수록 결과가 늘어, 좁히는 도구가 넓히는 도구가 된다.
 *
 * 왜 여기인가. 조건을 만드는 일은 서버가 Prisma 로, 기기가 SQL 로 각자 한다. 그러나
 * **무엇을 고른 것으로 볼지**는 한 벌이어야 한다. 두 벌이면 같은 검색이 온라인과
 * 오프라인에서 다른 목록을 낸다. 고르는 문장은 저장소마다, 읽는 규칙은 여기 하나.
 */

/** 쉼표로 이어 온 값을 잘라 빈 항목을 버린다. */
export function splitIdList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export interface EntrySearchQuery {
  categoryIds?: string;
  paymentAccountIds?: string;
  paymentCardIds?: string;
  /**
   * 거래 유형 (쉼표로 잇는다, "expense,transfer").
   *
   * 이것도 한 무리다. 고른 유형끼리는 OR 이고, 분류·자산 무리와는 AND 다.
   */
  kinds?: string;
  /**
   * 태그 (쉼표로 잇는다).
   *
   * 이것도 한 무리다. 고른 태그끼리는 OR 이고 다른 무리와는 AND 다 -- "여행 또는
   * 경조사로 표시한 것 중에서 식비인 것". 무리 안을 AND 로 두면 태그 둘을 고르는 순간
   * "둘 다 붙은 거래"만 남아, 다른 무리와 규칙이 어긋난다.
   */
  tagIds?: string;
}

export interface ParsedEntrySearch {
  /** undefined 면 분류로 거르지 않는다 */
  categoryIds?: string[];
  paymentAccountIds?: string[];
  paymentCardIds?: string[];
  /**
   * 고른 유형. undefined 면 유형으로 거르지 않는다.
   *
   * **유형은 저장된 값이 아니라 다리에서 유도되는 값이다** (`classifyEntry`). 그래서
   * 조건도 다리를 보는 모양이 된다. 각 저장소가 그 조건을 만들고, 두 벌이 같은 답을
   * 내는지는 검사가 지킨다(`api/scripts/transactions-smoke.ts` 의 유형 대조).
   */
  kinds?: EntryKind[];
  /**
   * 고른 태그. undefined 면 태그로 거르지 않는다.
   *
   * **태그는 전표에 붙는다.** 그래서 조건도 다리가 아니라 전표를 보는 모양이 된다
   * (유형과 같은 자리다).
   */
  tagIds?: string[];
  /**
   * 무리 하나를 열어 놓고 아무것도 고르지 않았다. 어떤 결과도 나오지 않아야 한다.
   *
   * 체크를 모두 푼 상태를 "전체"로 되돌리면 사용자가 고른 것과 반대로 보인다. 이
   * 세 상태 구분(없음 / 값 / 빈 값)은 사람·과소비 필터가 이미 쓰는 규칙이다.
   */
  matchNothing: boolean;
}

/** 고른 것이 하나라도 있는가. 조건을 걸 필요가 있는지 판단한다. */
export function hasEntrySearch(search: ParsedEntrySearch): boolean {
  return (
    (search.categoryIds?.length ?? 0) > 0 ||
    (search.paymentAccountIds?.length ?? 0) > 0 ||
    (search.paymentCardIds?.length ?? 0) > 0 ||
    (search.kinds?.length ?? 0) > 0 ||
    (search.tagIds?.length ?? 0) > 0
  );
}

/** 화면이 고를 수 있는 유형. `조정`은 사람이 만드는 거래가 아니라 목록에 두지 않는다. */
export const SEARCHABLE_ENTRY_KINDS: readonly EntryKind[] = [
  'expense',
  'income',
  'transfer',
  'card_payment',
];

const ALL_KINDS: readonly EntryKind[] = [...SEARCHABLE_ENTRY_KINDS, 'adjustment'];

export function parseEntrySearch(query: EntrySearchQuery): ParsedEntrySearch {
  const idsOf = (value: string | undefined): string[] | undefined =>
    value === undefined ? undefined : splitIdList(value);

  const categoryIds = idsOf(query.categoryIds);
  const paymentAccountIds = idsOf(query.paymentAccountIds);
  const paymentCardIds = idsOf(query.paymentCardIds);
  const tagIds = idsOf(query.tagIds);
  // 아는 유형만 받는다. 오타를 조용히 무시하면 필터가 걸리지 않은 것처럼 보인다.
  const kinds =
    query.kinds === undefined
      ? undefined
      : (splitIdList(query.kinds).filter((kind) =>
          ALL_KINDS.includes(kind as EntryKind),
        ) as EntryKind[]);

  /*
   * 비어 있는지는 **무리 단위로** 본다.
   *
   * 분류는 무리가 하나라 그대로 보면 되지만, 계좌와 카드는 두 파라미터로 오는 한
   * 무리다. 카드만 고른 검색은 계좌 목록이 빈 채로 도착하는데, 그것은 "자산을 하나도
   * 고르지 않았다"가 아니라 "계좌 중에서는 고르지 않았다"일 뿐이다. 파라미터마다 따로
   * 보면 그런 검색이 언제나 빈 결과가 된다.
   */
  let matchNothing = false;
  if (categoryIds !== undefined && categoryIds.length === 0) matchNothing = true;

  const methodsGiven = paymentAccountIds !== undefined || paymentCardIds !== undefined;
  const methodCount = (paymentAccountIds?.length ?? 0) + (paymentCardIds?.length ?? 0);
  if (methodsGiven && methodCount === 0) matchNothing = true;

  if (kinds !== undefined && kinds.length === 0) matchNothing = true;
  if (tagIds !== undefined && tagIds.length === 0) matchNothing = true;

  /*
   * 다 고른 것은 고르지 않은 것과 같다.
   *
   * 조건을 걸지 않는 편이 정확하다. 유형 조건은 다리를 보는 모양이라, 전부 걸어 두면
   * 다섯 갈래를 OR 로 이어 붙인 큰 조건이 되고 그중 하나에도 걸리지 않는 전표(다리가
   * 없는 이상 자료)가 조용히 빠진다.
   */
  const everyKind = kinds !== undefined && ALL_KINDS.every((kind) => kinds.includes(kind));

  return {
    categoryIds,
    paymentAccountIds,
    paymentCardIds,
    kinds: everyKind ? undefined : kinds,
    tagIds,
    matchNothing,
  };
}

/**
 * 고른 것을 쿼리스트링 값으로 되돌린다. 화면이 창구에 넘길 때 쓴다.
 *
 * 고르지 않은 무리는 키를 아예 넣지 않는다. 빈 문자열을 넣으면 "아무것도 고르지 않음"이
 * 되어 결과가 비기 때문이다.
 */
export function toEntrySearchQuery(selection: {
  categoryIds?: readonly string[];
  paymentAccountIds?: readonly string[];
  paymentCardIds?: readonly string[];
  kinds?: readonly EntryKind[];
  tagIds?: readonly string[];
}): EntrySearchQuery {
  const query: EntrySearchQuery = {};
  if (selection.kinds?.length) query.kinds = selection.kinds.join(',');
  if (selection.categoryIds?.length) query.categoryIds = selection.categoryIds.join(',');
  if (selection.paymentAccountIds?.length) {
    query.paymentAccountIds = selection.paymentAccountIds.join(',');
  }
  if (selection.paymentCardIds?.length) query.paymentCardIds = selection.paymentCardIds.join(',');
  if (selection.tagIds?.length) query.tagIds = selection.tagIds.join(',');
  return query;
}
