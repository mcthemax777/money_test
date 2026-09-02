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
} satisfies Prisma.JournalEntryInclude;
