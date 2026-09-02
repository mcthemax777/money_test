/**
 * 화면 개념(지출·수입·이체·카드대금)을 전표로 번역하는 규칙.
 *
 * 지금까지 이 번역은 서버의 LedgerService 안에 있었고, 그래서 기기는 오프라인에서
 * 거래를 적을 수 없었다. 다리를 만들 줄 모르면 사본에 넣을 것이 없기 때문이다.
 * 2단계는 기기가 자기 저장소에 먼저 커밋하고 그 사실을 서버에 알리는 구조라
 * (설계 문서의 D3), 이 규칙이 양쪽에 다 있어야 한다.
 *
 * **읽는 일과 만드는 일을 갈라 두는 것이 이 파일의 핵심이다.** 조립에 필요한 것은
 * 다섯 가지뿐이다 — 저장 통화, 환율, 계좌, 카드, 카테고리. 그 다섯을 `LedgerLookup`
 * 으로 받으면 나머지는 순수 계산이 된다. 서버는 Prisma 로, 기기는 사본으로 그 창구를
 * 채운다. 규칙 자체는 한 벌이다.
 *
 * 금액은 `Dec` 로 다룬다. 서버가 넘기는 Prisma.Decimal 은 toString() 이 정확하므로
 * 값이 상하지 않는다 (ledger-rules.ts 가 같은 이유로 DecInput 을 받는다).
 *
 * 부호 규칙은 schema.prisma 머리말과 같다. 지출 카테고리 +, 자산 감소 -,
 * 수입 카테고리 -, 자산 증가 +. 균형은 언제나 기준통화 환산액(baseAmount)으로 본다.
 */

import { Dec, type DecInput } from './decimal';
import { currencyDecimals, isCurrencyCode, SUPPORTED_CURRENCIES } from './currency';
import type {
  AccountType,
  CardTransferDirection,
  CardType,
  CategoryType,
  EntryKind,
} from './entities';

const ZERO = Dec.of(0);
const ONE = Dec.of(1);

/**
 * 조립이 거절한 이유.
 *
 * 값으로 돌려주지 않고 던지는 것은 실패 지점이 스무 곳 가까이 되어서다. 부르는 쪽이
 * 잡아 자기 계층의 예외로 바꾼다 — 서버는 400/404 로, 기기는 입력 화면의 문구로.
 */
export class LedgerBuildError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** 서버가 404 로 낼 것인지. 없는 것을 가리킨 경우다. */
    readonly notFound = false,
  ) {
    super(message);
    this.name = 'LedgerBuildError';
  }
}

const fail = (code: string, message: string, notFound = false): never => {
  throw new LedgerBuildError(code, message, notFound);
};

// ───────────────────────────────────────────
// 조립이 읽는 것
// ───────────────────────────────────────────

export interface LookupAccount {
  id: string;
  projectId: string;
  type: AccountType;
  currency: string;
}

export interface LookupCard {
  id: string;
  projectId: string;
  cardType: CardType;
  paymentAccountId: string;
  liabilityAccountId: string | null;
}

export interface LookupCategory {
  id: string;
  projectId: string;
  name: string;
  type: CategoryType;
  defaultIsExtra: boolean;
}

/**
 * 조립에 필요한 읽기 창구.
 *
 * 없는 것은 null 로 돌려준다. "없다"를 오류로 바꾸는 일은 조립이 한다 — 자리마다
 * 문구가 다르고(계좌·카드·카테고리), 그 문구는 규칙의 일부다.
 */
export interface LedgerLookup {
  /** 저장 통화. 표시 통화가 아니다. */
  ledgerCurrency(projectId: string): Promise<string>;
  /** 1 from = ? to. 같은 통화면 1. */
  rate(projectId: string, from: string, to: string): Promise<Dec>;
  account(projectId: string, accountId: string): Promise<LookupAccount | null>;
  card(projectId: string, cardId: string): Promise<LookupCard | null>;
  /** 이 계좌를 부채 계정으로 쓰는 신용카드의 id. 없으면 null. */
  cardIdForLiability(projectId: string, accountId: string): Promise<string | null>;
  categories(projectId: string, ids: readonly string[]): Promise<LookupCategory[]>;
}

// ───────────────────────────────────────────
// 조립 결과
// ───────────────────────────────────────────

export interface BuiltPosting {
  accountId?: string;
  categoryId?: string;
  amount: Dec;
  quantity?: Dec;
  currency: string;
  /** 1 currency = exchangeRate 기준통화 */
  exchangeRate: Dec;
  baseAmount: Dec;
  /** 카테고리 다리에서 과소비·추가 수입으로 센 금액 (기준통화). 생략하면 0 */
  extraAmount?: Dec;
  cardId?: string;
}

