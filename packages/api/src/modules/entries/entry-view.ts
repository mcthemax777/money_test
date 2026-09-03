import { AccountType, CategoryType, Prisma } from '@prisma/client';
import {
  Dec,
  type EntryKind,
  type EntryListItem,
  type ViewConverter,
  type ViewEntry,
  type ViewPosting,
  classifyEntry as classifyShared,
  toListItem as toListItemShared,
} from '@money/types';

/**
 * 전표를 화면용 한 줄로 펴는 자리.
 *
 * 판별 규칙 자체는 `@money/types` 의 entry-view 가 갖는다. 기기가 오프라인에서 같은
 * 목록을 그려야 하고, 규칙이 두 벌이면 같은 거래가 한쪽에서는 이체, 다른 쪽에서는
 * 지출로 보인다. 여기서는 Prisma 행을 그 모양으로 옮기고 환산기를 잇는 일만 한다.
 */

type PostingWithRefs = {
  id: string;
  accountId: string | null;
  categoryId: string | null;
  amount: Prisma.Decimal;
  currency: string;
  exchangeRate: Prisma.Decimal;
  baseAmount: Prisma.Decimal;
  extraAmount: Prisma.Decimal;
  cardId: string | null;
  account: { id: string; name: string; type: AccountType } | null;
  category: {
    id: string;
    name: string;
    type: CategoryType;
    parentId: string | null;
    parent: { id: string; name: string } | null;
  } | null;
  card: { id: string; name: string } | null;
  installmentPlan: { totalMonths: number } | null;
};

export type EntryWithPostings = {
  id: string;
  date: Date;
  description: string;
  merchant: string | null;
  detailedNote: string | null;
  personId: string;
  person: { name: string } | null;
  originalCurrency: string | null;
  originalAmount: Prisma.Decimal | null;
  rateProvisional: boolean;
  postings: PostingWithRefs[];
  /**
   * 이 전표에 붙은 태그. `ENTRY_INCLUDE` 가 조인 행을 펴서 넣는다.
   *
   * 선택적으로 둔 것은 태그를 읽지 않는 가벼운 조회가 있기 때문이다(잔액 되돌리기처럼
   * 다리만 보는 자리). 그때 목록 한 줄은 태그가 없는 것으로 그려진다.
   */
  tags?: Array<{ tag: { id: string; name: string; color: string | null } }>;
};

/**
 * 저장 통화 -> 표시 통화 환산기 (필요한 부분만).
 *
 * 지금까지 이 계층이 쓰던 모양을 그대로 둔다. 부르는 쪽(reports, entries)이 이 타입으로
 * 환산기를 넘기고 있어, 공용 규칙의 Dec 기반 환산기로 여기서 바꿔 준다.
 */
export interface AmountConverter {
  convert(value: Prisma.Decimal): Prisma.Decimal;
  /** 1 저장통화 = rate 표시통화 */
  rate: Prisma.Decimal;
}

const IDENTITY: AmountConverter = {
  convert: (value) => value,
  rate: new Prisma.Decimal(1),
};

/** Prisma 행을 공용 규칙이 보는 모양으로. 금액은 DecInput 이라 그대로 넘어간다. */
function toViewEntry(entry: EntryWithPostings): ViewEntry {
  return {
    ...entry,
    postings: entry.postings as unknown as ViewPosting[],
    // 조인 행을 벗겨 태그만 남긴다. 공용 규칙은 조인을 모른다.
    tags: entry.tags?.map((row) => row.tag),
  } as unknown as ViewEntry;
}

/** 이 계층의 환산기를 공용 규칙의 환산기로. */
function toViewConverter(show: AmountConverter): ViewConverter {
  return {
    convert: (value: Dec) => Dec.of(show.convert(new Prisma.Decimal(value.toString()))),
    rate: Dec.of(show.rate),
  };
}

export function classifyEntry(postings: PostingWithRefs[]): EntryKind {
  return classifyShared(postings as unknown as ViewPosting[]);
}

export function toListItem(
  entry: EntryWithPostings,
  show: AmountConverter = IDENTITY,
): EntryListItem {
  return toListItemShared(toViewEntry(entry), toViewConverter(show));
}

/** 목록/상세 조회에서 공통으로 쓰는 include. toListItem이 요구하는 관계와 짝이다. */
export const ENTRY_INCLUDE = {
  person: { select: { name: true } },
  postings: {
    include: {
      account: { select: { id: true, name: true, type: true } },
      category: {
        select: {
          id: true,
          name: true,
          type: true,
          parentId: true,
          parent: { select: { id: true, name: true } },
        },
      },
      card: { select: { id: true, name: true } },
      installmentPlan: { select: { totalMonths: true } },
    },
  },
  /*
   * 태그는 목록 한 줄이 칩으로 그린다. 이름과 색만 있으면 되므로 그만큼만 가져온다.
   *
   * 감춘 태그(isActive=false)도 함께 온다. 이미 붙어 있던 것을 목록에서 지우면 그
   * 거래가 왜 그 통계에 들었는지 설명할 수 없게 된다 -- 감추기는 "앞으로 고르지
   * 않는다"이지 "지난 기록에서 없앤다"가 아니다.
   */
  tags: {
    select: { tag: { select: { id: true, name: true, color: true } } },
  },
} satisfies Prisma.JournalEntryInclude;
