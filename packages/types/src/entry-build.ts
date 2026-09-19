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
  /** 카드 이름. 대금 이동의 기본 설명이 이 값으로 만들어진다. */
  name: string;
  cardType: CardType;
  paymentAccountId: string;
  liabilityAccountId: string | null;
}

export interface LookupCategory {
  id: string;
  projectId: string;
  name: string;
  type: CategoryType;
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
  cardId?: string;
  /**
   * 이 줄의 신원. **분류 다리에만 있다.**
   *
   * 화면이 만들어 보낸 값을 그대로 담는다. 조립이 새로 만들지 않는 것이 요점이다 --
   * 저장할 때마다 다리를 지우고 새로 만드는데(replaceEntry), 조립이 키까지 새로
   * 만들면 줄에 붙은 태그와 차감이 매번 끊긴다.
   */
  lineKey?: string;
  /** 이 줄에서 깎인 금액 (입력 통화, 양수). 차감이 없으면 비운다. */
  discountAmount?: Dec | null;
  /** 이 줄에 붙일 태그. 주면 그 목록이 그대로 줄의 태그가 된다. */
  tagIds?: string[];
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
  /**
   * 수수료가 붙는 할부인가 (`InstallmentPlan.interestBearing`).
   *
   * 무이자면 청구가 원금을 개월수로 나눈 값 그대로다. 유이자면 회차마다 수수료가
   * 붙는데 금액이 조금씩 달라 계산으로 맞출 수 없어, 그 회차가 마감되면 카드 상세에
   * 떠올라 사용자가 명세서를 보고 적는다.
   */
  installmentInterest?: boolean;
  /** 회차별 원금 (사용자가 적은 값). 적지 않았으면 없고, 그때는 개월수로 나눈다. */
  installmentShares?: string[];
  /**
   * 이 거래를 카드 실적에 세는가. 카드로 낸 거래에만 뜻이 있다.
   *
   * **분할해도 하나다.** 실적을 세는 쪽은 카드사이고 그쪽이 보는 것은 승인 한 건이라,
   * 한 결제를 분류로 나눴다고 절반만 실적에 드는 일은 없다.
   *
   * 실적과 청구액은 다른 값이다 -- 꺼 두어도 갚을 대금은 그대로 남는다.
   * 기본값은 갈래마다 다르다(지출 포함, 카드 수입 제외).
   */
  countsPerformance?: boolean;
  /**
   * 차감·취소 금액을 카드 실적에서도 뺄지. 차감이 붙은 카드 지출에만 뜻이 있다.
   *
   * 깎인 금액은 줄마다 따로 적지만(`BuiltPosting.discountAmount`), 그것을 실적에서
   * 뺄지는 카드사의 방침 하나라 여기 둔다.
   */
  discountCountsPerformance?: boolean;
  /**
   * 거래 자체에 붙일 태그. **분류 줄이 없는 전표에만 쓴다** (이체, 카드 대금 결제).
   *
   * 지출·수입의 태그는 줄에 붙으므로 `BuiltPosting.tagIds` 로 간다. 한 결제를 둘로
   * 나눴을 때 "여행"이 두 줄에 함께 뜨지 않게 하는 것이 이 갈림의 전부다.
   */
  tagIds?: string[];
}

/**
 * 카테고리 한 줄. 분할이면 여럿이다.
 *
 * 태그와 차감과 실적 여부가 모두 여기 달린다. 전표에 달려 있던 시절에는 분할의 한
 * 줄만 환불받아도 비율 배분이 나머지 줄까지 깎았고, 실적에서 빼야 할 분류가 한 줄만
 * 섞여도 결제 전체가 실적에서 빠졌다.
 */
