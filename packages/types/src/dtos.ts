import type {
  IsoDateString,
  User,
  Person,
  Account,
  AccountType,
  Card,
  Category,
  FinancialInstitution,
  FinancialInstitutionType,
  EntryKind,
  EntryListItem,
  CardTransferDirection,
  Posting,
} from './entities';

// ===== Auth =====

// 인증 응답에 담기는 사용자 정보 (googleId 등 내부 식별자 제외)
export interface UserResponse extends Omit<User, 'googleId' | 'defaultProjectId'> {
  defaultProjectId?: string;
}

export namespace Auth {
  // 구글 로그인: 클라이언트가 GIS로 발급받은 ID 토큰을 그대로 전달한다.
  // 신규 사용자는 이 요청에서 함께 생성되므로 별도 가입 절차가 없다.
  export interface GoogleSignInRequest {
    idToken: string;
  }

  export interface ProjectInitialData {
    project: {
      id: string;
      name: string;
      description?: string | null;
    };
    cards: any[];
    accounts: any[];
    categories: any[];
    people: any[];
    recentTransactions: any[];
    budgets: any[];
  }

  export interface AuthResponse {
    accessToken: string;
    refreshToken: string;
    user: UserResponse;
    // 프로젝트를 모두 삭제하거나 탈퇴하면 null이 된다. 이 경우에도 로그인은
    // 성공해야 하며, 클라이언트가 프로젝트 생성 화면으로 유도한다.
    defaultProjectData: ProjectInitialData | null;
  }

  export interface RefreshRequest {
    refreshToken: string;
  }

  export interface LogoutRequest {
    refreshToken?: string;
  }
}

// ===== Person =====

export namespace PersonDto {
  export interface CreateRequest {
    name: string;
    relationship?: string;
    projectId?: string;
  }

  export interface UpdateRequest {
    name?: string;
    relationship?: string;
    isActive?: boolean;
  }

  export interface Response extends Person {}
}

// ===== Account =====

export namespace AccountDto {
  export interface CreateRequest {
    type: AccountType;
    ownerId: string; // Person ID
    name: string;
    /** 개설 기관. FinancialInstitution(type = bank)의 id. 현금/부동산은 생략한다. */
    institutionId?: string;
    accountNumber?: string;
    /**
     * 개설 잔액. 전표로 기록되므로 잔액 컬럼에 직접 쓰지 않는다. 금액은 문자열.
     * 날짜는 원장 맨 앞(1970-01-01)으로 고정된다. 기준일은 받지 않는다.
     */
    openingBalance?: string;
    currency?: string;
    projectId?: string;
  }

  export interface UpdateRequest {
    name?: string;
    /** null을 주면 기관 연결을 끊는다 */
    institutionId?: string | null;
    accountNumber?: string;
    /**
     * 현재 잔액을 이 값으로 맞춘다.
     *
     * 컬럼을 덮어쓰거나 조정 전표를 새로 쌓지 않는다. 기초잔액 전표를
     * "목표 잔액 - 나머지 거래 합계"로 다시 계산해 덮어쓴다.
     */
    balance?: string;
    isActive?: boolean;
  }

  export interface Response extends Account {
    /** 서버가 include로 함께 준다 */
    owner?: PersonDto.Response;
    /** 서버가 include로 함께 준다. 기관을 고르지 않은 계좌는 null */
    institution?: FinancialInstitution | null;
  }

  /** 계좌 원장 한 줄. 거래별 잔액 추이를 함께 준다. */
  export interface LedgerRow {
    postingId: string;
    entryId: string;
    date: IsoDateString;
    description: string;
    merchant: string | null;
    /** 이 계좌 기준 증감. 출금이 음수 */
    amount: string;
    /** 이 거래 직후의 잔액 */
    balanceAfter: string;
    cardId: string | null;
    cardName: string | null;
  }

  export type LedgerResponse = CursorPage<LedgerRow>;
}


// ===== Card =====

export namespace CardDto {
  export interface CreateRequest {
    /** 사용자가 고른 실제 통장. 필수이며 서버가 새로 만들지 않는다. */
    paymentAccountId: string;
    name: string;
    cardNumber?: string; // 실제 번호 (서버에서 마스킹)
    cardType: 'debit' | 'credit';
    /** 카드사. FinancialInstitution(type = card_issuer)의 id */
    issuerId: string;
    expiryDate?: IsoDateString;
    creditLimit?: string; // 신용카드만. 금액은 문자열
    statementClosingDay?: number; // 신용카드 필수. 1~31
    paymentDueDay?: number;       // 신용카드 필수. 1~31
    projectId?: string;
  }

