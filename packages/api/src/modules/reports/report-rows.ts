/**
 * 리포트가 읽은 다리를 집계 함수의 행 모양으로 옮기는 순수 함수들 (reports.service.ts 에서 떼어 냄, 2026-10-26).
 *
 * 더하는 규칙은 `@money/types` 의 report-aggregation 이 갖는다. 기기도 같은 함수를
 * 쓰기 때문에 서버가 SQL 로 다시 더하면 두 벌이 된다. 여기서는 행을 그 모양으로
 * 옮겨 주는 일만 한다.
 */
import { CategoryType, Prisma } from '@prisma/client';
import {
  type CategoryPostingRow,
  Dec,
  type LineMatcher,
  type NamedCategoryPostingRow,
  ReportDto,
} from '@money/types';
import { PAYBACK_DATE_SELECT, analysisDateOf } from '@/common/payback-scope';
import {
  INSTALLMENT_LEG_SELECT,
  INSTALLMENT_REFUND_SELECT,
  type InstallmentLeg,
  type InstallmentRefundCuts,
  type InstallmentSpread,
  spreadRowOf,
  spreadRows,
} from '@/common/installment-scope';

/*
 * 계좌 유형의 분류(자본·시가평가·부채)는 `@money/types` 의 net-worth-aggregation 이 갖는다.
 * 기기도 같은 분류로 총자산을 내야 하므로 서버에만 두면 두 벌이 된다.
 */
/** 리포트가 받는 분류 유형. */
export const REPORT_CATEGORY_TYPES = ['income', 'expense'] as const;

/**
 * 집계가 다리에서 읽는 것.
 *
 * 줄 키와 부모 분류와 전표의 태그가 함께 온다. 분류나 태그로 좁힌 질의에서 **걸린
 * 줄만** 더하기 위해서다 -- 질의는 전표 수준으로 걸려 분할의 나머지 줄까지 데려온다.
 * 태그 행은 전표당 두엇이라 다리마다 실려도 가볍다.
 */
export const AGGREGATE_SELECT = {
  categoryId: true,
  lineKey: true,
  baseAmount: true,
  category: { select: { type: true, parentId: true } },
  entry: {
    select: {
      date: true,
      tags: { select: { lineKey: true, tagId: true } },
      /*
       * 이 거래에 걸린 할부. 회차 기준으로 셀 때만 읽힌다.
       *
       * 카드 다리 하나뿐이라 배열이어도 한 줄이다. 발생 기준에서는 쓰이지 않지만
       * 조건을 나누면 select 가 두 벌이 되어, 늘 싣고 읽는 쪽에서 가린다.
       */
      postings: INSTALLMENT_LEG_SELECT,
      // 페이백이면 원거래의 날짜. 분석은 그 달에 센다 (common/payback-scope).
      ...PAYBACK_DATE_SELECT,
      // 할부 환불과 할부 원거래가 줄인 회차 (installment-refund). 회차 기준에서만 읽힌다.
      ...INSTALLMENT_REFUND_SELECT,
    },
  },
} as const;

/** 판정기가 다리에서 보는 것. */
type MatchableRow = {
  categoryId: string | null;
  lineKey: string | null;
  category: { parentId: string | null } | null;
  entry: { tags: Array<{ lineKey: string | null; tagId: string }> };
};

/** 이 다리가 검색 조건에 걸린 줄인가. 조건이 없으면 언제나 참이다. */
export function lineMatches(row: MatchableRow, matchLine?: LineMatcher): boolean {
  if (!matchLine) return true;
  return matchLine({
    categoryId: row.categoryId,
    parentCategoryId: row.category?.parentId ?? null,
    tagIds: row.entry.tags
      .filter((tag) => tag.lineKey !== null && tag.lineKey === row.lineKey)
      .map((tag) => tag.tagId),
  });
}