export interface CategoryLine {
  categoryId: string;
  /** 정가. 차감을 빼기 전의 금액이다. */
  amount: DecInput;
  /**
   * 이 줄의 신원. **화면이 만들어 보낸다** (uuid).
   *
   * 분할 줄을 더하는 순간 붙이고, 편집 내내 들고 다니다가 저장할 때마다 그대로
   * 되돌려 보낸다. 서버는 옛 값과 새 값을 짝지을 필요 없이 받은 값을 써 넣는다.
   * 비어 있으면 거절한다 -- 조립이 대신 만들면 그 줄의 태그와 차감이 끊긴다.
   */
  lineKey: string;
  /**
   * 이 줄에서 깎인 금액 (포인트·자동할인·취소). 정가와 같은 통화다.
   *
   * **정가보다 작아야 한다.** 같으면 그 줄이 0원이 되는데, 원장은 0원 다리를 받지
   * 않는다(POSTING_ZERO_AMOUNT). 화면도 같은 규칙으로 저장 버튼을 막는다.
   */
  discount?: DecInput | null;
  /** 이 줄에 붙일 태그. */
  tagIds?: string[];
}

/** 조립이 검증을 마친 카테고리 줄. 금액은 차감을 뺀 순액이다. */
interface ResolvedLine {
  categoryId: string;
  lineKey: string;
  /** 차감을 뺀 순액. 언제나 0보다 크다. */
  amount: Dec;
  /** 이 줄에서 깎인 금액. 없으면 null. */
  discount: Dec | null;
  tagIds?: string[];
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
  /** 수수료가 붙는 할부인가. 개월수를 고른 신용카드 지출에만 뜻이 있다. */
  installmentInterest?: boolean;
  /**
   * 회차별 원금. 생략하면 개월수로 나눈 값을 쓴다.
   *
   * 개수는 개월수와 같아야 하고 합은 카드에 청구되는 금액과 같아야 한다. 끝수를 어느
   * 회차에 몰아주는지가 카드사마다 달라, 명세서와 맞추려면 사람이 적은 값을 쓴다.
   */
  installmentShares?: DecInput[];
  /**
   * 카드 실적에 셀지. 카드로 낼 때만 뜻이 있고 **기본은 포함**이다.
   *
   * 세금·공과금·상품권처럼 청구는 되지만 카드사가 실적에서 빼는 결제가 있다. 그때
   * 꺼 두면 갚을 대금은 그대로 두고 실적에서만 빠진다.
   *
   * **분할해도 하나다.** 카드사가 보는 것은 승인 한 건이라, 분류로 나눴다고 절반만
   * 실적에 드는 일은 없다.
   */
  countsPerformance?: boolean;
  /**
   * 깎인 금액을 실적에서도 뺄지. **기본은 뺀다**.
   *
   * 다리가 이미 순액이라 그것이 지금까지의 동작이다. 카드사가 환불을 실적에서 빼지
   * 않는 경우가 있어, 그때 꺼 두면 실적만 정가로 센다. 깎인 금액은 줄마다 따로 적지만
   * 이 선택은 카드사의 방침 하나라 거래에 둔다.
   */
  discountCountsPerformance?: boolean;
  /**
   * 거래 자체에 붙일 태그. 지출에는 쓰지 않는다 -- 태그는 줄에 붙는다(`lines[].tagIds`).
   *
   * 자리를 비워 두는 것은 갈래마다 입력 모양이 달라지지 않게 하기 위함이다.
   */
  tagIds?: string[];
}

export interface IncomeBuildInput extends CommonBuildInput {
  lines: CategoryLine[];
  /**
   * accountId 와 cardId 중 정확히 하나. 지출과 같은 규칙이다.
   *
   * **카드로도 돈이 들어온다.** 카드사가 되돌려 주는 돈이 통장을 거치지 않고 다음
   * 청구에서 빠지는 일이 있어, 그때 돈이 들어오는 자리는 통장이 아니라 그 카드의
   * 빚이다. 신용카드면 부채 계정이 줄고, 체크카드면 연결 통장으로 들어온다.
   */
  accountId?: string;
  cardId?: string;
  /**
   * 카드 실적에 셀지. **기본은 제외**다.
   *
   * 지출과 반대인 까닭은 이 돈의 성격 때문이다. 카드사가 주는 캐시백이나 이벤트
   * 지급은 쓴 돈이 아니라서 실적을 깎지 않는다. 결제를 되돌려 받은 환급이라면 그
   * 결제가 실적에 들어가 있었으므로 켜서 함께 빼 준다.
   */
  countsPerformance?: boolean;
  /** 거래 자체에 붙일 태그. 수입도 태그는 줄에 붙으므로 쓰지 않는다. */
  tagIds?: string[];
}