export interface BuiltEntry {
  projectId: string;
  personId: string;
  date: Date;
  description: string;
  merchant?: string | null;
  detailedNote?: string | null;
  postings: BuiltPosting[];
  originalCurrency?: string | null;
  originalAmount?: Dec | null;
  rateProvisional?: boolean;
  /** 할부 개월수. 신용카드 지출에만 붙는다. */
  installmentMonths?: number;
}

/** 카테고리 한 줄. 분할이면 여럿이다. */
export interface CategoryLine {
  categoryId: string;
  amount: DecInput;
  extraAmount?: DecInput;
}

interface CommonBuildInput {
  projectId: string;
  personId: string;
  date: Date;
  description: string;
  merchant?: string | null;
  detailedNote?: string | null;
  /** 사용자가 입력한 통화. 생략하면 계좌 통화로 본다. */
  currency?: string;
  /** 1 currency = exchangeRate 기준통화. 생략하면 창구의 환율을 쓴다. */
  exchangeRate?: DecInput;
  /** 기준통화로 실제 청구된 총액. 주면 환율보다 우선한다. */
  billedAmount?: DecInput;
}

export interface ExpenseBuildInput extends CommonBuildInput {
  lines: CategoryLine[];
  /** accountId 와 cardId 중 정확히 하나 */
  accountId?: string;
  cardId?: string;
  installmentMonths?: number;
}

export interface IncomeBuildInput extends CommonBuildInput {
  lines: CategoryLine[];
  accountId: string;
}

export interface TransferBuildInput extends CommonBuildInput {
  fromAccountId: string;
  toAccountId: string;
  amount: DecInput;
  /** 받는 계좌에 실제로 들어온 금액 (받는 계좌 통화) */
  toAmount?: DecInput;
  feeAmount?: DecInput;
  feeCategoryId?: string;
  feeExtraAmount?: DecInput;
}

export interface CardTransferBuildInput extends CommonBuildInput {
  cardId: string;
  accountId: string;
  amount: DecInput;
  direction: CardTransferDirection;
}

// ───────────────────────────────────────────
// 조립
// ───────────────────────────────────────────

/**
 * 지출.
 *
 * 사용자는 결제한 통화로 금액을 입력한다. 카테고리 다리는 언제나 기준통화로 남는데,
 * 그래야 "8월 식비"가 통화별로 쪼개지지 않는다.
 *
 * 자금이 빠지는 계좌 다리는 두 가지로 갈린다.
 *   - 계좌 통화 == 입력 통화 : 달러 통장에서 달러로 결제. 계좌 다리도 외화다.
 *   - 계좌 통화 == 기준통화  : 원화 카드로 달러 결제. 청구되는 돈은 원화이므로
 *     계좌 다리는 원화이고, "$50를 썼다"는 사실은 전표에 따로 적는다.
 */
export async function buildExpense(
  input: ExpenseBuildInput,
  lookup: LedgerLookup,
): Promise<BuiltEntry> {
  const lines = await resolveLines(input.projectId, input.lines, 'expense', lookup);
  const source = await resolvePaymentSource(input.projectId, input, lookup);
  const account = await requireAccount(input.projectId, source.accountId, lookup);
  const { base, entered, rate, estimatedRate } = await resolveConversion(
    input.projectId,
    input.currency,
    account.currency,
    input.exchangeRate,
    lookup,
  );

  const enteredTotal = sum(lines.map((line) => line.amount));
  const billed = resolveBilled(input.billedAmount, entered, account.currency, base);
  const baseLines = toBaseLines(lines, rate, base, billed);
  const baseTotal = sum(baseLines.map((line) => line.baseAmount));
  const foreign = foreignNote(entered, account.currency, base, enteredTotal);
  // 청구액을 받았으면 추정이 아니다. 확정된 금액 그대로 들어간다.
  const provisional = foreign.originalCurrency !== undefined && estimatedRate && !billed;
  assertCanEstimate(provisional, source.isCreditCard, base);
  assertCanInstall(input.installmentMonths, source.isCreditCard);

  return {
    ...common(input),
    ...foreign,
    rateProvisional: provisional,
    installmentMonths: input.installmentMonths,
    postings: [
      // 지출 발생 = + (언제나 기준통화)
      ...baseLines.map((line) =>
        baseLeg(
          {
            categoryId: line.categoryId,
            extraAmount: toExtraBase(line.extraAmount, line.amount, line.baseAmount),
          },
          line.baseAmount,
          base,
        ),
      ),
      // 자산 감소 또는 부채 증가 = -
      paymentLeg(source, account.currency, entered, rate, base, enteredTotal, baseTotal),
    ],
  };
}