  export interface UpdateRequest {
    name?: string;
    issuerId?: string;
    /**
     * 실제 카드 번호 (서버에서 마스킹해 저장/응답).
     *
     * 응답에는 마스킹된 번호만 나가므로 화면은 원래 값을 모른다. 그래서
     * "생략 = 그대로 두기", "값 지정 = 교체", "빈 문자열 = 지우기"로 구분한다.
     */
    cardNumber?: string;
    expiryDate?: IsoDateString | null;
    creditLimit?: string;
    statementClosingDay?: number;
    paymentDueDay?: number;
    isActive?: boolean;
  }

  export interface Response extends Omit<Card, 'cardNumber'> {
    cardNumberMasked: string;
    /**
     * 화면에 보여주는 "사용액". 부채 잔액의 부호를 뒤집은 값. 체크카드는 null.
     *
     * 음수일 수 있다. 카드사가 남은 대금보다 많이 가져갔거나 사용을 취소한 뒤라
     * 카드사가 갚을 돈이 남은 상태다. 화면은 그때 "환불 예정"으로 보여 준다.
     */
    currentUsage: string | null;
    /** 서버가 include로 함께 준다 */
    issuer?: FinancialInstitution;
  }

  /** 카드사와 통장 사이 자금 이동 기록 */
  export interface TransferRequest {
    /** 대금이 빠져나가거나 환불이 들어오는 통장 */
    accountId: string;
    personId: string;
    /** 금액은 문자열. 항상 양수이며 방향은 direction이 정한다. */
    amount: string;
    direction: CardTransferDirection;
    date: IsoDateString;
    description?: string;
  }

  /** 마감일 기준 청구 주기 하나 */
  export interface UsagePeriod {
    /** `@db.Date` 성격의 달력 날짜 표시자 */
    periodStart: IsoDateString;
    periodEnd: IsoDateString;
    dueDate: IsoDateString;
    /** 마감일이 지났으면 true. 진행 중인 주기는 금액이 더 늘 수 있다. */
    closed: boolean;
    /** 이 주기에 청구되는 사용액. 할부는 회차분만 들어간다. */
    usage: string;
  }

  /**
   * 카드 사용 현황.
   *
   * 청구서를 저장하지 않는다. 카드의 현재 마감일 설정으로 읽을 때 계산하므로
   * 마감일을 바꾸면 곧바로 다시 그려진다.
   */
  /**
   * 청구액이 아직 확정되지 않은 외화 결제 한 건.
   *
   * 원화 카드로 외화를 쓰면 청구액은 결제일에 카드사 환율로 정해진다. 그때까지
   * 원장에는 추정 환산액이 들어가 있고, 이 항목이 그 사실을 그대로 담는다.
   */
  export interface PendingRateItem {
    entryId: string;
    date: IsoDateString;
    description: string;
    merchant: string | null;
    /** 실제로 쓴 통화와 금액. 명세서와 대조할 기준이다. */
    originalCurrency: string;
    originalAmount: string;
    /** 지금 원장에 들어가 있는 추정 청구액. 양수이며 카드 통화다. */
    estimatedAmount: string;
    /** 이 거래가 청구되는 주기의 마감 연월 ("YYYY-MM"). 할부 첫 회차 기준이다. */
    closingMonth: string;
    /** 그 주기의 결제일 */
    dueDate: IsoDateString;
  }

  export interface PendingRatesResponse {
    cardId: string;
    /** 아래 estimatedAmount 들의 통화 (= 카드 통화) */
    currency: string;
    items: PendingRateItem[];
  }

  /**
   * 추정 청구액을 실제 청구액으로 확정한다.
   *
   * 두 가지 입력 방식을 받는다. 명세서가 건마다 청구액을 찍어 주면 `billedAmount`를
   * 채우고, 적용 환율만 한 줄로 적혀 있으면 `rate` 하나로 전부 확정한다.
   * 둘을 섞을 수는 없다.
   */
  export interface SettleRatesRequest {
    /** 1 원통화 = rate 카드통화. 주면 items 전체에 적용한다. */
    rate?: string;
    items: Array<{
      entryId: string;
      /** 실제 청구액 (카드 통화, 양수). rate를 줬으면 비운다. */
      billedAmount?: string;
    }>;
  }