export interface TransferBuildInput extends CommonBuildInput {
  fromAccountId: string;
  toAccountId: string;
  amount: DecInput;
  /** 받는 계좌에 실제로 들어온 금액 (받는 계좌 통화) */
  toAmount?: DecInput;
  feeAmount?: DecInput;
  feeCategoryId?: string;
  /** 수수료 줄의 신원. 수수료를 적었으면 함께 보낸다. */
  feeLineKey?: string;
  /**
   * 이 거래에 붙일 태그.
   *
   * 이체는 분류 줄로 펴지 않으므로(목록도 한 줄이다) 태그가 거래 자체에 붙는다.
   * 수수료 줄에 붙이지 않는 것은 그 줄이 목록에 서지 않기 때문이다 -- 붙여 두면
   * 어디에도 보이지 않는 태그가 된다.
   */
  tagIds?: string[];
}

export interface CardTransferBuildInput extends CommonBuildInput {
  cardId: string;
  accountId: string;
  amount: DecInput;
  direction: CardTransferDirection;
  /** 이 거래에 붙일 태그. 분류 줄이 없어 거래 자체에 붙는다. */
  tagIds?: string[];
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

  /*
   * 줄 금액은 이미 순액이다 (`resolveLines` 가 줄마다 차감을 뺀다).
   *
   * 예전에는 전표에 차감 하나를 받아 줄마다 비율로 나눴다. 여행경비만 환불받아도
   * 식비 줄이 함께 깎여, 분류별 분석이 사실과 어긋났다.
   */
  const enteredTotal = sum(lines.map((line) => line.amount));
  const billed = resolveBilled(input.billedAmount, entered, account.currency, base);
  const baseLines = toBaseLines(lines, rate, base, billed);
  const baseTotal = sum(baseLines.map((line) => line.baseAmount));
  const foreign = foreignNote(entered, account.currency, base, enteredTotal);
  // 청구액을 받았으면 추정이 아니다. 확정된 금액 그대로 들어간다.
  const provisional = foreign.originalCurrency !== undefined && estimatedRate && !billed;
  assertCanEstimate(provisional, source.isCreditCard, base);
  assertCanInstall(input.installmentMonths, source.isCreditCard);

  /*
   * 환산액이 0으로 내려앉은 거래에는 할부가 없다.
   *
   * 나눌 청구가 남아 있지 않다. 그대로 두면 회차가 전부 0원인 일정이 붙고, 서버의
   * `saveInstallmentPlan` 은 음수인 카드 다리를 찾지 못해 엉뚱한 오류를 던진다.
   */
  const months = baseTotal.isZero() ? undefined : input.installmentMonths;
  // 유이자 여부는 할부에만 뜻이 있다. 일시불로 되돌리면 함께 떨어진다.
  const interest = months && months >= 2 ? input.installmentInterest ?? false : undefined;

  const payment = paymentLeg(source, account.currency, entered, rate, base, enteredTotal, baseTotal);
  const postings = [
    // 지출 발생 = + (언제나 기준통화)
    ...baseLines.map((line) => categoryLeg(line, line.baseAmount, base)),
    // 자산 감소 또는 부채 증가 = -
    payment,
  ];

  /*
   * 사용자가 적어 둔 회차 원금. 기준은 카드 다리의 금액이다.
   *
   * 통화가 갈리는 거래(원화 카드로 한 외화 결제)에서는 입력한 금액이 아니라 카드에
   * 청구되는 금액이 나뉜다. 그 값이 곧 카드 다리라, 다리를 보고 검사한다.
   */
  const shares = installmentSharesOf(input.installmentShares, months, payment.amount);