/** 수입. 수입 카테고리는 -, 입금 계좌는 +. */
export async function buildIncome(
  input: IncomeBuildInput,
  lookup: LedgerLookup,
): Promise<BuiltEntry> {
  const lines = await resolveLines(input.projectId, input.lines, 'income', lookup);
  const account = await requireAccount(input.projectId, input.accountId, lookup);
  const { base, entered, rate, estimatedRate } = await resolveConversion(
    input.projectId,
    input.currency,
    account.currency,
    input.exchangeRate,
    lookup,
  );

  const enteredTotal = sum(lines.map((line) => line.amount));
  const billed = resolveBilled(input.billedAmount, entered, account.currency, base);
  const baseLines = toBaseLines(lines, rate, base, billed);
  const baseTotal = sum(baseLines.map((line) => line.baseAmount));

  /*
   * 수입 다리는 부호만 반대다. 지출과 같은 규칙을 쓰도록 paymentLeg 를 재사용하고
   * 마지막에 뒤집는다. 계좌가 외화인 경우의 환산 규칙이 한 곳에만 있어야 한다.
   */
  const outgoing = paymentLeg(
    { accountId: account.id },
    account.currency,
    entered,
    rate,
    base,
    enteredTotal,
    baseTotal,
  );

  const foreign = foreignNote(entered, account.currency, base, enteredTotal);

  /*
   * 수입은 통장으로 바로 들어온다. 신용카드가 없으므로 추정으로 남길 수 없다.
   *
   * 확정할 자리가 없기 때문이다. 카드 대조 화면은 신용카드 전용이라 통장 거래는 거기
   * 올라오지 않고, 그러면 틀린 환산액이 고칠 길 없이 남는다.
   */
  assertCanEstimate(
    foreign.originalCurrency !== undefined && estimatedRate && !billed,
    false,
    base,
  );

  return {
    ...common(input),
    ...foreign,
    // 수입에는 확정을 기다리는 값이 없다. 위에서 추정을 이미 막았다.
    rateProvisional: false,
    postings: [
      ...baseLines.map((line) =>
        baseLeg(
          {
            categoryId: line.categoryId,
            extraAmount: toExtraBase(line.extraAmount, line.amount, line.baseAmount),
          },
          line.baseAmount.negated(),
          base,
        ),
      ),
      { ...outgoing, amount: outgoing.amount.negated(), baseAmount: outgoing.baseAmount.negated() },
    ],
  };
}

/**
 * 이체.
 *
 * 보내는 쪽 금액을 기준통화로 환산한 값이 이 전표의 크기다. 받는 쪽은 그 값을 그대로
 * 받는다(환산액이 같아야 균형이 맞는다). 그래서 환전에서 실현되는 환차손익을 따로
 * 잡지 않는다. $50를 보내 ₩67,500을 받았다면 그 거래의 실효 환율이 1350이었다고
 * 기록될 뿐이고, 보유 외화의 평가손익은 순자산에서 미실현으로 따로 보인다.
 */