  export interface SettleRatesResponse {
    /** 확정한 건수 */
    settled: number;
  }

  export interface UsageResponse {
    cardId: string;
    /**
     * 이 카드의 통화 (= 결제 통장의 통화).
     *
     * 아래 금액들은 전부 이 통화다. 기준통화 환산액이 아니므로 화면이 원으로
     * 찍으면 달러 카드의 사용액이 1/1380로 보인다.
     */
    currency: string;
    /** 남은 대금. 음수면 카드사가 갚을 돈(환불 예정)이다. */
    outstanding: string;
    periods: UsagePeriod[];
  }
}


// ===== FinancialInstitution =====

export namespace InstitutionDto {
  export interface ListQuery {
    /** 생략하면 은행과 카드사를 모두 준다 */
    type?: FinancialInstitutionType;
    projectId?: string;
  }

  export interface Response extends FinancialInstitution {
    /** false면 기본 제공 항목이라 이 프로젝트에서 수정/삭제할 수 없다 */
    isCustom: boolean;
  }
}


/**
 * 목록 순서 저장.
 *
 * 화면에 보이는 순서대로 id를 보내면 서버가 0부터 다시 매긴다.
 * 보내지 않은 항목은 기존 순서를 유지한다.
 */
export interface ReorderRequest {
  ids: string[];
}

// ===== Transaction =====

/**
 * 거래 조회와 리포트가 함께 쓰는 필터.
 *
 * 목록만 거르고 합계는 그대로 두면 화면의 소계와 상단 요약이 어긋난다.
 * 그래서 같은 필터를 목록·합계·차트·수단별 탭에 모두 넘긴다.
 */
export interface EntryFilterQuery {
  /**
   * 사람 선택. 쉼표로 잇는다 ("p1,p2").
   *
   * 배열을 쿼리스트링으로 보내면 직렬화 방식이 클라이언트마다 달라
   * 서버에서 키 이름이 갈린다(personIds[] 등). 그래서 문자열 하나로 받는다.
   *
   *   생략      = 전체 (필터 없음)
   *   "p1,p2"   = 그 사람들만
   *   ""(빈 값) = 아무도 고르지 않음 → 결과 없음
   */
  personIds?: string;
  /**
   * 고정/변동 선택. 쉼표로 잇는다 ("fixed,variable").
   *
   *   생략               = 전체 (필터 없음)
   *   "fixed,variable"   = 둘 다 (전체와 같다)
   *   "fixed"/"variable" = 한쪽만
   *   ""(빈 값)          = 아무것도 고르지 않음 → 결과 없음
   */
  fixedTypes?: string;
}

export namespace EntryDto {
  /**
   * 화면이 다루는 개념 그대로 받는다. 서버가 전표(postings)로 번역한다.
   * 클라이언트는 Posting을 직접 만들지 않는다.
   */
  export interface CreateRequest {
    kind: 'expense' | 'income' | 'transfer' | 'card_payment';
    personId: string;
    date: IsoDateString;
    description: string;
    merchant?: string;
    detailedNote?: string;

    /** 금액은 정밀도 손실을 막기 위해 문자열로 보낸다 */
    amount: string;
    /**
     * 위 금액을 입력한 통화. 생략하면 결제/입금 계좌의 통화로 본다.
     *
     * 달러 통장에서 달러로 썼다면 그 계좌 통화와 같고, 원화 카드로 달러를
     * 결제했다면 계좌 통화와 다르다. 후자는 청구액(원화)이 원장에 남고
     * 원 통화 금액은 표시용으로 따로 보관된다.
     */
    currency?: string;
    /**
     * 1 currency = exchangeRate 기준통화.
     *
     * 생략하면 서버 환율을 쓴다. 카드사가 실제로 적용한 환율이 명세서에 찍혀
     * 나오면 그 값을 넣어 덮어쓴다.
     */
    exchangeRate?: string;
    /**
     * 기준통화로 실제 청구된(또는 입금된) 총액. 환율 대신 넣는다.
     *
     * 사용자가 아는 값은 대개 환율이 아니라 통장에서 빠진 금액이다. 이 값을 주면
     * 서버가 환율을 무시하고 이 금액을 그대로 기록하며, 적용 환율은 원 통화
     * 금액과의 비로 유도된다. 분할 거래는 줄 비율대로 나뉘어 합계가 정확히 맞는다.
     *
     * 기준통화 계좌(원화 통장·원화 카드)로 외화를 결제한 경우에만 쓸 수 있다.
     */
    billedAmount?: string;