  return {
    ...common(input),
    ...foreign,
    rateProvisional: provisional,
    installmentMonths: months,
    installmentInterest: interest,
    installmentShares: shares,
    // 카드로 낸 지출은 기본이 실적 포함이다. 카드가 아니면 읽히지 않는 자리다.
    countsPerformance: source.cardId ? input.countsPerformance ?? true : true,
    /*
     * 차감을 실적에서도 뺄지. 기본은 뺀다 (다리가 이미 순액이라 그것이 지금까지의
     * 동작이다). 차감이 없으면 읽히지 않으므로 값을 가리지 않고 그대로 담는다 --
     * 사용자가 차감을 지웠다가 다시 적어도 고른 값이 남는다.
     */
    discountCountsPerformance: source.cardId
      ? input.discountCountsPerformance ?? true
      : true,
    postings,
  };
}

/**
 * 줄의 차감액이 쓸 수 있는 값인지 본다.
 *
 * **정가와 같아도 된다.** 그때 그 줄은 0원으로 남는다 -- 1,000원을 결제하고 1,000원을
 * 돌려받은 일은 있었던 일이고, 카드 명세서에도 승인과 취소가 함께 남는다. 분할의 한
 * 줄만 그렇게 되는 것도 같다(여행경비만 전액 환불되고 식비 줄은 남는다). 원장도 그
 * 0원을 "환불로 그렇게 된 것"으로 가려 받는다 (`checkPostings` 의 zeroAllowed).
 *
 * 넘으면 지출이 아니라 입금이 되므로 막는다. 정가 자체가 0인 줄은 `resolveLines` 가
 * 따로 막는다 -- 그것은 사람이 적을 수 없는 모양이다.
 *
 * **차감액의 통화는 입력 통화다.** 정가와 같은 칸에 적힌 값이라 그래야 뺄 수 있고,
 * 다시 열 때 정가를 되살리는 덧셈도 같은 통화 안에서 끝난다. 그래서 외화 결제에도
 * 그대로 붙는다 -- 전표의 표시값이라 기준통화로 옮길 이유가 없다.
 */
function assertDiscountValid(discount: Dec, gross: Dec, categoryId: string) {
  if (discount.isZero()) return;
  if (discount.isNegative()) fail('DISCOUNT_INVALID', '차감액은 0보다 커야 합니다.');
  if (discount.gt(gross)) {
    fail(
      'DISCOUNT_TOO_LARGE',
      `차감액은 그 줄의 금액보다 클 수 없습니다 (분류 ${categoryId}).`,
    );
  }
}

