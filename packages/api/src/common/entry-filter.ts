import { AccountType, CategoryType, Prisma, type PrismaClient } from '@prisma/client';
import {
  EntryFilterQuery,
  type EntryFeature,
  type EntryKind,
  type ParsedEntrySearch,
  lineMatcherOf,
} from '@money/types';

/*
 * 걸린 줄만 남기는 판정기는 공용 규칙이 갖는다 (`@money/types` 의 entry-view).
 *
 * 기기도 오프라인에서 같은 목록을 그려야 한다. 규칙이 두 벌이면 같은 검색이 서버에서는
 * 한 줄, 사본에서는 두 줄을 보여 준다. 부르는 쪽이 여기서 찾을 수 있도록 다시 내보낸다.
 */
export { lineMatcherOf };

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
 *   - 돈이 나간 쪽(0 이하인 다리)을 본다. 이체는 보내는 계좌가 기준이 된다.
 *   - 나간 쪽이 없으면(수입, 잔액 증가 조정) 들어온 쪽을 본다.
 * 자본 계정은 주인이 없으므로 "나간 쪽"을 찾을 때 제외한다. 그러지 않으면
 * 기초잔액·조정 전표가 주인 없는 다리에 걸려 아무에게도 속하지 않게 된다.
 *
 * **나간 쪽에 0 을 넣는다.** 전액을 깎은 결제는 그 통장에서 빠져나간 돈이 0 이라,
 * 음수만 보면 나간 쪽이 없는 전표가 된다. 그러면 들어온 쪽을 찾는 둘째 가지로 내려가는데
 * 들어온 쪽도 없어서 **아무에게도 속하지 않는 거래**가 되고, 사람을 고른 목록에서 통째로
 * 사라진다. 거래 화면은 늘 사람으로 좁혀 보므로 그 거래는 어디에서도 보이지 않는다.
 *
 * 둘째 가지의 문지기도 같은 기준이어야 한다. 한쪽만 0 을 받으면 0원 다리를 가진 전표가
 * 두 가지에 함께 걸려, 나간 쪽 주인과 들어온 쪽 주인 양쪽 목록에 나온다.
 */