    // ── expense / income ──
    /** 가장 구체적인 카테고리 하나 (소분류가 있으면 소분류). 대분류는 parentId로 유도된다. */
    categoryId?: string;
    /** 생략하면 Category.defaultIsFixed 를 따른다 */
    isFixed?: boolean;
    /** 한 결제를 여러 카테고리로 쪼갤 때. 지정하면 categoryId/amount 대신 이 값을 쓴다. */
    splits?: Array<{ categoryId: string; amount: string; isFixed?: boolean }>;

    // ── 결제수단 (expense는 둘 중 하나, income은 accountId) ──
    accountId?: string;
    cardId?: string;
    /**
     * 할부 개월수. 신용카드 지출에만 쓰며 2 이상일 때 할부가 된다.
     *
     * 원금과 지출은 구매 시점에 전액 잡힌다. 이 값은 "언제 청구되는지"만 나눈다.
     * 회차별 금액과 귀속 주기는 저장하지 않고 읽을 때 계산한다.
     */
    installmentMonths?: number;

    // ── transfer ──
    toAccountId?: string;
    /**
     * 받는 계좌에 실제로 들어온 금액 (받는 계좌 통화).
     *
     * 통화가 다른 환전에서 쓴다. 보낸 $50과 받은 ₩67,500을 그대로 적으면
     * 실제 적용된 환율이 저절로 기록된다. 생략하면 서버 환율로 계산한다.
     */
    toAmount?: string;
    transferFee?: string;
    transferFeeCategoryId?: string;

    // ── card_payment ──
    /** 카드사 이체의 방향. 생략하면 대금 결제(통장 -> 카드)다. */
    cardTransferDirection?: CardTransferDirection;

    projectId?: string;
  }

  /** 수정은 전체 교체다. 생성과 같은 형태를 보내면 서버가 전표를 갈아끼운다. */
  export interface UpdateRequest extends Omit<CreateRequest, 'projectId'> {}

  export interface ListQuery extends EntryFilterQuery {
    /** 원장 관점: 이 계좌가 얽힌 전표 전부 (체크카드 사용, 이체 받은 건 포함) */
    accountId?: string;
    /** 이 카드가 얽힌 전표 전부 (사용 + 대금 결제) */
    cardId?: string;

    /**
     * 결제수단 관점: 이 통장에서 실제로 돈이 나간 전표.
     *
     * 체크카드 결제는 연결 통장에서 바로 빠져 posting에 accountId와 cardId가 함께 있으므로
     * 카드가 붙은 건을 빼고, 돈이 들어온 쪽(이체 받는 계좌)도 뺀다.
     * /reports/payment-methods 및 /reports/trend 와 같은 규칙이다.
     */
    paymentAccountId?: string;
    /** 결제수단 관점: 이 카드로 결제한 전표 */
    paymentCardId?: string;

    personId?: string;
    categoryId?: string;
    /**
     * categoryId를 정확히 그 분류로만 본다.
     *
     * 기본은 대분류를 지정하면 소분류 거래까지 포함이다. 화면의 "미분류"(소분류
     * 없이 대분류에 바로 기록한 건)만 따로 보려면 이 값을 켠다.
     */
    categoryExact?: boolean;
    /**
     * 이 유형의 카테고리 posting을 가진 전표.
     *
     * kind와 다르다. kind='expense'는 이체를 빼지만, categoryType='expense'는
     * 수수료가 붙은 이체를 포함한다. 지출 집계(/reports/summary)와 같은 기준이다.
     */
    categoryType?: 'income' | 'expense';
    kind?: EntryKind;
    startDate?: IsoDateString;
    endDate?: IsoDateString;
    /** 커서 기반 페이지네이션. 이전 응답의 nextCursor를 그대로 넘긴다. */
    cursor?: string;
    limit?: number;
  }

  export type ListResponse = CursorPage<EntryListItem>;

  export interface Detail extends EntryListItem {
    postings: Posting[];
  }
}


// ===== Category =====