/** 수입. 수입 카테고리는 -, 입금 계좌는 +. */
export async function buildIncome(
  input: IncomeBuildInput,
  lookup: LedgerLookup,
): Promise<BuiltEntry> {
  const lines = await resolveLines(input.projectId, input.lines, 'income', lookup);
  // 결제수단을 자금 계좌로 옮기는 규칙은 지출과 한 벌이다 (체크카드는 통장, 신용카드는 부채).
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

  /*
   * 수입 다리는 부호만 반대다. 지출과 같은 규칙을 쓰도록 paymentLeg 를 재사용하고
   * 마지막에 뒤집는다. 계좌가 외화인 경우의 환산 규칙이 한 곳에만 있어야 한다.
   */
  const outgoing = paymentLeg(
    { accountId: account.id, ...(source.cardId ? { cardId: source.cardId } : {}) },
    account.currency,
    entered,
    rate,
    base,
    enteredTotal,
    baseTotal,
  );

  const foreign = foreignNote(entered, account.currency, base, enteredTotal);

  /*
   * 통장으로 들어온 수입은 추정으로 남길 수 없다.
   *
   * 확정할 자리가 없기 때문이다. 카드 대조 화면은 신용카드 전용이라 통장 거래는 거기
   * 올라오지 않고, 그러면 틀린 환산액이 고칠 길 없이 남는다. 신용카드로 되돌려받은
   * 돈은 그 화면에 오르므로 지출과 같은 규칙으로 둔다.
   */
  const provisional = foreign.originalCurrency !== undefined && estimatedRate && !billed;
  assertCanEstimate(provisional, source.isCreditCard, base);

  return {
    ...common(input),
    ...foreign,
    rateProvisional: provisional,
    // 카드로 들어온 돈은 기본이 실적 제외다. 쓴 돈이 아니라 받은 돈이기 때문이다.
    countsPerformance: source.cardId ? input.countsPerformance ?? false : true,
    postings: [
      ...baseLines.map((line) => categoryLeg(line, line.baseAmount.negated(), base)),
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
  if (fee.gt(ZERO) && !input.feeLineKey) {
    fail('LINE_KEY_REQUIRED', '수수료 줄의 키가 없습니다. 화면을 새로고침한 뒤 다시 저장해 주세요.');
  }

  const from = await requireAccount(input.projectId, input.fromAccountId, lookup);
  const to = await requireAccount(input.projectId, input.toAccountId, lookup);

  // 카드가 끼면 그 다리에 cardId 를 채운다. 비워 두면 카드별 거래 조회에서 빠진다.
  const fromCardId = await cardIdForLiability(input.projectId, from, lookup);
  const toCardId = await cardIdForLiability(input.projectId, to, lookup);

  /*
   * 양쪽이 다 카드인 이동은 받지 않는다.
   *
   * 카드 빚을 다른 카드로 옮기는 일은 원장에 담을 수 있지만, 목록은 이 전표를
   * `card_payment` 로 읽고 "어느 카드의 대금인가"를 하나로 정해야 해서 어느 쪽을
   * 골라도 반쪽만 보인다. 실제로 그런 거래가 있다면 통장을 거쳐 두 번 적는 편이
   * 카드 명세서와도 맞는다.
   */
  if (fromCardId && toCardId) {
    fail('TRANSFER_BOTH_CARDS', '카드에서 카드로 바로 옮기는 거래는 적을 수 없습니다.');
  }

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
     * 카테고리나 수입 카테고리가 수수료 자리에 들어오지 않는다.
     */
    const [line] = await resolveLines(
      input.projectId,
      [{ categoryId: input.feeCategoryId!, amount: fee, lineKey: input.feeLineKey! }],
      'expense',
      lookup,
    );
    /*
     * 수수료도 줄 키를 갖는다. 목록은 이체를 한 줄로 보여 주지만, 줄의 신원이 갈래마다
     * 다르면 저장·동기화 규칙이 두 벌이 된다.
     */
    postings.push(categoryLeg(line, feeBase, base));
  }

  return { ...common(input), postings, ...(input.tagIds ? { tagIds: input.tagIds } : {}) };
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
    ...(input.tagIds ? { tagIds: input.tagIds } : {}),
    /*
     * 설명을 비우고 보내면 카드 이름으로 채운다.
     *
     * 화면이 두 곳(웹·앱)이고 길이 둘(서버 입구와 기기의 아웃박스)이라, 그 문구를
     * 부르는 쪽마다 두면 어디선가 갈린다. 조립이 한 번만 정하면 오프라인에서 적은
     * 기록과 온라인에서 적은 기록이 같은 글자를 갖는다.
     */
    description: input.description.trim() || defaultTransferDescription(card.name, input.direction),
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

/** 대금 이동의 기본 설명. 사용자가 적지 않으면 이 글자가 남는다. */
export function defaultTransferDescription(
  cardName: string,
  direction: CardTransferDirection,
): string {
  return direction === 'refund' ? `${cardName} 환불 입금` : `${cardName} 대금 결제`;
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
  splits?: Array<{
    categoryId: string;
    amount: DecInput;
    /** 이 줄의 키. 화면이 만들어 편집 내내 들고 다닌다. */
    lineKey: string;
    /** 이 줄에서 깎인 금액. */
    discountAmount?: DecInput;
    /** 이 줄에 붙일 태그. */
    tagIds?: string[];
  }>;
  accountId?: string;
  toAccountId?: string;
  cardId?: string;
  installmentMonths?: number;
  installmentInterest?: boolean;
  installmentShares?: DecInput[];
  toAmount?: DecInput;
  transferFee?: DecInput;
  transferFeeCategoryId?: string;
  cardTransferDirection?: CardTransferDirection;
  /**
   * 분류 줄 하나뿐인 거래의 줄 키. 화면이 만든다.
   *
   * 분할이면 `splits[].lineKey` 가 대신 쓰인다. 지출·수입에는 둘 중 하나가 반드시
   * 있어야 하고, 없으면 조립이 거절한다.
   */
  lineKey?: string;
  /** 분류 줄 하나뿐인 거래에서 그 줄이 깎인 금액. 분할이면 `splits[].discountAmount`. */
  discountAmount?: DecInput;
  /** 이 거래를 카드 실적에 셀지. **분할해도 하나다.** 생략하면 갈래의 기본값을 쓴다. */
  countsPerformance?: boolean;
  /** 차감 금액을 실적에서도 뺄지. **분할해도 하나다.** 생략하면 뺀다. */
  discountCountsPerformance?: boolean;
  /** 이체 수수료 줄의 키. 수수료를 적었으면 함께 보낸다. */
  transferFeeLineKey?: string;
  /**
   * 붙일 태그.
   *
   * 지출·수입이면 **그 거래의 분류 줄 하나**에 붙는다 (분할이면 `splits[].tagIds` 를
   * 쓴다). 이체와 카드 대금 결제는 분류 줄이 없어 거래 자체에 붙는다.
   */
  tagIds?: string[];
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
          installmentInterest: request.installmentInterest,
          installmentShares: request.installmentShares,
          countsPerformance: request.countsPerformance,
          discountCountsPerformance: request.discountCountsPerformance,
        },
        lookup,
      );

    case 'income':
      return buildIncome(
        {
          ...request,
          lines: resolveRequestLines(request),
          accountId: request.accountId,
          cardId: request.cardId,
          countsPerformance: request.countsPerformance,
        },
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
          feeLineKey: request.transferFeeLineKey,
          tagIds: request.tagIds,
        },
        lookup,
      );

    /*
     * 카드사 대금 이동. **거래 폼은 이 갈래로 보내지 않는다.**
     *
     * 이체에서 카드 부채 계정을 고르면 같은 전표가 나오고, 목록이 그것을 다시
     * `card_payment` 로 읽는다. 이 자리를 남겨 두는 것은 셋 때문이다 -- 기기의
     * 아웃박스에 쌓여 있던 옛 명령을 재생해야 하고, 자산 화면의 "결제하기"가 통장과
     * 카드와 방향만 알면 되는 자리라 이 입구로 보내며(오프라인에서도 같은 길이다),
     * 카드 전용 엔드포인트(`/cards/:id/transfer`)가 그대로 서 있다.
     */
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
          tagIds: request.tagIds,
        },
        lookup,
      );

    default:
      return fail('ENTRY_KIND_UNKNOWN', `알 수 없는 거래 종류입니다: ${request.kind}`);
  }
}

