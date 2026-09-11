import { AccountType, CategoryType, Prisma } from '@prisma/client';
import { EntryFilterQuery, type EntryKind, type ParsedEntrySearch } from '@money/types';

/**
 * 화면의 사람 필터를 Prisma 조건으로 옮긴다.
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

  return { personIds, matchNothing };
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
     * 이 통장의 관점이다. **나간 돈과 들어온 수입 둘 다** 본다.
     *
     * 나간 쪽(-)에서는 카드가 붙은 다리를 뺀다. 체크카드 결제가 연결 통장 다리에도
     * 걸려 카드와 통장에 두 번 세어지기 때문이다. 이체로 들어온 쪽(+)도 뺀다 --
     * 받는 통장이 쓴 돈이 아니다.
     *
     * 수입은 따로 담는다. 수입 전표의 통장 다리는 받는 쪽이라 금액이 양수여서,
     * "나간 돈"만 보면 하나도 걸리지 않는다. 그런데 /reports/payment-methods 는
     * 그 금액을 이미 수단의 income 칸에 적고 있다 -- 빼 두면 줄에는 수입이 적혀
     * 있는데 그 줄을 눌러 편 목록에는 지출만 나온다. 목록과 합계가 같은 규칙을
     * 써야 한다는 것이 이 자리의 원칙이라, 수입도 같이 든다.
     *
     * 들어온 쪽을 수입으로만 좁히는 것은 이체·카드정산의 받는 다리까지 들이지
     * 않기 위해서다. 그 둘은 보내는 통장에서 이미 한 번 걸린다.
     */
    methods.push({
      accountId: { in: search.paymentAccountIds },
      cardId: null,
      OR: [
        { amount: { lt: 0 } },
        {
          amount: { gt: 0 },
          entry: { postings: { some: { category: { type: CategoryType.income } } } },
        },
      ],
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
 * 설명에 든 글자 조건. 적지 않았으면 undefined.
 *
 * **다리가 아니라 전표를 본다.** 설명은 전표에 있다(JournalEntry.description). 태그·유형과
 * 같은 자리에 오고, 다른 무리와는 AND 로 이어진다.
 *
 * 대소문자를 가리지 않는다. 사본(SQLite)의 LIKE 도 같은 자리에서 같은 일을 한다 --
 * 같은 검색이 온라인과 오프라인에서 같은 목록을 내야 한다.
 */
export function entryTextCondition(
  text: string | undefined,
): Prisma.JournalEntryWhereInput | undefined {
  if (!text) return undefined;
  return { description: { contains: text, mode: 'insensitive' } };
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
  /** "태그 없음"을 함께 골랐는가. 고른 태그들과 OR 로 잇는다. */
  noTag = false,
): Prisma.JournalEntryWhereInput | undefined {
  const chosen = tagIds && tagIds.length > 0 ? [...tagIds] : [];
  if (chosen.length === 0 && !noTag) return undefined;

  const branches: Prisma.JournalEntryWhereInput[] = [];
  if (chosen.length > 0) branches.push({ tags: { some: { tagId: { in: chosen } } } });
  // 태그가 하나도 붙지 않은 전표. "여행 또는 태그 없음"이 무리 안의 OR 로 이어진다.
  if (noTag) branches.push({ tags: { none: {} } });

  return branches.length === 1 ? branches[0] : { OR: branches };
}

/**
 * 거래를 낸 사람 조건. 고르지 않았으면 undefined.
 *
 * **자산주인 필터와 다른 것이다.** 이쪽은 거래를 적을 때 고른 사람(JournalEntry.personId)
 * 이고, 저쪽(assetOwnerCondition)은 돈이 오간 계좌의 주인이다. 남의 카드로 내 몫을 쓴
 * 거래에서 둘이 갈린다 -- 낸 사람은 나이고 계좌 주인은 카드 임자다.
 */
export function entryPersonCondition(
  personIds: readonly string[] | undefined,
): Prisma.JournalEntryWhereInput | undefined {
  if (!personIds || personIds.length === 0) return undefined;
  return { personId: { in: [...personIds] } };
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
