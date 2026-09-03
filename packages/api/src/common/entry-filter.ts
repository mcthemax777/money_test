import { AccountType, CategoryType, Prisma } from '@prisma/client';
import { EntryFilterQuery, type EntryKind, type ParsedEntrySearch } from '@money/types';

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
 * 반드시 카테고리 다리에만 걸어야 한다. 계좌 다리는 두 금액이 모두 0이라
 * 조건 없이 걸면 아무것도 걸리지 않거나 전부 걸린다.
 *
 * 한 줄이 일반과 과소비로 나뉠 수 있다(3,000원 중 2,000원이 과소비). 그런 줄은
 * **양쪽 모두**에 든다. 일반만 보는 화면에서 그 거래를 통째로 빼 버리면, 합계는
 * 남은 1,000원을 세는데 목록에는 그 거래가 없어 둘이 어긋난다.
 *
 * 금액을 얼마로 셀지는 부르는 쪽이 정한다. 여기서는 "그 몫이 있는 줄"만 고른다.
 */
export function extraPostingCondition(
  filter: ParsedEntryFilter,
): Prisma.PostingWhereInput | undefined {
  if (filter.extra === undefined) return undefined;
  return {
    ...(filter.extra ? { extraAmount: { gt: 0 } } : { normalAmount: { gt: 0 } }),
    categoryId: { not: null },
  };
}

/**
 * 검색을 다리 조건으로. 무리마다 하나씩 돌려주고, 부르는 쪽이 AND 로 잇는다.
 *
 * 다리 조건은 "이 전표에 그런 다리가 하나라도 있는가"로 걸린다. 그래서 한 무리를
 * 조건 하나로 만들어야 한다 -- 둘로 쪼개 각각 걸면 "식비 다리가 있고 교통비 다리도
 * 있는 전표"가 되어, 분할 거래만 걸리는 엉뚱한 조건이 된다.
 */
export function entrySearchConditions(search: ParsedEntrySearch): Prisma.PostingWhereInput[] {
  const conditions: Prisma.PostingWhereInput[] = [];

  if (search.categoryIds && search.categoryIds.length > 0) {
    // 대분류를 고르면 소분류까지. entries.getEntries 의 categoryId 한 개짜리와 같은 규칙이다.
    conditions.push({
      OR: [
        { categoryId: { in: search.categoryIds } },
        { category: { parentId: { in: search.categoryIds } } },
      ],
    });
  }

  const methods: Prisma.PostingWhereInput[] = [];
  if (search.paymentAccountIds && search.paymentAccountIds.length > 0) {
    /*
     * 결제수단 관점이다. 이 통장에서 실제로 돈이 나간 전표만 본다.
     *
     * 체크카드 결제는 연결 통장 다리에도 걸리므로 카드가 붙은 다리를 빼고, 이체로
     * 돈이 들어온 쪽(+)도 뺀다. /reports/payment-methods 와 같은 규칙이라, 수단별
     * 목록에 적힌 금액과 그것을 눌러 나온 거래의 합이 어긋나지 않는다.
     */
    methods.push({
      accountId: { in: search.paymentAccountIds },
      cardId: null,
      amount: { lt: 0 },
    });
  }
  if (search.paymentCardIds && search.paymentCardIds.length > 0) {
    methods.push({ cardId: { in: search.paymentCardIds }, amount: { lt: 0 } });
  }
  if (methods.length > 0) {
    conditions.push(methods.length === 1 ? methods[0] : { OR: methods });
  }

  return conditions;
}

/**
 * 태그 조건. 고른 태그끼리 OR 로 잇는다. 고르지 않았으면 undefined.
 *
 * **다리가 아니라 전표를 본다.** 태그는 전표에 붙으므로(EntryTag) 다리 조건으로 만들 수
 * 없다. `entrySearchConditions` 가 돌려주는 무리들과 달리 부르는 쪽이 전표 조건 목록에
 * 넣는다 -- 유형 조건과 같은 자리다.
 *
 * 무리 안은 OR 이다. `some` 하나에 `in` 을 쓰면 "고른 것 중 하나라도 붙은 전표"가 되어
 * 그 규칙이 그대로 나온다. AND 로 두려면 태그마다 `some` 을 따로 걸어야 하는데, 그러면
 * 태그 둘을 고르는 순간 "둘 다 붙은 거래"만 남아 다른 무리와 규칙이 어긋난다.
 */