export async function buildTransfer(
  input: TransferBuildInput,
  lookup: LedgerLookup,
): Promise<BuiltEntry> {
  if (input.fromAccountId === input.toAccountId) {
    fail('TRANSFER_SAME_ACCOUNT', '보내는 계좌와 받는 계좌가 같습니다.');
  }
  const amount = Dec.of(input.amount);
  if (amount.lte(ZERO)) fail('TRANSFER_AMOUNT_INVALID', '이체 금액은 0보다 커야 합니다.');

  const fee = input.feeAmount === undefined ? ZERO : Dec.of(input.feeAmount);
  if (fee.gt(ZERO) && !input.feeCategoryId) {
    fail('TRANSFER_FEE_CATEGORY_REQUIRED', '수수료를 입력하려면 수수료 카테고리가 필요합니다.');
  }

  const from = await requireAccount(input.projectId, input.fromAccountId, lookup);
  const to = await requireAccount(input.projectId, input.toAccountId, lookup);

  // 카드가 끼면 그 다리에 cardId 를 채운다. 비워 두면 카드별 거래 조회에서 빠진다.
  const fromCardId = await cardIdForLiability(input.projectId, from, lookup);
  const toCardId = await cardIdForLiability(input.projectId, to, lookup);

  if (fee.gt(ZERO) && (fromCardId || toCardId)) {
    /*
     * 수수료 다리는 지출 카테고리라 전표가 3-leg 이 되는데, 카드가 끼면 이 전표는
     * card_payment 로 분류되어 목록이 수수료를 보여주지 않는다. 표시가 어긋나느니 막는다.
     */
    fail('TRANSFER_CARD_FEE', '카드사와의 이체에는 수수료를 붙일 수 없습니다.');
  }

  const base = await lookup.ledgerCurrency(input.projectId);
  const fromRate =
    input.exchangeRate === undefined
      ? await lookup.rate(input.projectId, assertCurrency(from.currency, '보내는 계좌 통화'), base)
      : Dec.of(input.exchangeRate);

  const sentBase = toBase(amount, fromRate, base);
  const feeBase = fee.gt(ZERO) ? toBase(fee, fromRate, base) : ZERO;

  // 받는 금액. 통화가 같으면 보낸 금액 그대로다. 다르면 사용자가 실제로 받은 금액을
  // 적고, 없으면 창구의 환율로 되돌려 계산한다.
  let received = input.toAmount === undefined ? undefined : Dec.of(input.toAmount);
  if (received === undefined) {
    if (to.currency === from.currency) {
      received = amount;
    } else {
      const toRate = await lookup.rate(
        input.projectId,
        assertCurrency(to.currency, '받는 계좌 통화'),
        base,
      );
      received = sentBase.dividedBy(toRate, currencyDecimals(to.currency));
    }
  }
  if (received.lte(ZERO)) fail('TRANSFER_RECEIVED_INVALID', '받는 금액은 0보다 커야 합니다.');

  const postings: BuiltPosting[] = [
    {
      accountId: input.fromAccountId,
      amount: amount.plus(fee).negated(),
      currency: from.currency,
      exchangeRate: fromRate,
      baseAmount: sentBase.plus(feeBase).negated(),
      ...(fromCardId ? { cardId: fromCardId } : {}),
    },
    {
      accountId: input.toAccountId,
      amount: received,
      currency: to.currency,
      // 실효 환율. 받은 금액과 환산액에서 역산되므로 창구의 환율과 다를 수 있다.
      exchangeRate: sentBase.dividedBy(received, 8),
      baseAmount: sentBase,
      ...(toCardId ? { cardId: toCardId } : {}),
    },
  ];

  if (fee.gt(ZERO)) {
    /*
     * 수수료도 지출 카테고리 다리다. 지출·수입과 같은 검증을 거쳐야 다른 프로젝트의
     * 카테고리나 수입 카테고리가 수수료 자리에 들어오지 않는다. 과소비 기본값도
     * 여기서 카테고리에서 가져온다.
     */
    const [line] = await resolveLines(
      input.projectId,
      [{ categoryId: input.feeCategoryId!, amount: fee, extraAmount: input.feeExtraAmount }],
      'expense',
      lookup,
    );
    postings.push(
      baseLeg(
        {
          categoryId: line.categoryId,
          extraAmount: toExtraBase(line.extraAmount, line.amount, feeBase),
        },
        feeBase,
        base,
      ),
    );
  }

  return { ...common(input), postings };
}

/**
 * 카드사와 통장 사이의 자금 이동.
 *
 * 지출이 아니라 부채의 증감이므로 카테고리 다리가 없다. 이것이 사용액과 대금 결제가
 * 이중으로 세어지지 않는 이유다.
 *
 * 금액에 상한을 두지 않는다. 카드사가 남은 대금보다 많이 가져가고 차액을 따로 입금해
 * 주는 방식이 실제로 있어서, 그 사이 부채는 양수로 남아야 한다.
 */
export async function buildCardTransfer(
  input: CardTransferBuildInput,
  lookup: LedgerLookup,
): Promise<BuiltEntry> {
  const amount = Dec.of(input.amount);
  if (amount.lte(ZERO)) fail('CARD_TRANSFER_AMOUNT_INVALID', '금액은 0보다 커야 합니다.');

  const card = await requireCard(input.projectId, input.cardId, lookup);
  if (card.cardType !== 'credit') {
    fail('CARD_TRANSFER_CREDIT_ONLY', '신용카드만 대금 이동 대상입니다.');
  }
  if (!card.liabilityAccountId) {
    fail('CARD_NO_LIABILITY', '신용카드에 부채 계정이 없습니다.');
  }

  const account = await requireAccount(input.projectId, input.accountId, lookup);
  const liability = await requireAccount(input.projectId, card.liabilityAccountId!, lookup);

  // 부채 계정은 결제 통장과 같은 통화로 만들어진다(createCard). 어긋나 있으면 환산
  // 규칙이 애매해지므로 여기서 막는다.
  if (liability.currency !== account.currency) {
    fail('CARD_CURRENCY_MISMATCH', '카드 부채 계정과 결제 통장의 통화가 다릅니다.');
  }

  const { base, rate } = await resolveConversion(
    input.projectId,
    account.currency,
    account.currency,
    input.exchangeRate,
    lookup,
  );

  // 결제는 통장에서 나가고 부채가 줄어든다. 환불 입금은 정반대다.
  const toBank = input.direction === 'refund' ? amount : amount.negated();
  const toBankBase = toBase(toBank, rate, base);

  return {
    ...common(input),
    postings: [
      {
        accountId: input.accountId,
        amount: toBank,
        currency: account.currency,
        exchangeRate: rate,
        baseAmount: toBankBase,
      },
      {
        accountId: card.liabilityAccountId!,
        amount: toBank.negated(),
        currency: liability.currency,
        exchangeRate: rate,
        baseAmount: toBankBase.negated(),
        cardId: card.id,
      },
    ],
  };
}