/**
 * 분할이 있으면 그것을, 없으면 단일 카테고리를 한 줄짜리 분할로 취급한다.
 *
 * 한 줄짜리 거래에서는 줄에 달리는 것(키·차감·태그)이 요청의 맨 위에 있다. 분류를
 * 하나만 고른 사람에게 "줄"이라는 개념을 보여 줄 까닭이 없어서다.
 *
 * 실적 두 칸은 분할이든 아니든 언제나 맨 위다. 줄에 달리는 값이 아니기 때문이다.
 */
function resolveRequestLines(request: EntryBuildRequest): CategoryLine[] {
  if (request.splits?.length) {
    return request.splits.map((split) => ({
      categoryId: split.categoryId,
      amount: split.amount,
      lineKey: split.lineKey,
      discount: split.discountAmount,
      tagIds: split.tagIds,
    }));
  }

  if (!request.categoryId) fail('CATEGORY_REQUIRED', '카테고리를 지정해야 합니다.');

  return [
    {
      categoryId: request.categoryId!,
      amount: requireAmount(request.amount, '금액'),
      lineKey: request.lineKey!,
      discount: request.discountAmount,
      tagIds: request.tagIds,
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

/**
 * 분류 다리 하나. 줄에 달린 것(키·차감·실적·태그)을 함께 싣는다.
 *
 * 금액은 언제나 기준통화다. 그래야 "8월 식비"가 통화별로 쪼개지지 않는다.
 */
function categoryLeg(line: ResolvedLine, amount: Dec, base: string): BuiltPosting {
  return {
    categoryId: line.categoryId,
    lineKey: line.lineKey,
    amount,
    currency: base,
    exchangeRate: ONE,
    baseAmount: amount,
    ...(line.discount ? { discountAmount: line.discount } : {}),
    ...(line.tagIds ? { tagIds: line.tagIds } : {}),
  };
}

/** 기준통화로 기록되는 다리 (카테고리, 자본 계정) */
function baseLeg(
  target: { accountId?: string; categoryId?: string; cardId?: string },
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
 * 사용자가 적어 둔 회차 원금을 검사한다. 적지 않았으면 undefined.
 *
 * 끝수를 어느 회차에 몰아주는지는 카드사마다 다르다. 1,000원 3개월이 334/333/333 일
 * 수도 334/334/332 일 수도 있어, 명세서와 맞추려면 사람이 적은 값을 그대로 써야 한다.
 * 그래서 값 자체는 손대지 않고 **합과 개수만** 본다.
 *
 * 합이 어긋난 채 저장되면 카드 화면의 주기별 청구액 합계가 갚을 대금과 달라진다.
 * 그 어긋남은 몇 달 뒤 명세서를 대조할 때에야 드러나므로 여기서 막는다.
 */
function installmentSharesOf(
  shares: readonly DecInput[] | undefined,
  months: number | undefined,
  cardLegAmount: Dec,
): string[] | undefined {
  if (!shares || shares.length === 0) return undefined;
  // 일시불로 되돌렸으면 적어 둔 값도 뜻이 없다.
  if (!months || months < 2) return undefined;

  if (shares.length !== months) {
    fail('INSTALLMENT_SHARES_COUNT', '회차 금액의 개수가 할부 개월수와 다릅니다.');
  }

  const values = shares.map((share) => Dec.of(share));
  if (values.some((value) => value.isNegative())) {
    fail('INSTALLMENT_SHARE_NEGATIVE', '회차 금액은 0보다 작을 수 없습니다.');
  }

  // 카드 다리는 사용이 음수다. 회차는 청구 금액이라 양수로 견준다.
  if (!sum(values).eq(cardLegAmount.negated())) {
    fail('INSTALLMENT_SHARES_SUM', '회차 금액의 합이 결제 금액과 달라요.');
  }

  return values.map((value) => value.toString());
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
): Promise<ResolvedLine[]> {
  if (lines.length === 0) fail('CATEGORY_REQUIRED', '카테고리를 최소 하나 지정해야 합니다.');

  /*
   * 줄 키가 없으면 거절한다. 조립이 대신 만들지 않는다.
   *
   * 만들어 주면 저장은 되지만 그 줄의 태그와 차감이 옛 키에 매달린 채 남는다. 화면이
   * 키를 잃은 것이 원인이므로, 조용히 메우지 말고 그 자리에서 알려야 한다.
   */
  const seen = new Set<string>();
  for (const line of lines) {
    if (!line.lineKey) {
      fail('LINE_KEY_REQUIRED', '분류 줄의 키가 없습니다. 화면을 새로고침한 뒤 다시 저장해 주세요.');
    }
    if (seen.has(line.lineKey)) {
      fail('LINE_KEY_DUPLICATE', '한 거래 안에서 분류 줄의 키가 겹칩니다.');
    }
    seen.add(line.lineKey);
  }

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

    const gross = Dec.of(line.amount);
    if (gross.lte(ZERO)) fail('AMOUNT_INVALID', '금액은 0보다 커야 합니다.');

    // 빈 값은 "차감 없음"이다. 화면이 비운 칸을 그대로 실어 보내는 일이 있다.
    const raw = line.discount;
    const discount = raw === undefined || raw === null || raw === '' ? ZERO : Dec.of(raw);
    assertDiscountValid(discount, gross, line.categoryId);

    return {
      categoryId: line.categoryId,
      lineKey: line.lineKey,
      // 원장에 들어가는 것은 순액이다. 정가는 차감액과 더해 되살린다.
      amount: gross.minus(discount),
      discount: discount.isZero() ? null : discount,
      tagIds: line.tagIds,
    };
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
