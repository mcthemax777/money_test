/**
 * 리포트가 읽을 전표·다리의 범위 (reports.service.ts 에서 떼어 냄, 2026-10-26).
 *
 * 사람 필터와 거래 화면의 검색을 Prisma 조건으로 옮긴다. 목록(/entries)과 같은 조건
 * 함수(common/entry-filter)를 써야 화면 안에서 합계와 목록이 어긋나지 않는다.
 */
import { BadRequestException } from '@nestjs/common';
import { AccountType, CategoryType, Prisma } from '@prisma/client';
import { NO_ACCOUNT, ReportDto, parseEntrySearch, type ParsedEntrySearch } from '@money/types';
import { readEnum } from '@/common/text';
import {
  MATCH_NOTHING,
  type ParsedEntryFilter,
  assetOwnerCondition,
  entryFeatureCondition,
  entryKindCondition,
  entryPersonCondition,
  entrySearchConditions,
  entryTagCondition,
  entryTextCondition,
  parseEntryFilter,
  splitEntryIds,
} from '@/common/entry-filter';
import type { PrismaService } from '@/config/prisma.service';
import { REPORT_CATEGORY_TYPES } from './report-rows';

/**
 * 사람 필터와 검색을 **전표 수준**의 조건 목록으로. 부르는 쪽이 AND 로 잇는다.
 *
 * 다리 자신이 검색에 맞는지 보는 것이 아니라 "그런 다리를 가진 전표인가"를 본다. 그래서
 * 식비를 찾으면 식비가 섞인 분할 거래가 통째로 들고, 그 달의 합계는 화면에 보이는 거래들의
 * 합과 같아진다. 다리 쪽으로 걸면 목록에는 있는 거래의 일부 금액이 합계에서 빠져 둘이 어긋난다.
 *
 * 월 합계(`entryScope`)와 거래 화면의 달 목록(`getEntryMonths`)이 함께 쓴다. 예전에는 두 벌이었다.
 */
export async function entryConditions(
  prisma: PrismaService,
  projectId: string,
  filter: ParsedEntryFilter,
  search: ParsedEntrySearch,
  /** 분할을 셀 범위. 기간이 없는 조회면 비운다. */
  date: { gte?: Date; lt?: Date } | null,
): Promise<Prisma.JournalEntryWhereInput[]> {
  const owner = assetOwnerCondition(filter);
  const kindCondition = entryKindCondition(search.kinds);
  // 태그도 전표에 붙으므로 유형과 같은 자리에 온다. "태그 없음"도 이 무리다.
  const tagCondition = entryTagCondition(search.tagIds, search.noTag);
  // 설명의 글자와 낸 사람도 전표에 있다.
  const textCondition = entryTextCondition(search.text);
  const personCondition = entryPersonCondition(search.entryPersonIds);
  // 모양(분할·할부). 분할은 분류 다리를 세어야 해서 id 를 먼저 받아 온다.
  const featureCondition = entryFeatureCondition(
    search.features,
    search.features?.includes('split')
      ? await splitEntryIds(prisma, { projectId, ...(date ? { date } : {}) })
      : undefined,
  );
  return [
    ...(owner ? [owner] : []),
    ...(kindCondition ? [kindCondition] : []),
    ...(tagCondition ? [tagCondition] : []),
    ...(textCondition ? [textCondition] : []),
    ...(personCondition ? [personCondition] : []),
    ...(featureCondition ? [featureCondition] : []),
    ...entrySearchConditions(search).map((posting) => ({ postings: { some: posting } })),
  ];
}

/**
 * 월 집계의 전표 범위.
 *
 * 자산 주인 필터는 목록(/entries)과 같은 규칙을 쓴다. 목록만 걸러 놓으면
 * 상단 합계와 소계가 어긋난다. 거래 화면의 검색도 여기로 함께 들어온다.
 */
export async function entryScope(
  prisma: PrismaService,
  projectId: string,
  range: { start: Date; end: Date },
  query: ReportDto.PeriodQuery,
): Promise<Prisma.JournalEntryWhereInput> {
  const filter = parseEntryFilter(query);
  const search = parseEntrySearch(query);
  // 아무것도 고르지 않았으면 어떤 전표도 걸리지 않아야 한다.
  if (filter.matchNothing || search.matchNothing) return { projectId, ...MATCH_NOTHING };

  const conditions = await entryConditions(prisma, projectId, filter, search, {
    gte: range.start,
    lt: range.end,
  });

  return {
    projectId,
    date: { gte: range.start, lt: range.end },
    ...(conditions.length > 0 ? { AND: conditions } : {}),
  };
}