/**
 * 화면 개념(kind)을 전표로 번역한다.
 *
 * 서버의 entries.service 와 기기의 명령 재생이 함께 부르는 입구다. 갈래마다 무엇이
 * 필수인지가 여기서 한 번만 정해진다.
 */
export interface EntryBuildRequest extends CommonBuildInput {
  kind: EntryKind | string;
  amount?: DecInput;
  categoryId?: string;
  extraAmount?: DecInput;
  splits?: Array<{ categoryId: string; amount: DecInput; extraAmount?: DecInput }>;
  accountId?: string;
  toAccountId?: string;
  cardId?: string;
  installmentMonths?: number;
  toAmount?: DecInput;
  transferFee?: DecInput;
  transferFeeCategoryId?: string;
  cardTransferDirection?: CardTransferDirection;
}

export async function buildEntry(
  request: EntryBuildRequest,
  lookup: LedgerLookup,
): Promise<BuiltEntry> {
  switch (request.kind) {
    case 'expense':
      return buildExpense(
        {
          ...request,
          lines: resolveRequestLines(request),
          accountId: request.accountId,
          cardId: request.cardId,
          installmentMonths: request.installmentMonths,
        },
        lookup,
      );

    case 'income':
      if (!request.accountId) fail('INCOME_ACCOUNT_REQUIRED', '수입은 입금 계좌가 필요합니다.');
      return buildIncome(
        { ...request, lines: resolveRequestLines(request), accountId: request.accountId! },
        lookup,
      );

    case 'transfer':
      if (!request.accountId || !request.toAccountId) {
        fail('TRANSFER_ACCOUNTS_REQUIRED', '이체는 보내는 계좌와 받는 계좌가 필요합니다.');
      }
      return buildTransfer(
        {
          ...request,
          fromAccountId: request.accountId!,
          toAccountId: request.toAccountId!,
          amount: requireAmount(request.amount, '이체 금액'),
          toAmount: request.toAmount,
          feeAmount: request.transferFee,
          feeCategoryId: request.transferFeeCategoryId,
          // 이체에서 화면의 과소비 표시는 수수료 카테고리에 붙는다 (이체 자체는 지출이 아니다).
          feeExtraAmount: request.extraAmount,
        },
        lookup,
      );

    case 'card_payment':
      if (!request.accountId || !request.cardId) {
        fail('CARD_PAYMENT_REQUIRED', '카드사 이체는 통장과 카드가 필요합니다.');
      }
      return buildCardTransfer(
        {
          ...request,
          cardId: request.cardId!,
          accountId: request.accountId!,
          amount: requireAmount(request.amount, '카드 대금'),
          direction: request.cardTransferDirection ?? 'payment',
        },
        lookup,
      );

    default:
      return fail('ENTRY_KIND_UNKNOWN', `알 수 없는 거래 종류입니다: ${request.kind}`);
  }
}

/** 분할이 있으면 그것을, 없으면 단일 카테고리를 한 줄짜리 분할로 취급한다. */
function resolveRequestLines(request: EntryBuildRequest): CategoryLine[] {
  if (request.splits?.length) {
    return request.splits.map((split) => ({
      categoryId: split.categoryId,
      amount: split.amount,
      extraAmount: split.extraAmount,
    }));
  }

  if (!request.categoryId) fail('CATEGORY_REQUIRED', '카테고리를 지정해야 합니다.');

  return [
    {
      categoryId: request.categoryId!,
      amount: requireAmount(request.amount, '금액'),
      extraAmount: request.extraAmount,
    },
  ];
}

function requireAmount(value: DecInput | undefined, label: string): Dec {
  if (value === undefined || value === null || value === '') {
    fail('AMOUNT_REQUIRED', `${label}을(를) 입력해 주세요.`);
  }
  return Dec.of(value!);
}

// ───────────────────────────────────────────
// 조립 헬퍼
// ───────────────────────────────────────────

function common(input: CommonBuildInput & { personId: string }) {
  return {
    projectId: input.projectId,
    personId: input.personId,
    date: input.date,
    description: input.description,
    merchant: input.merchant ?? null,
    detailedNote: input.detailedNote ?? null,
  };
}

