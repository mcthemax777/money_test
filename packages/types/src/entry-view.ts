/**
 * 전표를 화면용 한 줄로 펴는 규칙.
 *
 * "커피 5,000원 식비 신한카드"를 보여주려면 다리 2~3행을 읽고 어느 쪽이 계좌이고
 * 어느 쪽이 카테고리인지, 이 거래가 지출인지 이체인지를 판별해야 한다. 그 판별이
 * 서버에만 있으면 기기는 오프라인에서 목록을 그릴 수 없다.
 *
 * 그래서 규칙만 여기로 옮긴다. 서버는 Prisma 행을, 기기는 사본의 행을 이 모양으로
 * 맞춰 넣는다. 금액은 `DecInput` 이라 Prisma.Decimal 과 문자열을 함께 받는다.
 */

import { Dec, type DecInput } from './decimal';
import type { AccountType, CategoryType, EntryKind, EntryListItem } from './entities';

/** 판별에 필요한 만큼만 본 다리. */
export interface ViewPosting {
  id: string;
  accountId: string | null;
  categoryId: string | null;
  amount: DecInput;
  currency: string;
  exchangeRate: DecInput;
  baseAmount: DecInput;
  extraAmount: DecInput;
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
  /** 할부 개월수. 일시불이면 null 이다. */
  installmentPlan: { totalMonths: number } | null;
}

export interface ViewEntry {
  id: string;
  date: Date | string;
  description: string;
  merchant: string | null;
  detailedNote: string | null;
  personId: string;
  person: { name: string } | null;
  originalCurrency: string | null;
  originalAmount: DecInput | null;
  rateProvisional: boolean;
  postings: ViewPosting[];
}

/**
 * 저장 통화 -> 표시 통화 환산기.
 *
 * 목록의 금액은 저장 통화(baseAmount)로 계산된다. 화면이 다른 통화로 보고 있으면
 * 여기서 옮긴다. 저장값은 건드리지 않으므로 표시 통화를 바꿔도 원본이 그대로다.
 */
export interface ViewConverter {
  convert(value: Dec): Dec;
  /** 1 저장통화 = rate 표시통화 */
  rate: Dec;
}

export const IDENTITY_CONVERTER: ViewConverter = {
  convert: (value) => value,
  rate: Dec.of(1),
};

/**
 * 전표 종류 판별.
 *
 * 계좌 다리가 2개 이상이면 돈이 계좌 사이를 움직인 것이므로 이체 계열이다.
 * (이체에 수수료가 붙어 지출 카테고리 다리가 함께 있어도 이 규칙이 먼저 적용된다.)
 */
export function classifyEntry(postings: readonly ViewPosting[]): EntryKind {
  const accountPostings = postings.filter((posting) => posting.account);

  if (accountPostings.length >= 2) {
    if (accountPostings.some((posting) => posting.account!.type === 'credit_card')) {
      return 'card_payment';
    }
    if (accountPostings.some((posting) => posting.account!.type === 'opening_balance')) {
      return 'adjustment';
    }
    return 'transfer';
  }

  const categoryPostings = postings.filter((posting) => posting.category);
  if (categoryPostings.some((posting) => posting.category!.type === 'income')) {
    return 'income';
  }
  return 'expense';
}