export function assetOwnerCondition(
  filter: ParsedEntryFilter,
): Prisma.JournalEntryWhereInput | undefined {
  const ids = filter.personIds;
  if (!ids) return undefined;

  return {
    OR: [
      { postings: { some: { amount: { lte: 0 }, account: { ownerId: { in: ids } } } } },
      {
        AND: [
          { postings: { none: { amount: { lte: 0 }, account: { ownerId: { not: null } } } } },
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

  const categoryIds = search.categoryIds ?? [];
  const categorySelfIds = search.categorySelfIds ?? [];
  if (categoryIds.length > 0 || categorySelfIds.length > 0) {
    /*
     * 분류 한 무리. 두 갈래를 OR 로 잇는다.
     *
     *   `categoryIds`      대분류를 고르면 소분류까지 (entries.getEntries 의
     *                      categoryId 한 개짜리와 같은 규칙이다).
     *   `categorySelfIds`  그 분류에 **직접** 적은 것만 (미분류). 소분류를 만들어
     *                      두고도 대분류에 그냥 적은 거래를 찾아 정리할 때 쓴다.
     *
     * 둘이 한 무리라 "식비 미분류 또는 교통 전체"가 그대로 표현된다.
     */
    const branches: Prisma.PostingWhereInput[] = [];
    if (categoryIds.length > 0) {
      branches.push({ categoryId: { in: categoryIds } });
      branches.push({ category: { parentId: { in: categoryIds } } });
    }
    if (categorySelfIds.length > 0) branches.push({ categoryId: { in: categorySelfIds } });

    conditions.push(branches.length === 1 ? branches[0] : { OR: branches });
  }

  const methods: Prisma.PostingWhereInput[] = [];
  if (search.paymentAccountIds && search.paymentAccountIds.length > 0) {
    /*
     * 이 통장의 관점이다. **이 통장에서 오간 돈 전부**를 본다 -- 나간 것도, 들어온 것도.
     *
     * 예전에는 들어온 쪽(+)을 수입으로만 좁혔다. 받는 통장이 쓴 돈은 아니라는 이유였는데,
     * 그 탓에 통장 하나로 걸러 보면 **이체로 들어온 돈이 통째로 빠졌다**. 그 통장의
     * 내역을 보러 온 사람에게는 잔액이 왜 늘었는지 알 길이 없는 목록이 남는다.
     *
     * 이체가 보내는 통장과 받는 통장 양쪽에 걸리는 것은 맞다. 한 전표가 두 통장에서
     * 오간 일이고, 목록은 전표 단위라 한쪽을 골라도 그 전표는 한 번만 나온다.
     *
     * 합계는 흐트러지지 않는다. 합계는 걸린 전표의 **카테고리 다리**를 더하는데, 이체와
     * 대금 이동에는 그 다리가 없다(수수료만 있다). 년월 줄에 이체가 0으로 세어지는 것과
     * 같은 규칙이다.
     *
     * 나간 쪽에서 카드가 붙은 다리는 여전히 뺀다. 체크카드 결제가 연결 통장 다리에도
     * 걸려 카드와 통장에 두 번 세어지기 때문이다 (그 거래는 카드로 걸러 볼 수 있다).
     *
     * **0원짜리 다리도 함께 본다.** 예전에는 "어느 쪽으로도 오간 것이 없다"며 뺐는데,
     * 그 탓에 **전액을 깎은 결제가 통째로 사라졌다** -- 포인트로 전액을 낸 거래는 정가가
     * 그대로 적혀 있고 그 통장으로 결제한 것도 맞는데, 빠져나간 돈만 0이다. 그 통장의
     * 내역을 보러 온 사람에게 "그날 그 결제가 없었다"로 보인다.
     *
     * **기초잔액 전표는 뺀다.** 들어온 돈 전부를 보게 되면서 그 전표도 양수 다리로
     * 걸렸는데, 사용자가 적은 거래가 아니라 계좌를 만들 때(그리고 잔액 맞추기가) 원장
     * 맨 앞에 두는 자본 전표다. 빼지 않으면 통장을 고를 때마다 기초잔액 한 건이 목록에
     * 끼어든다. 거래 목록의 달 줄이 그 전표를 빼는 것과 같은 판단이다
     * (reports.service 의 전표 시각 질의).
     */
    methods.push({
      accountId: { in: search.paymentAccountIds },
      cardId: null,
      entry: { postings: { none: { account: { type: AccountType.opening_balance } } } },
    });
  }
  if (search.paymentCardIds && search.paymentCardIds.length > 0) {
    /*
     * 이 카드의 관점이다. **쓴 것과 갚은 것 둘 다** 본다.
     *
     * 예전에는 나간 쪽(-)만 보았다. 그런데 카드 대금 결제는 이 카드의 부채가 줄어드는
     * 일이라 카드 다리가 양수로 남는다. 그래서 카드 하나로 걸러 보면 환불 입금은
     * 나오는데(그쪽은 음수다) 정작 대금 결제만 빠졌다 -- 카드에서 오간 돈을 보러 온
     * 사람에게 갚은 기록이 없으면 남은 대금이 왜 줄었는지 알 길이 없다.
     *
     * 합계는 달라지지 않는다. 대금 이동에는 카테고리 다리가 없어 더할 것이 없다
     * (그래서 사용액과 대금 결제가 이중으로 세어지지도 않는다).
     */
    methods.push({ cardId: { in: search.paymentCardIds } });
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
 * 분할 거래의 id. 분류 다리가 둘 이상인 전표를 세어 온다.
 *
 * **왜 조건이 아니라 목록인가.** Prisma 의 관계 조건은 some/every/none 뿐이라 "그런
 * 다리가 둘 이상"을 셀 수 없다 -- 다리 하나만 보는 조건으로는 분할을 가려낼 수 없어서,
 * 세는 일만 따로 질의해 id 로 받는다. 사본(SQLite)은 하위 질의로 그 자리에서 센다.
 *
 * `scope` 는 좁게 줄수록 목록이 짧아진다. 프로젝트와 기간만 주어도 맞는 값이 나온다 --
 * 이 목록은 나머지 조건과 AND 로 이어지므로 넓게 세어 와도 결과가 달라지지 않는다.
 */
export async function splitEntryIds(
  prisma: PrismaClient,
  scope: Prisma.JournalEntryWhereInput,
): Promise<string[]> {
  const rows = await prisma.posting.groupBy({
    by: ['entryId'],
    where: { categoryId: { not: null }, entry: scope },
    having: { entryId: { _count: { gt: 1 } } },
  });
  return rows.map((row) => row.entryId);
}

/**
 * 모양 조건. 고른 모양끼리 OR 로 잇는다. 고르지 않았으면 undefined.
 *
 * **다리가 아니라 전표를 본다** -- 유형·태그와 같은 자리다. 할부는 "할부 계획이 붙은
 * 카드 다리를 가진 전표"이고, 분할은 세어 온 id 목록(`splitEntryIds`)이다.
 *
 * 분할을 골랐는데 `splitIds` 를 주지 않으면 분할 가지를 빼지 않고 **아무것도 걸리지
 * 않게** 한다. 세는 질의를 빠뜨린 자리에서 조건이 조용히 사라지면, 걸러지지 않은 목록이
 * 걸러진 것처럼 보인다.
 */
export function entryFeatureCondition(
  features: readonly EntryFeature[] | undefined,
  splitIds?: readonly string[],
): Prisma.JournalEntryWhereInput | undefined {
  if (!features || features.length === 0) return undefined;

  const branches: Prisma.JournalEntryWhereInput[] = [];
  if (features.includes('installment')) {
    branches.push({ postings: { some: { installmentPlan: { isNot: null } } } });
  }
  if (features.includes('split')) {
    branches.push({ id: { in: splitIds ? [...splitIds] : [] } });
  }

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