/**
 * 결제수단 다리 하나.
 *
 * 계좌 통화가 입력 통화와 같으면 입력한 금액이 그대로 빠진다. 다르면(원화 카드로
 * 외화 결제) 실제로 청구되는 환산액이 빠진다. 그 밖의 조합은 다루지 않는다.
 */
function paymentLeg(
  source: { accountId: string; cardId?: string },
  accountCurrency: string,
  entered: string,
  rate: Dec,
  base: string,
  enteredTotal: Dec,
  baseTotal: Dec,
): BuiltPosting {
  if (accountCurrency === entered) {
    return {
      accountId: source.accountId,
      ...(source.cardId ? { cardId: source.cardId } : {}),
      amount: enteredTotal.negated(),
      currency: entered,
      exchangeRate: rate,
      // 카테고리 쪽 합계를 그대로 뒤집는다. 다시 곱하면 반올림 때문에 합계가 0에서 벗어난다.
      baseAmount: baseTotal.negated(),
    };
  }

  if (accountCurrency === base) {
    return baseLeg(
      { accountId: source.accountId, ...(source.cardId ? { cardId: source.cardId } : {}) },
      baseTotal.negated(),
      base,
    );
  }

  return fail(
    'CURRENCY_COMBINATION_UNSUPPORTED',
    `${accountCurrency} 계좌에 ${entered}로 결제한 내역은 아직 기록할 수 없습니다.`,
  );
}

/**
 * 원 통화 표시 정보.
 *
 * 계좌 통화와 입력 통화가 다를 때만 남긴다. 계좌가 이미 외화면 다리에 통화가 들어
 * 있으므로 중복이다.
 */
function foreignNote(
  entered: string,
  accountCurrency: string,
  base: string,
  enteredTotal: Dec,
): { originalCurrency?: string; originalAmount?: Dec } {
  if (entered === accountCurrency || entered === base) return {};
  return { originalCurrency: entered, originalAmount: enteredTotal };
}

/** 기준통화로 기록되는 다리 (카테고리, 자본 계정) */
function baseLeg(
  target: { accountId?: string; categoryId?: string; cardId?: string; extraAmount?: Dec },
  amount: Dec,
  base: string,
): BuiltPosting {
  return {
    ...target,
    amount,
    currency: base,
    exchangeRate: ONE,
    baseAmount: amount,
  };
}

async function resolveConversion(
  projectId: string,
  enteredCurrency: string | undefined,
  accountCurrency: string,
  explicitRate: DecInput | undefined,
  lookup: LedgerLookup,
): Promise<{ base: string; entered: string; rate: Dec; estimatedRate: boolean }> {
  // 저장 통화다. 표시 통화가 아니다. 표시 통화는 언제든 바뀌므로 원장이 그것을
  // 기준으로 값을 만들면 나중에 저장값을 다시 계산해야 한다.
  const base = await lookup.ledgerCurrency(projectId);
  const entered = assertCurrency(enteredCurrency ?? accountCurrency, '입력 통화');

  if (explicitRate !== undefined) {
    const rate = Dec.of(explicitRate);
    if (rate.lte(ZERO)) fail('RATE_INVALID', '환율은 0보다 커야 합니다.');
    return { base, entered, rate, estimatedRate: false };
  }

  // 사용자가 환율을 넣지 않았다면 이 환산액은 추정이다. 원화 카드의 외화 결제라면
  // 실제 청구액은 결제일에 정해지므로, 그 사실을 전표에 남겨야 한다.
  return {
    base,
    entered,
    rate: await lookup.rate(projectId, entered, base),
    estimatedRate: true,
  };
}

/**
 * 사용자가 넘긴 청구액을 검증한다.
 *
 * 쓸 수 있는 자리가 좁다. 원화 카드로 달러를 결제한 경우처럼 "계좌는 기준통화, 입력은
 * 외화"일 때만 통장에서 빠진 금액이 따로 존재한다. 달러 통장에서 달러를 쓴 거래에는
 * 그런 금액이 없고, 기준통화 거래는 금액 자체가 청구액이다. 두 경우에 값이 오면
 * 조용히 무시하지 않고 막는다.
 */
function resolveBilled(
  value: DecInput | undefined,
  entered: string,
  accountCurrency: string,
  base: string,
): Dec | null {
  if (value === undefined) return null;

  if (entered === base) {
    fail('BILLED_NOT_APPLICABLE', '기준통화 거래에는 청구액을 따로 넣지 않습니다.');
  }
  if (accountCurrency !== base) {
    fail(
      'BILLED_NOT_APPLICABLE',
      `${accountCurrency} 계좌 거래에는 청구액을 따로 넣지 않습니다. 계좌 통화 금액이 그대로 기록됩니다.`,
    );
  }
  const billed = Dec.of(value);
  if (billed.lte(ZERO)) fail('BILLED_INVALID', '청구액은 0보다 커야 합니다.');
  return billed;
}

