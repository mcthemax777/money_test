import { AccountType, CategoryType, Prisma } from '@prisma/client';
import type { EntryKind } from '@money/types';

/**
 * 전표를 화면용 한 줄로 펴는 로직.
 *
 * 새 구조에서 "커피 5,000원 식비 신한카드"를 보여주려면 postings 2~3행을 읽고
 * 어느 쪽이 계좌고 어느 쪽이 카테고리인지 판별해야 한다. 그 판별을 여기 한 곳에 모아
 * 서비스와 리포트가 같은 규칙을 쓰게 한다.
 */

type PostingWithRefs = {
  id: string;
  accountId: string | null;
  categoryId: string | null;
  statementId: string | null;
  amount: Prisma.Decimal;
  isFixed: boolean;
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
  statement: { periodStart: Date; periodEnd: Date } | null;
};

export type EntryWithPostings = {
  id: string;
  date: Date;
  description: string;
  merchant: string | null;
  detailedNote: string | null;
  personId: string;
  person: { name: string } | null;
  postings: PostingWithRefs[];
};

/**
 * 전표 종류 판별.
 *
 * 계좌 posting이 2개 이상이면 돈이 계좌 사이를 움직인 것이므로 이체 계열이다.
 * (이체에 수수료가 붙어 지출 카테고리 다리가 함께 있어도 이 규칙이 먼저 적용된다.)
 */
export function classifyEntry(postings: PostingWithRefs[]): EntryKind {
  const accountPostings = postings.filter((p) => p.account);

  if (accountPostings.length >= 2) {
    if (accountPostings.some((p) => p.account!.type === AccountType.credit_card)) {
      return 'card_payment';
    }
    if (accountPostings.some((p) => p.account!.type === AccountType.opening_balance)) {
      return 'adjustment';
    }
    return 'transfer';
  }

  const categoryPostings = postings.filter((p) => p.category);
  if (categoryPostings.some((p) => p.category!.type === CategoryType.income)) {
    return 'income';
  }
  return 'expense';
}

const ZERO = new Prisma.Decimal(0);

export function toListItem(
  entry: EntryWithPostings,
  /** 결제가 시작된 청구서 id 집합. 넘기지 않으면 잠기지 않은 것으로 본다. */
  settledStatementIds: ReadonlySet<string> = new Set(),
) {
  const kind = classifyEntry(entry.postings);
  const categoryPostings = entry.postings.filter((p) => p.category);
  const accountPostings = entry.postings.filter((p) => p.account);

  // 표시 금액은 항상 양수로 맞춘다.
  let amount: Prisma.Decimal;
  if (kind === 'expense') {
    amount = sum(categoryPostings.map((p) => p.amount));
  } else if (kind === 'income') {
    amount = sum(categoryPostings.map((p) => p.amount)).abs();
  } else {
    // 이체/카드결제/조정은 "받는 쪽"의 금액을 쓴다.
    const incoming = accountPostings.find((p) => p.amount.gt(ZERO));
    amount = incoming ? incoming.amount : sum(accountPostings.map((p) => p.amount)).abs();
  }

  // 지출/수입은 카테고리 다리가 주인공이다. 이체 수수료 다리는 대표 카테고리로 쓰지 않는다.
  const primaryCategory =
    kind === 'expense' || kind === 'income' ? categoryPostings[0] ?? null : null;

  // 이체에 붙은 수수료. 이체 자체는 소비가 아니지만 수수료는 지출이므로 따로 보여준다.
  // 수수료가 없어도 0으로 내려보내 화면이 분기하지 않게 한다.
  const feePosting = kind === 'transfer' ? categoryPostings[0] ?? null : null;
  const feeAmount = kind === 'transfer' ? (feePosting?.amount ?? ZERO).toString() : null;

  // 돈이 나간 쪽(음수)이 이 거래의 "계좌"다.
  const outgoing = accountPostings.find((p) => p.amount.lt(ZERO)) ?? accountPostings[0] ?? null;
  const incoming = accountPostings.find((p) => p.amount.gt(ZERO)) ?? null;
  const cardPosting = entry.postings.find((p) => p.card) ?? null;
  const statement = entry.postings.find((p) => p.statement)?.statement ?? null;

  const isTwoSided = kind === 'transfer' || kind === 'card_payment' || kind === 'adjustment';

  return {
    id: entry.id,
    kind,
    // 와이어 계약은 ISO 문자열이다 (IsoDateString)
    date: entry.date.toISOString(),
    description: entry.description,
    merchant: entry.merchant,
    detailedNote: entry.detailedNote,
    personId: entry.personId,
    personName: entry.person?.name ?? '',
    amount: amount.toString(),
    isFixed: primaryCategory?.isFixed ?? false,
    categoryId: primaryCategory?.category?.id ?? null,
    categoryName: primaryCategory?.category?.name ?? null,
    parentCategoryId: primaryCategory?.category?.parent?.id ?? null,
    parentCategoryName: primaryCategory?.category?.parent?.name ?? null,
    accountId: kind === 'income' ? incoming?.account?.id ?? null : outgoing?.account?.id ?? null,
    accountName:
      kind === 'income' ? incoming?.account?.name ?? null : outgoing?.account?.name ?? null,
    toAccountId: isTwoSided ? incoming?.account?.id ?? null : null,
    toAccountName: isTwoSided ? incoming?.account?.name ?? null : null,
    cardId: cardPosting?.card?.id ?? null,
    cardName: cardPosting?.card?.name ?? null,
    feeAmount,
    feeCategoryId: feePosting?.category?.id ?? null,
    feeCategoryName: feePosting?.category?.name ?? null,
    lockedByStatement: entry.postings.some(
      (p) => p.statementId && settledStatementIds.has(p.statementId),
    ),
    statementPeriodStart: statement?.periodStart.toISOString() ?? null,
    statementPeriodEnd: statement?.periodEnd.toISOString() ?? null,
  };
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
      statement: { select: { periodStart: true, periodEnd: true } },
    },
  },
} satisfies Prisma.JournalEntryInclude;

function sum(amounts: Prisma.Decimal[]): Prisma.Decimal {
  return amounts.reduce((acc, a) => acc.add(a), ZERO);
}