/** `AGGREGATE_SELECT` 로 읽은 다리를 집계 함수의 행으로. */
export function toAggregateRows(
  rows: Array<{
    categoryId: string | null;
    lineKey: string | null;
    baseAmount: Prisma.Decimal;
    category: { type: CategoryType; parentId: string | null } | null;
    entry: {
      date: Date;
      tags: Array<{ lineKey: string | null; tagId: string }>;
      postings?: InstallmentLeg[];
      paybackOf?: { date: Date } | null;
      installmentAdjust?: unknown;
      paybacks?: InstallmentRefundCuts;
    };
  }>,
  matchLine?: LineMatcher,
  /** 회차 기준으로 셀 때만 준다. 없으면 발생 기준이다. */
  spread?: InstallmentSpread,
  /** 자산 관점(결제수단 추이)이면 참. 페이백을 들어온 날짜 그대로 센다. */
  ownDate = false,
): CategoryPostingRow[] {
  // 계좌 다리는 오지 않지만(질의가 카테고리 다리만 고른다) 타입이 null 을 허용하므로 걸러 둔다.
  const mapped = rows.flatMap((row) => {
    if (!(row.categoryId && row.category && lineMatches(row, matchLine))) return [];
    const base: CategoryPostingRow = {
      categoryId: row.categoryId,
      categoryType: row.category.type,
      baseAmount: row.baseAmount as CategoryPostingRow['baseAmount'],
      date: (ownDate ? row.entry.date : analysisDateOf(row.entry)) as CategoryPostingRow['date'],
    };
    // 회차 기준이면 할부를 펴고, 할부 환불은 남은 몫만 환불한 날에 센다 (spreadRowOf).
    return [spread ? spreadRowOf(base, row) : base];
  });
  return spread ? spreadRows(mapped, spread) : mapped;
}

/**
 * 이름까지 실은 다리를 구성비 함수의 행으로. `toAggregateRows` 와 같은 규칙에 이름만 더한다.
 *
 * 소분류 행이 부모 이름까지 들고 오면 이름을 따로 조회하지 않아도 되고, 기기도 같은 모양의
 * 행으로 같은 함수를 쓸 수 있다.
 */
export function toNamedRows(
  rows: Array<
    MatchableRow & {
      baseAmount: Prisma.Decimal;
      category: {
        type: CategoryType;
        name: string;
        parentId: string | null;
        parent: { id: string; name: string } | null;
      } | null;
      entry: {
        date: Date;
        postings?: InstallmentLeg[];
        paybackOf?: { date: Date } | null;
        installmentAdjust?: unknown;
        paybacks?: InstallmentRefundCuts;
      };
    }
  >,
  matchLine?: LineMatcher,
  spread?: InstallmentSpread,
): NamedCategoryPostingRow[] {
  const named: NamedCategoryPostingRow[] = rows.flatMap((row) => {
    if (!(row.categoryId && row.category && lineMatches(row, matchLine))) return [];
    const base: NamedCategoryPostingRow = {
      categoryId: row.categoryId,
      categoryType: row.category.type,
      categoryName: row.category.name,
      parentCategoryId: row.category.parent?.id ?? null,
      parentCategoryName: row.category.parent?.name ?? null,
      baseAmount: row.baseAmount as NamedCategoryPostingRow['baseAmount'],
      // 페이백이면 원거래의 날짜 (toAggregateRows 와 같다).
      date: analysisDateOf(row.entry) as NamedCategoryPostingRow['date'],
    };
    // 회차 기준이면 할부를 펴고, 할부 환불은 남은 몫만 환불한 날에 센다 (spreadRowOf).
    return [spread ? spreadRowOf(base, row) : base];
  });
  // 회차 기준이면 줄마다 회차로 펴고 창 밖은 버린다. 이름은 그대로 따라간다.
  return spread ? spreadRows(named, spread) : named;
}

/** 집계 결과를 표시 환산기에 넣을 수 있는 모양으로. */
export function toDecimal(value: Dec): Prisma.Decimal {
  return new Prisma.Decimal(value.toString());
}

/** 계좌가 하나도 없는 가계부의 순자산. */
export function emptyNetWorth(): ReportDto.NetWorth {
  return {
    total: '0',
    cash: '0',
    investment: '0',
    liability: '0',
    unrealizedGain: '0',
    byType: {},
    byGroup: {},
    byAccount: [],
    byPerson: [],
  };
}