/**
 * 추정으로 남겨도 되는 거래인지 확인한다.
 *
 * 청구액이 나중에 정해지는 것은 신용카드뿐이다. 통장이나 체크카드는 결제하는 그 자리에서
 * 돈이 빠지므로 사용자가 실제 금액을 안다. 그런데도 창구의 환율로 추정해 두면 확정할
 * 자리도 없이 틀린 금액이 남는다. 카드 대조 화면은 신용카드 전용이기 때문이다.
 */
function assertCanEstimate(provisional: boolean, isCreditCard: boolean, base: string) {
  if (!provisional || isCreditCard) return;
  fail(
    'RATE_ESTIMATE_NOT_ALLOWED',
    `실제로 빠진 ${base} 금액을 입력해 주세요. 청구액을 나중에 확정하는 것은 신용카드 결제만 됩니다.`,
  );
}

/**
 * 할부를 붙일 수 있는 결제수단인지.
 *
 * 신용카드만 된다. 나눌 수 있는 것은 카드사에 갚을 빚이고, 체크카드와 통장은 결제하는
 * 자리에서 돈이 빠져 나눌 청구가 없다.
 */
function assertCanInstall(months: number | undefined, isCreditCard: boolean) {
  if (!months || months < 2 || isCreditCard) return;
  fail('INSTALLMENT_CREDIT_ONLY', '할부는 신용카드 지출에만 설정할 수 있습니다.');
}

/**
 * 줄마다의 기준통화 환산액.
 *
 * 청구액을 알면 그것이 사실이므로 환율을 곱하지 않고 줄 비율대로 나눈다. 곱해서 만들면
 * 줄마다 반올림이 붙어 합계가 청구액에서 1원씩 벗어난다.
 */
function toBaseLines<T extends { amount: Dec }>(
  lines: T[],
  rate: Dec,
  base: string,
  billed: Dec | null,
): Array<T & { baseAmount: Dec }> {
  if (!billed) {
    // 반올림은 줄마다 따로 한다. 합쳐서 한 번 반올림하면 각 줄의 표시액과 카테고리
    // 합계가 1원씩 어긋난다.
    return lines.map((line) => ({ ...line, baseAmount: toBase(line.amount, rate, base) }));
  }

  const shares = allocate(billed, lines.map((line) => line.amount), currencyDecimals(base));
  return lines.map((line, index) => ({ ...line, baseAmount: shares[index] }));
}

/**
 * 과소비 금액을 기준통화로 옮긴다.
 *
 * 환율을 다시 곱하지 않고 그 줄이 이미 얻은 환산액에 비율을 건다. 전액을 과소비로
 * 적었으면 환산액도 전액이 되어 "일반 지출 0원"이 정확히 맞는다.
 */
function toExtraBase(extra: Dec, amount: Dec, baseAmount: Dec): Dec {
  if (extra.lte(ZERO)) return ZERO;
  if (extra.gte(amount)) return baseAmount;
  return baseAmount.times(extra).dividedBy(amount, 4);
}

/** 기준통화 자릿수로 반올림. 원·엔은 소수를 쓰지 않는다. */
function toBase(amount: Dec, rate: Dec, base: string): Dec {
  return amount.times(rate).round(currencyDecimals(base));
}

/**
 * 총액을 가중치대로 나눈다. 끝수는 첫 줄에 몰아준다.
 *
 * 내림으로 자른 뒤 남은 것을 첫 줄에 더하므로 합계가 총액과 정확히 같다.
 */
function allocate(total: Dec, weights: Dec[], decimals: number): Dec[] {
  if (weights.length === 0) return [];
  if (weights.length === 1) return [total];

  const weightSum = sum(weights);
  const shares = weights.map((weight) =>
    total.times(weight).dividedBy(weightSum, decimals, 'down'),
  );
  shares[0] = shares[0].plus(total.minus(sum(shares)));
  return shares;
}

function sum(amounts: Dec[]): Dec {
  return amounts.reduce((acc, amount) => acc.plus(amount), ZERO);
}