/** 전표 한 건을 목록 한 줄로. */
export function toListItem(
  entry: ViewEntry,
  show: ViewConverter = IDENTITY_CONVERTER,
): EntryListItem {
  const kind = classifyEntry(entry.postings);
  const categoryPostings = entry.postings.filter((posting) => posting.category);
  const accountPostings = entry.postings.filter((posting) => posting.account);

  const base = (posting: ViewPosting) => Dec.of(posting.baseAmount);

  /*
   * 표시 금액은 항상 양수, 그리고 항상 기준통화(baseAmount)다.
   *
   * 통화별로 쪼개면 목록 소계와 상단 합계가 어긋난다. 원래 통화의 금액은
   * originalCurrency/originalAmount 로 따로 실어 화면이 함께 보여 준다.
   */
  let amount: Dec;
  if (kind === 'expense') {
    amount = Dec.sum(categoryPostings.map(base));
  } else if (kind === 'income') {
    amount = Dec.sum(categoryPostings.map(base)).abs();
  } else {
    // 이체/카드결제/조정은 "받는 쪽"의 금액을 쓴다.
    const incoming = accountPostings.find((posting) => base(posting).isPositive());
    amount = incoming ? base(incoming) : Dec.sum(accountPostings.map(base)).abs();
  }

  // 지출/수입은 카테고리 다리가 주인공이다. 이체 수수료 다리는 대표 카테고리로 쓰지 않는다.
  const primaryCategory =
    kind === 'expense' || kind === 'income' ? categoryPostings[0] ?? null : null;

  // 이체에 붙은 수수료. 이체 자체는 소비가 아니지만 수수료는 지출이므로 따로 보여준다.
  // 수수료가 없어도 0으로 내려보내 화면이 분기하지 않게 한다.
  const feePosting = kind === 'transfer' ? categoryPostings[0] ?? null : null;
  const feeAmount =
    kind === 'transfer'
      ? show.convert(feePosting ? base(feePosting) : Dec.of(0)).toString()
      : null;

  // 돈이 나간 쪽(음수)이 이 거래의 "계좌"다.
  const outgoing =
    accountPostings.find((posting) => base(posting).isNegative()) ?? accountPostings[0] ?? null;
  const incoming = accountPostings.find((posting) => base(posting).isPositive()) ?? null;
  const cardPosting = entry.postings.find((posting) => posting.card) ?? null;

  const isTwoSided = kind === 'transfer' || kind === 'card_payment' || kind === 'adjustment';

  return {
    id: entry.id,
    kind,
    // 와이어 계약은 ISO 문자열이다 (IsoDateString)
    date: entry.date instanceof Date ? entry.date.toISOString() : String(entry.date),
    description: entry.description,
    merchant: entry.merchant,
    detailedNote: entry.detailedNote,
    personId: entry.personId,
    personName: entry.person?.name ?? '',
    amount: show.convert(amount).toString(),
    /*
     * 과소비·추가 수입 금액. 표시 통화로 환산해 위 amount 와 같은 단위로 내보낸다.
     *
     * 이체는 대표 카테고리가 없다. 화면의 과소비 표시는 수수료 다리에 붙으므로
     * 그것을 읽는다 (수정 폼이 이 값을 그대로 되돌려 보내기 때문에, 여기서
     * 놓치면 체크가 풀린다).
     */
    extraAmount: show
      .convert(Dec.of((primaryCategory ?? feePosting)?.extraAmount ?? 0))
      .toString(),
    /*
     * 카테고리 다리 수.
     *
     * 목록 한 줄은 대표 분류 하나만 보여 준다. 그래서 분할 거래를 그 한 줄에서 되돌려
     * 저장하면 나머지 줄이 조용히 사라진다. 편집 화면이 그것을 막으려면 "여럿이었다"는
     * 사실을 알아야 하는데, 다른 필드로는 알 수 없다.
     *
     * 이체는 수수료 다리 하나가 세어진다(1). 카드사 대금 이동은 카테고리가 없어 0이다.
     */
    splitCount: categoryPostings.length,
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
    installmentMonths: cardPosting?.installmentPlan?.totalMonths ?? null,
    feeAmount,
    feeCategoryId: feePosting?.category?.id ?? null,
    feeCategoryName: feePosting?.category?.name ?? null,
    // 카드사 이체의 방향. 부채가 늘면 환불 입금, 줄면 대금 결제다.
    // 수정 폼이 이 값을 그대로 되돌려 보내므로 놓치면 방향이 뒤집힌다.
    cardTransferDirection:
      kind === 'card_payment'
        ? cardLeg(accountPostings) && base(cardLeg(accountPostings)!).isNegative()
          ? 'refund'
          : 'payment'
        : null,
    ...foreignDisplay(entry, outgoing, incoming, kind, show),
    // 환산액이 아직 서버 추정 환율로 만들어져 있다는 표시. 화면은 "잠정"을 붙이고,
    // 카드 화면은 이 값이 true 인 거래만 대조 목록에 모은다.
    rateProvisional: entry.rateProvisional,

    /*
     * 이체로 받은 금액은 받는 계좌의 통화 그대로 실어 준다.
     *
     * 위 `amount` 는 기준통화 환산액이다. 통화가 다른 환전을 수정할 때 그 값을
     * "받은 금액" 칸에 되돌려 넣으면 단위가 뒤바뀐 채 저장된다.
     */
    toAmount: kind === 'transfer' && incoming ? Dec.of(incoming.amount).toString() : null,
    toCurrency: kind === 'transfer' && incoming ? incoming.currency : null,
  };
}

/**
 * 화면에 함께 보여 줄 원래 통화와 금액.
 *
 * 두 갈래가 있다.
 *   - 전표에 originalAmount 가 적혀 있다: 원화 카드로 한 외화 결제.
 *     청구액은 원화라 다리는 전부 원화이고, 원 통화 금액만 여기 남아 있다.
 *   - 계좌 다리 자체가 외화다: 달러 통장에서 쓴 거래.
 *
 * 기준통화 거래는 셋 다 null 이라 화면이 분기하지 않아도 된다.
 */
function foreignDisplay(
  entry: ViewEntry,
  outgoing: ViewPosting | null,
  incoming: ViewPosting | null,
  kind: EntryKind,
  show: ViewConverter,
): { originalCurrency: string | null; originalAmount: string | null; exchangeRate: string | null } {
  if (entry.originalCurrency && entry.originalAmount !== null) {
    const original = Dec.of(entry.originalAmount);
    const leg = outgoing ?? incoming;
    return {
      originalCurrency: entry.originalCurrency,
      originalAmount: original.toString(),
      // 환율도 표시 통화 기준으로 준다. 위 amount 가 표시 통화라
      // 저장 통화 환율을 그대로 주면 둘이 맞지 않는다.
      exchangeRate: leg ? deriveRate(original, show.convert(Dec.of(leg.baseAmount))) : null,
    };
  }

  // 외화 계좌 다리. 수입은 들어온 쪽, 그 밖에는 나간 쪽이 그 거래의 계좌다.
  const leg = kind === 'income' ? incoming : outgoing;
  if (leg) {
    const rate = Dec.of(leg.exchangeRate).times(show.rate);
    if (!rate.eq(1)) {
      return {
        originalCurrency: leg.currency,
        originalAmount: Dec.of(leg.amount).abs().toString(),
        exchangeRate: rate.round(8).toString(),
      };
    }
  }

  return { originalCurrency: null, originalAmount: null, exchangeRate: null };
}

/** 원 통화 금액과 환산액에서 실제 적용된 환율을 되돌린다. */
function deriveRate(original: Dec, base: Dec): string | null {
  if (original.isZero()) return null;
  return base.abs().dividedBy(original.abs(), 8).toString();
}

/** 카드사 이체에서 카드 부채 쪽 다리 */
function cardLeg(accountPostings: readonly ViewPosting[]): ViewPosting | null {
  return accountPostings.find((posting) => posting.account?.type === 'credit_card') ?? null;
}
