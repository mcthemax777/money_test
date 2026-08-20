import type {
  IsoDateString,
  User,
  Person,
  Account,
  AccountType,
  Card,
  Category,
  CardStatement,
  FinancialInstitution,
  FinancialInstitutionType,
  StatementStatus,
  EntryKind,
  EntryListItem,
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
    /** 개설 잔액. 전표로 기록되므로 잔액 컬럼에 직접 쓰지 않는다. 금액은 문자열. */
    openingBalance?: string;
    /** 개설 잔액 기준일. 생략하면 오늘. 과거 거래를 입력할 계좌라면 그보다 앞선 날짜를 준다. */
    openingBalanceDate?: IsoDateString;
    currency?: string;
    projectId?: string;
  }

  export interface UpdateRequest {
    name?: string;
    /** null을 주면 기관 연결을 끊는다 */
    institutionId?: string | null;
    accountNumber?: string;
    /**
     * 잔액을 이 값으로 맞춘다. 컬럼을 덮어쓰는 것이 아니라 차액만큼 조정 전표를 남긴다.
     * (잔액 = posting 합계 불변식을 지키기 위함)
     */
    balance?: string;
    /**
     * 잔액 기준일. 생략하면 오늘.
     *
     * "이 날짜의 잔액이 balance였다"는 뜻이다. 차액은 그 날 종료 시점의 잔액을
     * 기준으로 계산하므로, 기준일 이후 거래는 조정 뒤에도 그대로 반영된다.
     */
    balanceDate?: IsoDateString;
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
    /** 화면에 보여주는 "사용액". 부채 잔액의 부호를 뒤집은 값. 체크카드는 null. */
    currentUsage: string | null;
    /** 서버가 include로 함께 준다 */
    issuer?: FinancialInstitution;
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

    // ── transfer ──
    toAccountId?: string;
    transferFee?: string;
    transferFeeCategoryId?: string;

    // ── card_payment ──
    statementId?: string;

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

// ===== CardStatement =====

export namespace StatementDto {
  export interface Response extends CardStatement {
    cardName: string;
    /** 이 청구서에 달린 사용액 합계 (양수) */
    chargedAmount: string;
    /** 이 청구서에 대해 결제된 금액 (양수) */
    paidAmount: string;
    /** 아직 갚지 않은 금액 (양수) */
    outstanding: string;
  }

  export interface ListQuery {
    status?: StatementStatus;
  }

  /** 청구서 대금 결제 */
  export interface PayRequest {
    /** 대금이 빠져나갈 통장 */
    accountId: string;
    personId: string;
    /** 금액은 문자열. 생략하면 미결제 전액 */
    amount?: string;
    date?: IsoDateString;
    description?: string;
  }
}

// ===== Reports =====

/**
 * 집계는 전부 서버에서 한다.
 * "지출 = 지출 카테고리 posting의 합"이 서버 한 곳에 고정되므로
 * 화면마다 합계가 어긋나던 문제가 재발할 수 없다.
 */
export namespace ReportDto {
  export interface MonthQuery extends EntryFilterQuery {
    projectId?: string;
    /** "YYYY-MM" */
    yearMonth: string;
    /** 한 사람만 볼 때. 여러 명은 personIds를 쓴다. */
    personId?: string;
  }

  /** 대시보드 / 통계 헤더의 월 합계 */
  export interface Summary {
    yearMonth: string;
    income: string;
    expense: string;
    fixedExpense: string;
    variableExpense: string;
    /** 수입 - 지출 */
    net: string;
  }

  export interface CategoryBreakdownQuery extends MonthQuery {
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