export function entryTagCondition(
  tagIds: readonly string[] | undefined,
): Prisma.JournalEntryWhereInput | undefined {
  if (!tagIds || tagIds.length === 0) return undefined;
  return { tags: { some: { tagId: { in: [...tagIds] } } } };
}

/**
 * 유형 조건. 고른 유형끼리 OR 로 잇는다. 전체면 undefined.
 *
 * **지출·수입은 카테고리 기준, 이체·카드정산은 자금 이동 기준이다.** 둘을 갈라 두는
 * 것이 이 함수의 요점이다.
 *
 *   지출     지출 카테고리 다리가 있는 전표
 *   수입     수입 카테고리 다리가 있는 전표
 *   이체     계좌 사이를 옮긴 돈 (신용카드·기초잔액이 끼지 않은)
 *   카드정산 계좌 사이를 옮긴 돈 중 신용카드 부채 계정이 끼는 것
 *   조정     기초잔액 계정이 끼는 것
 *
 * 왜 지출을 `classifyEntry` 와 다르게 두는가. **수수료가 붙은 이체 때문이다.** 그 전표는
 * 표시 유형이 이체지만 수수료는 지출 카테고리 다리다. `classifyEntry` 로 지출을 고르면
 * 그 전표가 빠지는데, 지출 합계(/reports/summary)는 카테고리 기준이라 그 수수료를
 * 이미 세고 있다. 그러면 **지출만 고른 달의 합계가 전체 지출보다 작아진다** -- 화면
 * 안에서 숫자가 갈린다. 이 저장소가 `kind` 와 `categoryType` 을 따로 두는 이유도 같다.
 *
 * 그래서 지출과 이체는 서로 배타적이지 않다. 수수료가 붙은 이체는 양쪽에 든다. 돈이
 * 옮겨진 것도 사실이고 수수료를 쓴 것도 사실이다.
 *
 * 이동 쪽 셋은 `classifyEntry` 와 정확히 같아야 한다. "계좌 다리가 둘 이상"은 Prisma 로
 * 셀 수 없어서 **부호가 다른 계좌 다리가 둘 다 있는가**로 바꿨다. 전표는 균형을 이루므로
 * 계좌 사이를 옮긴 돈은 한쪽이 음수, 다른 쪽이 양수다. 손으로 옮긴 규칙이라 검사가
 * 지킨다 -- 스모크가 모든 전표를 `classifyEntry` 로 분류해 대조한다.
 */
export function entryKindCondition(
  kinds: readonly EntryKind[] | undefined,
): Prisma.JournalEntryWhereInput | undefined {
  if (!kinds || kinds.length === 0) return undefined;

  const accountLeg = (sign: 'lt' | 'gt'): Prisma.JournalEntryWhereInput => ({
    postings: { some: { accountId: { not: null }, amount: { [sign]: 0 } } },
  });
  /** 계좌 사이를 옮긴 돈. 부호가 다른 계좌 다리가 둘 다 있다. */
  const movesBetweenAccounts: Prisma.JournalEntryWhereInput = {
    AND: [accountLeg('lt'), accountLeg('gt')],
  };
  const hasAccountType = (type: AccountType): Prisma.JournalEntryWhereInput => ({
    postings: { some: { account: { type } } },
  });
  const hasCategoryType = (type: CategoryType): Prisma.JournalEntryWhereInput => ({
    postings: { some: { category: { type } } },
  });

  const of = (kind: EntryKind): Prisma.JournalEntryWhereInput => {
    switch (kind) {
      case 'card_payment':
        return { AND: [movesBetweenAccounts, hasAccountType(AccountType.credit_card)] };
      case 'adjustment':
        return {
          AND: [
            movesBetweenAccounts,
            { NOT: hasAccountType(AccountType.credit_card) },
            hasAccountType(AccountType.opening_balance),
          ],
        };
      case 'transfer':
        return {
          AND: [
            movesBetweenAccounts,
            { NOT: hasAccountType(AccountType.credit_card) },
            { NOT: hasAccountType(AccountType.opening_balance) },
          ],
        };
      case 'income':
        return hasCategoryType(CategoryType.income);
      default:
        return hasCategoryType(CategoryType.expense);
    }
  };

  const branches = kinds.map(of);
  return branches.length === 1 ? branches[0] : { OR: branches };
}