/** 카테고리(또는 전체) 기준. 대분류를 지정하면 소분류까지 포함한다. 검색 조건도 건다. */
export async function trendByCategoryWhere(
  prisma: PrismaService,
  projectId: string,
  query: ReportDto.TrendQuery,
  start: Date,
  end: Date,
): Promise<Prisma.PostingWhereInput> {
  // 쿼리스트링 값은 문자열로 도착한다 (DTO가 인터페이스라 암묵 변환이 없다).
  const exact = query.exact === true || (query.exact as unknown) === 'true';

  const target: Prisma.PostingWhereInput =
    query.target === 'category'
      ? exact
        ? // "미분류": 대분류에 바로 기록한 건만 본다.
          { categoryId: query.targetId }
        : {
            OR: [
              { categoryId: query.targetId },
              { category: { parentId: query.targetId } },
            ],
          }
      : { category: { type: (readEnum(query.type, REPORT_CATEGORY_TYPES, '유형') ?? 'expense') } };

  // 사람 필터에 거래 화면의 검색이 얹힌 범위. 합계·구성비가 쓰는 것과 같다.
  return { ...target, entry: await entryScope(prisma, projectId, { start, end }, query) };
}

/** 태그 기준. 그 태그가 붙은 전표의 분류 다리를 고른다 -- 줄은 판정기가 가른다. */
export async function trendByTagWhere(
  prisma: PrismaService,
  projectId: string,
  query: ReportDto.TrendQuery,
  start: Date,
  end: Date,
): Promise<Prisma.PostingWhereInput> {
  if (!query.targetId) throw new BadRequestException('태그를 골라 주세요.');
  return {
    category: { type: (readEnum(query.type, REPORT_CATEGORY_TYPES, '유형') ?? 'expense') },
    entry: await entryScope(prisma, projectId, { start, end }, { ...query, tagIds: query.targetId }),
  };
}

/**
 * 결제수단(계좌/카드) 기준 월별 지출 합계.
 *
 * 금액은 카테고리 posting에서 가져오고, 결제수단은 "돈이 나간 계좌 다리"로 판별한다.
 *   - 음수 조건: 이체의 받는 계좌(+)에 지출이 잡히는 중복을 막는다.
 *   - cardId IS NULL: 체크카드 결제는 연결 통장에도 걸리므로 계좌 집계에서 뺀다.
 *
 * 이체 수수료는 보내는 계좌의 지출로 잡힌다. 이체 금액 자체는 카테고리 다리가 없어
 * 합계에 들어가지 않으므로, 수수료만 정확히 반영된다.
 */
export function trendByPaymentMethodWhere(
  projectId: string,
  query: ReportDto.TrendQuery,
  start: Date,
  end: Date,
): Prisma.PostingWhereInput {
  /*
   * 수단별의 미지정 칸은 id 자리에 `NO_ACCOUNT` 를 들고 온다. 화면은 미지정 계정의 id 를
   * 모르므로(목록에 내려가지 않는다) 여기서 유형으로 바꿔 읽는다.
   */
  const accountTarget: Prisma.PostingWhereInput =
    query.targetId === NO_ACCOUNT
      ? { account: { type: AccountType.unassigned } }
      : { accountId: query.targetId };
  const method: Prisma.PostingWhereInput =
    query.target === 'card'
      ? { cardId: query.targetId, amount: { lt: 0 } }
      : { ...accountTarget, cardId: null, amount: { lt: 0 } };

  return {
    category: { type: CategoryType.expense },
    entry: {
      ...trendEntryScope(projectId, query, start, end),
      // 그 수단으로 돈이 나간 다리가 있는 전표만.
      postings: { some: method },
    },
  };
}

/** 시계열이 보는 전표 범위. 기간과 사람 필터는 목록·합계와 같은 규칙을 쓴다. */
function trendEntryScope(
  projectId: string,
  query: ReportDto.TrendQuery,
  start: Date,
  end: Date,
): Prisma.JournalEntryWhereInput {
  const filter = parseEntryFilter(query);
  // 아무도 고르지 않았으면 한 건도 나오지 않아야 한다.
  if (filter.matchNothing) return { ...MATCH_NOTHING, projectId };

  const owner = assetOwnerCondition(filter);
  return {
    projectId,
    date: { gte: start, lt: end },
    ...(owner ?? {}),
  };
}
