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
import type { ParsedEntrySearch } from './entry-search';
import type {
  AccountType,
  CategoryType,
  EntryKind,
  EntryLine,
  EntryListItem,
  EntryTag,
} from './entities';

/** 판별에 필요한 만큼만 본 다리. */
export interface ViewPosting {
  id: string;
  accountId: string | null;
  categoryId: string | null;
  amount: DecInput;
  currency: string;
  exchangeRate: DecInput;
  baseAmount: DecInput;
  cardId: string | null;
  /** 이 줄의 신원. 분류 다리에만 있다. */
  lineKey: string | null;
  /** 이 줄에서 깎인 금액 (입력 통화, 양수). 분류 다리에만 있다. */
  discountAmount?: DecInput | null;
  account: { id: string; name: string; type: AccountType } | null;
  category: {
    id: string;
    name: string;
    type: CategoryType;
    parentId: string | null;
    parent: { id: string; name: string } | null;
  } | null;
  card: { id: string; name: string } | null;
  /** 할부 계획. 일시불이면 null 이다. */
  installmentPlan: {
    totalMonths: number;
    interestBearing: boolean;
    /**
     * 사용자가 적어 둔 회차 원금. 적지 않았으면 null 이다.
     *
     * 서버에서는 JSON 칸이라 무엇이든 들어올 수 있다(`Prisma.JsonValue`). 모양을
     * 가리는 일은 `toShares` 가 한 곳에서 한다.
     */
    principalShares: unknown;
    /**
     * 사용자가 적어 둔 회차별 이자. 유이자 할부에만 있다.
     *
     * 원금과 같은 JSON 칸이라 모양은 `toShares` 가 가린다.
     */
    interestShares?: unknown;
    /** 고정형 유이자 할부의 월 납입액. Prisma.Decimal 이나 문자열로 온다. */
    monthlyPayment?: unknown;
    /** 변동형 유이자 할부의 연이율 (퍼센트). */
    annualRate?: unknown;
  } | null;
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
  /** 이 거래를 카드 실적에 세는가. 옛 전표는 비어 있고, 그때는 센 것으로 본다. */
  countsPerformance?: boolean | null;
  /** 차감액을 실적에서도 뺄지. 옛 전표는 비어 있고, 그때는 뺀 것으로 본다. */
  discountCountsPerformance?: boolean | null;
  /**
   * 이 전표를 마지막으로 고친 편집의 시계.
   *
   * 목록 한 줄에 실어 보내면 수정 폼이 그것을 들고 있다가 저장할 때 되돌려 준다.
   * 서버는 그 사이 다른 사람이 고쳤는지를 그 값으로 안다 (`EntryListItem.updatedHlc`).
   * 아직 시계가 없는 옛 전표와, 시계를 읽지 않는 가벼운 조회는 비워 둔다.
   */
  updatedHlc?: string | null;
  postings: ViewPosting[];
  /**
   * 이 전표에 달린 태그 연결. 서버는 조인 표를 펴서, 기기는 사본의 `entry_tag` 를 읽어 넣는다.
   *
   * **어느 줄의 태그인지가 함께 온다.** `lineKey` 가 있으면 그 분류 줄의 것이고,
   * null 이면 거래 자체의 것이다 (분류 줄이 없는 이체·카드 대금 결제).
   *
   * 없으면 빈 배열이다. 태그를 아직 읽지 않은 자리(가벼운 조회)는 `undefined` 를 두어도
   * 되고, 그때 목록 한 줄은 태그가 없는 것으로 그려진다.
   */
  tags?: Array<EntryTag & { lineKey: string | null }>;
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

/**
 * 이 줄이 지금 화면의 검색 조건에 걸리는가.
 *
 * 조건을 푸는 일은 부르는 쪽이 한다 -- 서버는 파싱한 검색어를, 기기는 사본의 질의를
 * 들고 있고, 여기까지 그 모양을 끌고 오면 규칙이 한 벌로 묶이지 않는다. 이 자리는
 * "걸린 줄만 남긴다"는 표시만 받는다.
 */
export type LineMatcher = (line: {
  categoryId: string | null;
  parentCategoryId: string | null;
  tagIds: readonly string[];
}) => boolean;

/**
 * 전표 한 건을 목록 한 줄로.
 *
 * 분할 거래도 여기서는 한 건이다. 줄로 펴는 일은 화면이 `entryRows` 로 한다 --
 * 자산 탭의 결제내역처럼 계좌 관점으로 보는 화면은 펴지 않아야 하기 때문이다.
 *
 * `matchLine` 을 주면 걸린 줄에만 `matched` 가 선다. 아무 줄도 걸리지 않으면 모두
 * 세운다. 전표 자체는 조건에 걸려서 여기까지 온 것이라(설명 글자나 계좌 조건), 그때
 * 줄을 다 지우면 거래가 통째로 사라진다.
 */
export function toListItem(
  entry: ViewEntry,
  show: ViewConverter = IDENTITY_CONVERTER,
  matchLine?: LineMatcher,
): EntryListItem {
  const kind = classifyEntry(entry.postings);
  const categoryPostings = entry.postings.filter((posting) => posting.category);
  const accountPostings = entry.postings.filter((posting) => posting.account);

  const base = (posting: ViewPosting) => Dec.of(posting.baseAmount);

  /*
   * 깎인 금액은 줄에 적혀 있다. 통화는 사용자가 적은 통화다.
   *
   * 외화로 적은 거래는 `originalAmount` 처럼 그대로 두고, 장부 통화로 적은 거래만
   * 표시 통화로 옮긴다. 옮기지 않으면 원화 가계부에서 달러 값이 원화 자리에 선다.
   */
  const showDiscount = (value: DecInput | null | undefined): Dec | null => {
    if (value === undefined || value === null || value === '') return null;
    const raw = Dec.of(value);
    if (raw.isZero()) return null;
    return entry.originalCurrency ? raw : show.convert(raw);
  };

  // 줄에 붙은 태그와 거래 자체에 붙은 태그를 나눈다.
  const lineTags = new Map<string, EntryTag[]>();
  const entryTags: EntryTag[] = [];
  for (const link of entry.tags ?? []) {
    const tag = { id: link.id, name: link.name, color: link.color };
    if (link.lineKey === null || link.lineKey === undefined) {
      entryTags.push(tag);
      continue;
    }
    const bucket = lineTags.get(link.lineKey);
    if (bucket) bucket.push(tag);
    else lineTags.set(link.lineKey, [tag]);
  }

  const lines: EntryLine[] = categoryPostings.map((posting) => {
    /*
     * 줄 키가 비어 있으면 다리 id 로 물러선다.
     *
     * 마이그레이션이 모든 분류 다리를 채우고 저장 요청도 키 없이는 거절되므로 여기
     * 오는 일은 없다. 그래도 화면이 키 하나 때문에 그려지지 않는 것보다는 낫다.
     */
    const lineKey = posting.lineKey ?? posting.id;
    const tags = lineTags.get(lineKey) ?? [];
    const lineDiscount = showDiscount(posting.discountAmount);
    return {
      lineKey,
      categoryId: posting.category?.id ?? '',
      categoryName: posting.category?.name ?? '',
      parentCategoryId: posting.category?.parent?.id ?? null,
      parentCategoryName: posting.category?.parent?.name ?? null,
      amount: show.convert(base(posting).abs()).toString(),
      discountAmount: lineDiscount ? lineDiscount.toString() : null,
      tags,
      matched: matchLine
        ? matchLine({
            categoryId: posting.category?.id ?? null,
            parentCategoryId: posting.category?.parent?.id ?? null,
            tagIds: tags.map((tag) => tag.id),
          })
        : true,
    };
  });

  // 아무 줄도 걸리지 않았으면 좁히지 않는다. 위 주석 참고.
  if (matchLine && lines.length > 0 && !lines.some((line) => line.matched)) {
    for (const line of lines) line.matched = true;
  }

  // 거래 전체에서 깎인 금액. 줄마다의 값을 그대로 더한다.
  const discount = lines.reduce<Dec | null>((acc, line) => {
    if (!line.discountAmount) return acc;
    const value = Dec.of(line.discountAmount);
    return acc ? acc.plus(value) : value;
  }, null);

  /*
   * 표시 금액은 항상 기준통화(baseAmount)이고 음수가 되지 않는다.
   *
   * 통화별로 쪼개면 목록 소계와 상단 합계가 어긋난다. 원래 통화의 금액은
   * originalCurrency/originalAmount 로 따로 실어 화면이 함께 보여 준다.
   */
  let amount: Dec;
  if (kind === 'expense') {
    // 차감을 뺀 뒤의 값, 곧 실제로 계좌에서 빠진 금액이다. 전액을 깎았으면 0 이다.
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
    // 거래 자체에 붙은 태그. 지출·수입은 언제나 비어 있다 (그쪽은 줄에 붙는다).
    tags: entryTags,
    detailedNote: entry.detailedNote,
    personId: entry.personId,
    personName: entry.person?.name ?? '',
    amount: show.convert(amount).toString(),
    /*
     * 분류 줄 전부. 분할이면 여럿이다.
     *
     * 목록이 줄로 펴는 재료이자 편집 화면이 분할을 되살리는 재료다. 예전에는 대표 분류
     * 하나만 실어 보내고 둘 이상일 때만 `splits` 를 덧붙였는데, 그 한 줄을 폼으로
     * 되돌려 저장하면 나머지가 조용히 사라졌다.
     *
     * 이체는 수수료 줄 하나가 들어가고, 카드사 대금 이동은 분류가 없어 빈 배열이다.
     */
    lines,
    splitCount: lines.length,
    /*
     * 거래 전체에서 깎인 금액. 줄마다의 값을 더한 것이고, 없으면 null 이다.
     *
     * 위 `amount` 는 이미 차감된 뒤의 값이라, 화면이 거래의 정가를 되돌리려면 둘을
     * 더한다. 줄마다의 정가는 `lines[].discountAmount` 로 같은 방식으로 되살린다.
     */
    discountAmount: discount ? discount.toString() : null,
    // 값이 없던 시절의 전표는 센 것으로 본다. 그때는 모든 카드 거래가 실적에 들어갔다.
    countsPerformance: entry.countsPerformance ?? true,
    // 값이 없던 시절의 전표는 차감이 실적을 함께 깎고 있었다.
    discountCountsPerformance: entry.discountCountsPerformance ?? true,
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
    installmentInterest: cardPosting?.installmentPlan?.interestBearing ?? null,
    installmentShares: toShares(cardPosting?.installmentPlan?.principalShares),
    installmentInterestShares: toShares(cardPosting?.installmentPlan?.interestShares),
    installmentMonthlyPayment: toAmount(cardPosting?.installmentPlan?.monthlyPayment),
    installmentAnnualRate: toAmount(cardPosting?.installmentPlan?.annualRate),
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
    // 수정 폼이 들고 있다가 저장할 때 되돌려 주는 값. 그 사이의 편집을 서버가 알아챈다.
    updatedHlc: entry.updatedHlc ?? null,
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


/**
 * 검색 조건에 걸리는 **줄**인지 보는 판정기.
 *
 * 질의 자체는 전표 수준으로 건다 (`entrySearchConditions` 머리말). 그래서 여행경비로
 * 찾아도 식비가 섞인 그 전표가 통째로 걸려 온다. 그 다음이 이 판정기의 일이다 --
 * 걸려 온 전표에서 **실제로 조건에 맞는 줄만** 남긴다. 목록은 그 줄만 그리고, 리포트는
 * 그 줄만 더한다. 둘이 같은 함수를 쓰므로 화면의 합과 리포트의 합이 어긋나지 않는다.
 *
 * 줄 수준 조건이 하나도 없으면 undefined 를 준다. 그때는 거르지 않는다 -- 날짜나
 * 설명 글자로만 찾은 목록에서 분할 거래의 한 줄이 사라지면 그것이 오히려 이상하다.
 *
 * 무리가 여럿이면 **모두** 만족해야 한다 (질의가 AND 로 잇는 것과 같은 규칙이다).
 */
export function lineMatcherOf(search: ParsedEntrySearch): LineMatcher | undefined {
  const categoryIds = new Set(search.categoryIds ?? []);
  const categorySelfIds = new Set(search.categorySelfIds ?? []);
  const tagIds = new Set(search.tagIds ?? []);
  const noTag = search.noTag === true;

  const byCategory = categoryIds.size > 0 || categorySelfIds.size > 0;
  const byTag = tagIds.size > 0 || noTag;
  if (!byCategory && !byTag) return undefined;

  return (line) => {
    if (byCategory) {
      // 대분류를 고르면 소분류까지. 직접 지정(미분류)은 그 분류에 바로 적은 줄만.
      const hit =
        (line.categoryId !== null &&
          (categoryIds.has(line.categoryId) || categorySelfIds.has(line.categoryId))) ||
        (line.parentCategoryId !== null && categoryIds.has(line.parentCategoryId));
      if (!hit) return false;
    }
    if (byTag) {
      const hit =
        (noTag && line.tagIds.length === 0) || line.tagIds.some((id) => tagIds.has(id));
      if (!hit) return false;
    }
    return true;
  };
}

/**
 * 계획에 적힌 회차 원금을 문자열 배열로 가린다.
 *
 * JSON 칸이라 무엇이든 들어올 수 있다. 모양이 아니면 없는 것으로 본다 -- 그때는 화면이
 * 개월수로 나눈 기본값을 보여 주므로 빈 목록보다 낫다.
 */
function toShares(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.map((share) => String(share));
}

/**
 * 계획에 적힌 금액 한 칸을 문자열로 가린다.
 *
 * 서버에서는 Prisma.Decimal 이고 기기 사본에서는 문자열이나 숫자다. 없으면 null 이라,
 * 그때는 사용자가 이자를 손으로 적었거나 무이자 할부다.
 */
function toAmount(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text === '' ? null : text;
}