export namespace CategoryDto {
  export interface CreateRequest {
    name: string;
    parentId?: string; // 소분류인 경우 대분류 ID
    type: 'income' | 'expense';
    icon?: string;
    defaultIsFixed?: boolean; // 기본 고정 여부
    projectId?: string;
  }

  export interface UpdateRequest {
    name?: string;
    icon?: string;
    defaultIsFixed?: boolean; // 기본 고정 여부
    isActive?: boolean;
  }

  export interface Response extends Category {}

  export interface Tree extends Response {
    children?: Tree[];
  }
}

// ===== Reports =====

/**
 * 집계는 전부 서버에서 한다.
 * "지출 = 지출 카테고리 posting의 합"이 서버 한 곳에 고정되므로
 * 화면마다 합계가 어긋나던 문제가 재발할 수 없다.
 */
export namespace ReportDto {
  /**
   * 집계 구간.
   *
   * 달 단위가 기본이지만 임의의 기간도 볼 수 있어야 한다. 카드 청구주기나 여행
   * 기간처럼 달력의 달과 어긋나는 구간을 보는 일이 실제로 있다.
   *
   * 둘 중 하나만 채운다. startDate/endDate 를 주면 그 구간을, 아니면 yearMonth 의
   * 한 달을 본다. 날짜는 프로젝트 타임존의 달력 날짜이고 양끝을 포함한다.
   */
  export interface PeriodQuery extends EntryFilterQuery {
    projectId?: string;
    /** "YYYY-MM". startDate/endDate 를 주면 무시된다. */
    yearMonth?: string;
    /** "YYYY-MM-DD" (포함) */
    startDate?: string;
    /** "YYYY-MM-DD" (포함) */
    endDate?: string;
    /** 한 사람만 볼 때. 여러 명은 personIds를 쓴다. */
    personId?: string;
  }

  /** 대시보드 / 통계 헤더의 합계 */
  export interface Summary {
    /** 요청한 구간을 그대로 돌려준다. 화면이 무엇의 합계인지 확인할 수 있게. */
    startDate: IsoDateString;
    endDate: IsoDateString;
    /** 한 달을 본 경우에만 채워진다 ("YYYY-MM") */
    yearMonth?: string;
    income: string;
    expense: string;
    fixedExpense: string;
    variableExpense: string;
    /** 수입 - 지출 */
    net: string;
  }

  export interface CategoryBreakdownQuery extends PeriodQuery {
    type: 'income' | 'expense';
    /** true면 소분류 금액을 대분류로 합쳐서 준다 (기본값 true) */
    rollup?: boolean;
  }

  export interface CategoryBreakdownItem {
    categoryId: string;
    categoryName: string;
    parentCategoryId: string | null;
    parentCategoryName: string | null;
    amount: string;
    count: number;
    /** 전체 대비 비율 (0~100) */
    ratio: number;
  }

  /** 자산 화면의 총자산 / 사람별 소계 */
  export interface NetWorth {
    /** 현금성 + 투자성 평가액 - 부채 */
    total: string;
    cash: string;
    investment: string;
    /** 카드 사용액과 대출 (음수) */
    liability: string;
    /** 투자성 계좌 평가액 - 장부가 */
    unrealizedGain: string;
    byPerson: Array<{
      personId: string;
      personName: string;
      total: string;
      cash: string;
      investment: string;
      liability: string;
    }>;
  }

  export interface TrendQuery extends EntryFilterQuery {
    projectId?: string;
    target: 'category' | 'account' | 'card' | 'total';
    /** target=total이면 생략 */
    targetId?: string;
    /** 마지막 달 "YYYY-MM". 생략하면 이번 달 */
    endMonth?: string;
    /** 기본 12 */
    months?: number;
    /** target=total일 때 지출/수입 선택 */
    type?: 'income' | 'expense';
    /**
     * target=category일 때 소분류를 포함하지 않는다.
     *
     * 화면의 "미분류"(대분류에 바로 기록한 건)를 그릴 때 켠다. 기본은 대분류를
     * 지정하면 소분류까지 합친다.
     */
    exact?: boolean;
  }

  export interface TrendPoint {
    yearMonth: string;
    amount: string;
  }

