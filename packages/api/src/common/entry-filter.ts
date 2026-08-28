import { Prisma } from '@prisma/client';
import { EntryFilterQuery } from '@money/types';

/**
 * 화면의 사람/고정 필터를 Prisma 조건으로 옮긴다.
 *
 * 목록과 합계·차트가 같은 조건을 써야 화면 안에서 숫자가 어긋나지 않으므로,
 * 조건을 만드는 곳을 여기 하나로 둔다.
 *
 * 세 상태를 구분한다는 점이 핵심이다.
 *   - 키가 없음  = 전체 (필터를 걸지 않는다)
 *   - 값이 있음  = 그 값만
 *   - 빈 문자열  = 아무것도 고르지 않음 → 결과가 없어야 한다
 * 체크박스를 모두 해제한 상태를 "전체"로 되돌리면 사용자가 고른 것과 반대로 보인다.
 */

export interface ParsedEntryFilter {
  /** 고른 사람. undefined면 전체 */
  personIds?: string[];
  /** true=과소비가 섞인 거래만, false=과소비가 없는 거래만, undefined면 전체 */
  extra?: boolean;
  /** 아무것도 고르지 않았다. 어떤 결과도 나오지 않아야 한다. */
  matchNothing: boolean;
}

/** 쉼표로 이어 온 값을 잘라 빈 항목을 버린다. */
export function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseEntryFilter(
  query: EntryFilterQuery & { personId?: string },
): ParsedEntryFilter {
  let matchNothing = false;

  // 한 사람만 보는 personId는 예전 파라미터다. 있으면 그것을 우선한다.
  let personIds: string[] | undefined;
  if (query.personId) {
    personIds = [query.personId];
  } else if (query.personIds !== undefined) {
    // 아무도 고르지 않았으면 빈 배열로 남긴다. "전체(undefined)"와 구분해야
    // 수단별 목록처럼 사람 소유 기준으로 걸러내는 곳에서 올바르게 비워진다.
    personIds = splitList(query.personIds);
    if (personIds.length === 0) matchNothing = true;
  }

  let extra: boolean | undefined;
  if (query.extraTypes !== undefined) {
    const types = splitList(query.extraTypes);
    const wantsNormal = types.includes('normal');
    const wantsExtra = types.includes('extra');

    if (!wantsNormal && !wantsExtra) matchNothing = true;
    // 둘 다 고른 것은 전체와 같다. 조건을 걸지 않는 편이 정확하다
    // (카테고리 다리가 없는 전표까지 그대로 포함된다).
    else if (wantsNormal !== wantsExtra) extra = wantsExtra;
  }

  return { personIds, extra, matchNothing };
}

/** 어떤 전표에도 걸리지 않는 조건. 아무것도 고르지 않았을 때 쓴다. */
export const MATCH_NOTHING: Prisma.JournalEntryWhereInput = { id: { in: [] } };

/**
 * 자산 주인 조건. 전체면 undefined.
 *
 * 필터의 기준은 "거래를 입력한 사람"이 아니라 **돈이 오간 계좌의 주인**이다.
 * 남의 통장으로 결제한 건도 그 통장 주인의 것으로 본다. 수단별 탭이 계좌 소유자
 * 기준으로 목록을 만들기 때문에, 목록·합계·차트도 같은 기준이어야 어긋나지 않는다.
 *
 * 어느 계좌를 보는지는 entry-view의 표시 규칙과 같다.
 *   - 돈이 나간 쪽(음수 다리)을 본다. 이체는 보내는 계좌가 기준이 된다.
 *   - 나간 쪽이 없으면(수입, 잔액 증가 조정) 들어온 쪽을 본다.
 * 자본 계정은 주인이 없으므로 "나간 쪽"을 찾을 때 제외한다. 그러지 않으면
 * 기초잔액·조정 전표가 주인 없는 다리에 걸려 아무에게도 속하지 않게 된다.
 */
export function assetOwnerCondition(
  filter: ParsedEntryFilter,
): Prisma.JournalEntryWhereInput | undefined {
  const ids = filter.personIds;
  if (!ids) return undefined;

  return {
    OR: [
      { postings: { some: { amount: { lt: 0 }, account: { ownerId: { in: ids } } } } },
      {
        AND: [
          { postings: { none: { amount: { lt: 0 }, account: { ownerId: { not: null } } } } },
          { postings: { some: { amount: { gt: 0 }, account: { ownerId: { in: ids } } } } },
        ],
      },
    ],
  };
}

/**
 * 일반/과소비 posting 조건.
 *
 * 반드시 카테고리 다리에만 걸어야 한다. 계좌 다리는 extraAmount가 항상 0이라서
 * 조건 없이 걸면 "일반"이 사실상 전체와 같아진다.
 *
 * 한 줄의 일부만 과소비일 수 있다(10만 원 중 3만 원). 그런 줄은 "과소비"에 든다.
 * 목록 필터는 "과소비가 섞인 거래인가"를 가르는 것이지 금액을 쪼개지 않는다.
 */
export function extraPostingCondition(
  filter: ParsedEntryFilter,
): Prisma.PostingWhereInput | undefined {
  if (filter.extra === undefined) return undefined;
  return {
    extraAmount: filter.extra ? { gt: 0 } : { equals: 0 },
    categoryId: { not: null },
  };
}