async function resolveLines(
  projectId: string,
  lines: readonly CategoryLine[],
  expectedType: 'income' | 'expense',
  lookup: LedgerLookup,
): Promise<Array<{ categoryId: string; amount: Dec; extraAmount: Dec }>> {
  if (lines.length === 0) fail('CATEGORY_REQUIRED', '카테고리를 최소 하나 지정해야 합니다.');

  const found = await lookup.categories(projectId, lines.map((line) => line.categoryId));
  const byId = new Map(found.map((category) => [category.id, category]));

  return lines.map((line) => {
    const category = byId.get(line.categoryId);
    if (!category) {
      fail('CATEGORY_NOT_FOUND', `카테고리를 찾을 수 없습니다: ${line.categoryId}`, true);
    }
    if (category!.type !== expectedType) {
      fail(
        'CATEGORY_TYPE_MISMATCH',
        `${expectedType === 'expense' ? '지출' : '수입'}에 ${category!.type} 카테고리를 쓸 수 없습니다: ${category!.name}`,
      );
    }

    const amount = Dec.of(line.amount);
    if (amount.lte(ZERO)) fail('AMOUNT_INVALID', '금액은 0보다 커야 합니다.');

    /*
     * 과소비 금액은 그 줄의 금액을 넘을 수 없고 음수일 수 없다.
     *
     * 값을 보내지 않았으면 카테고리의 기본값을 따른다. 기본이 과소비인 분류는 전액이
     * 과소비다. 화면은 그 값을 미리 채워 두고 사용자가 줄이게 한다.
     */
    const extraAmount =
      line.extraAmount === undefined || line.extraAmount === null
        ? category!.defaultIsExtra
          ? amount
          : ZERO
        : Dec.of(line.extraAmount);

    if (extraAmount.lt(ZERO)) fail('EXTRA_NEGATIVE', '과소비 금액은 0보다 작을 수 없습니다.');
    if (extraAmount.gt(amount)) {
      fail('EXTRA_EXCEEDS_AMOUNT', '과소비 금액은 거래 금액보다 클 수 없습니다.');
    }

    return { categoryId: line.categoryId, amount, extraAmount };
  });
}

/**
 * 결제수단을 실제 자금 출처 계좌로 번역한다.
 *
 *   계좌 직접 지정 -> 그 계좌
 *   체크카드      -> 연결된 예금 계좌 (즉시 출금)
 *   신용카드      -> 카드의 부채 계좌
 */
async function resolvePaymentSource(
  projectId: string,
  source: { accountId?: string; cardId?: string },
  lookup: LedgerLookup,
): Promise<{ accountId: string; cardId?: string; isCreditCard: boolean }> {
  if (Boolean(source.accountId) === Boolean(source.cardId)) {
    fail('PAYMENT_SOURCE_AMBIGUOUS', '결제수단으로 계좌와 카드 중 하나만 지정해야 합니다.');
  }

  if (source.accountId) {
    await requireAccount(projectId, source.accountId, lookup);
    return { accountId: source.accountId, isCreditCard: false };
  }

  const card = await requireCard(projectId, source.cardId!, lookup);

  if (card.cardType === 'debit') {
    // 체크카드는 결제 즉시 연결 통장에서 빠진다. 빚도 청구서도 생기지 않는다.
    return { accountId: card.paymentAccountId, cardId: card.id, isCreditCard: false };
  }

  // 신용카드는 통장이 아니라 부채 계정에 쌓인다. 통장에서는 결제일에 빠진다.
  if (!card.liabilityAccountId) fail('CARD_NO_LIABILITY', '신용카드에 부채 계정이 없습니다.');
  return { accountId: card.liabilityAccountId!, cardId: card.id, isCreditCard: true };
}

/** 이 계좌가 신용카드의 부채 계정이면 그 카드 id. 아니면 undefined. */
async function cardIdForLiability(
  projectId: string,
  account: LookupAccount,
  lookup: LedgerLookup,
): Promise<string | undefined> {
  if (account.type !== 'credit_card') return undefined;
  return (await lookup.cardIdForLiability(projectId, account.id)) ?? undefined;
}

async function requireAccount(
  projectId: string,
  accountId: string,
  lookup: LedgerLookup,
): Promise<LookupAccount> {
  const account = await lookup.account(projectId, accountId);
  if (!account) fail('ACCOUNT_NOT_FOUND', '계좌를 찾을 수 없습니다.', true);
  return account!;
}

async function requireCard(
  projectId: string,
  cardId: string,
  lookup: LedgerLookup,
): Promise<LookupCard> {
  const card = await lookup.card(projectId, cardId);
  if (!card) fail('CARD_NOT_FOUND', '카드를 찾을 수 없습니다.', true);
  return card!;
}

function assertCurrency(value: unknown, label: string): string {
  if (!isCurrencyCode(value)) {
    fail('CURRENCY_UNSUPPORTED', `${label}: ${SUPPORTED_CURRENCIES.join(', ')} 중 하나여야 합니다.`);
  }
  return value as string;
}