  /**
   * 자산 잔액 추이. TrendQuery와 달리 "그 시점까지의 누적 잔액"을 준다.
   * (Trend는 구간별 발생액이라 누적이 아니다)
   */
  export interface BalanceHistoryQuery {
    projectId?: string;
    /** 생략하면 자본 계정을 뺀 전체 합계 */
    accountId?: string;
    /** 한 구성원이 가진 계좌들의 합계. accountId 와 함께 쓰지 않는다. */
    ownerId?: string;
    /** 기본 month */
    granularity?: 'month' | 'day';
    /** granularity=month의 마지막 달 "YYYY-MM". 생략하면 이번 달 */
    endMonth?: string;
    /** granularity=day의 대상 달 "YYYY-MM". 생략하면 이번 달 */
    yearMonth?: string;
    /** granularity=month일 때만 쓴다. 기본 12 */
    months?: number;
  }

  export interface BalanceHistoryPoint {
    /** granularity=month면 "YYYY-MM", day면 "YYYY-MM-DD" */
    date: string;
    /** 그 시점까지의 누적 잔액 */
    balance: string;
  }

  /** 결제수단별 지출 (PaymentMethodTab) */
  export interface PaymentMethodItem {
    kind: 'account' | 'debit_card' | 'credit_card';
    id: string;
    name: string;
    ownerId: string | null;
    ownerName: string | null;
    amount: string;
    count: number;
  }
}

// ===== Budget =====

export namespace BudgetDto {
  export interface CreateRequest {
    categoryId?: string;    // null=전체, 값=대분류/소분류
    type?: 'income' | 'expense';  // 카테고리 타입 (전체 지출/수입 구분용)
    monthlyAmount: string;
    projectId?: string;
    /**
     * 이 금액을 적용할 달 ("YYYY-MM"). 화면이 보고 있는 달을 넘긴다.
     *
     * 예산은 기간별로 나뉠 수 있다(applyMode='from'). 이 값이 없으면 서버가
     * 어느 기간의 규칙을 고쳐야 할지 몰라 아무거나 집는다. 실제로 8월까지/9월부터로
     * 나뉜 예산에 금액을 넣으면 9월 규칙이 바뀌고 8월 화면은 그대로여서,
     * 사용자에게는 저장이 안 된 것처럼 보였다.
     *
     * 생략하면 프로젝트 타임존 기준 이번 달로 본다.
     */
    yearMonth?: string;
  }

  export interface UpdateRequest {
    monthlyAmount?: string;
    applyMode?: 'all' | 'from';  // "모든 달" | "이 달부터"
    applyFromMonth?: string;      // applyMode='from'일 때 "YYYY-MM"
  }

  export interface ListQuery {
    projectId?: string;
    categoryId?: string;
    type?: 'income' | 'expense';
  }

  export interface Response {
    id: string;
    projectId: string;
    categoryId?: string;
    type?: 'income' | 'expense';
    /** 금액은 문자열 */
    monthlyAmount: string;
    effectiveFrom?: string;
    effectiveTo?: string;
    createdAt: IsoDateString;
    updatedAt: IsoDateString;
  }

  export interface MonthlyBudget {
    budgetId: string;
    categoryId?: string;
    categoryName?: string;
    categoryType?: 'income' | 'expense';  // 카테고리 타입
    parentCategoryId?: string;  // 대분류 ID (소분류인 경우)
    /** 금액은 문자열 */
    monthlyAmount: string;
    usedAmount?: string;  // 이달 사용금액 (대분류는 소분류 합을 포함한다)
    isOverridden: boolean;  // 직접 오버라이드했는지
    hasChildren: boolean;  // 자식 예산이 있는지
    isVirtualBudget?: boolean;  // 소분류 합으로 만든 가상 예산인지
  }

  export interface OverrideRequest {
    budgetId: string;
    year: number;
    month: number;
    amount: string;
  }

  export interface OverrideResponse {
    id: string;
    budgetId: string;
    year: number;
    month: number;
    amount: string;
    createdAt: IsoDateString;
  }
}

// ===== 공통 응답 =====

/** 커서 기반 페이지. nextCursor가 null이면 마지막 페이지다. */
export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
    /**
     * 서버 로그와 응답을 잇는 상관관계 ID.
     *
     * 예상 못 한 오류는 원인 메시지를 응답에 담지 않는다(내부 쿼리·경로가 샌다).
     * 사용자가 이 값을 알려 주면 로그에서 해당 요청을 찾는다.
     */
    traceId?: string;
  };
  timestamp: string;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp: string;
}
