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
  EntryDraft,
  EntryDraftSource,
  EntryDraftStatus,
  RecurringRule,
  Tag,
  CardTransferDirection,
  Posting,
} from './entities';
import type { EntrySearchQuery } from './entry-search';
import type { RecurringFrequency } from './recurring';

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
    /**
     * 기기가 만든 식별자 (UUID). 생략하면 서버가 만든다.
     *
     * 오프라인에서 적은 것을 곧바로 고치고 지우려면 이름이 먼저 있어야 하고,
     * 같은 명령을 다시 보내도 행이 하나로 남으려면 그 이름이 기기에서 정해져
     * 있어야 한다. 형식 검사는 `isClientId` 가 한다.
     */
    id?: string;
    name: string;
    relationship?: string;
    projectId?: string;
  }

  export interface UpdateRequest {
    name?: string;
    relationship?: string;
    isActive?: boolean;
    /**
     * 목록에서의 자리 (분수 색인, `@money/types` 의 rank).
     *
     * 순서 바꾸기를 **이 항목 한 줄의 값**으로 다룬다. 목록 전체를 다시 쓰지 않으므로,
     * 두 사람이 각자 다른 항목을 옮겨도 둘 다 남는다.
     */
    sortRank?: string;
  }

  export interface Response extends Person {}
}

// ===== Account =====

export namespace AccountDto {
  export interface CreateRequest {
    /**
     * 기기가 만든 식별자 (UUID). 생략하면 서버가 만든다.
     *
     * 오프라인에서 적은 것을 곧바로 고치고 지우려면 이름이 먼저 있어야 하고,
     * 같은 명령을 다시 보내도 행이 하나로 남으려면 그 이름이 기기에서 정해져
     * 있어야 한다. 형식 검사는 `isClientId` 가 한다.
     */
    id?: string;
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
    /** 목록에서의 자리 (분수 색인). 순서 바꾸기는 이 값 하나로 한다. */
    sortRank?: string;
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
    /*
     * 설명이 빈 줄의 이름으로 쓸 분류. 목록 한 줄과 같은 규칙이다 (EntryListItem).
     *
     * 이체 계열(계좌 다리가 둘 이상)에는 없다 -- 그 전표의 카테고리 다리는 수수료라
     * 대표 분류가 아니다. 소분류면 `parentCategoryName` 이 함께 온다.
     */
    categoryName: string | null;
    parentCategoryName: string | null;
    /**
     * 이 거래를 카드 실적에 세는가.
     *
     * 이 값만으로 실적에 드는 줄을 가릴 수는 없다 -- 대금 결제도 true 로 온다. 실적
     * 탭이 그리는 줄은 서버가 따로 골라 준다 (`CardDto.PerformanceLedgerRow`).
     */
    countsPerformance: boolean;
  }

  export type LedgerResponse = CursorPage<LedgerRow>;

  /** 계좌 원장 한 쪽을 부를 때의 조건. */
  export interface LedgerQuery {
    limit?: number;
    cursor?: string;
    /**
     * 이 구간의 줄만. 카드 상세에서 청구 주기 하나를 골랐을 때 쓴다.
     *
     * 줄에 붙는 잔액은 **구간과 상관없이** 맨 앞부터 쌓은 값이다. 구간만큼만 세면
     * 그 줄의 잔액이 통장의 실제 잔액과 달라진다.
     */
    startDate?: IsoDateString;
    endDate?: IsoDateString;
  }
}


// ===== Card =====

export namespace CardDto {
  export interface CreateRequest {
    /**
     * 신용카드의 부채 계정 식별자 (UUID). 카드와 함께 만들어진다.
     *
     * 기기가 id 를 만들 때는 이것도 함께 보낸다. 부채 계정 id 를 서버가 정하면
     * 오프라인에서 그 카드로 적은 거래가 어느 계정을 가리킬지 알 수 없다.
     * 체크카드는 빚이 생기지 않으므로 쓰지 않는다.
     */
    liabilityAccountId?: string;
    /**
     * 기기가 만든 식별자 (UUID). 생략하면 서버가 만든다.
     *
     * 오프라인에서 적은 것을 곧바로 고치고 지우려면 이름이 먼저 있어야 하고,
     * 같은 명령을 다시 보내도 행이 하나로 남으려면 그 이름이 기기에서 정해져
     * 있어야 한다. 형식 검사는 `isClientId` 가 한다.
     */
    id?: string;
    /** 사용자가 고른 실제 통장. 필수이며 서버가 새로 만들지 않는다. */
    paymentAccountId: string;
    name: string;
    cardNumber?: string; // 실제 번호 (서버에서 마스킹)
    cardType: 'debit' | 'credit';
    /** 카드사. FinancialInstitution(type = card_issuer)의 id */
    issuerId: string;
    expiryDate?: IsoDateString;
    creditLimit?: string; // 신용카드만. 금액은 문자열
    /** 실적 기준액. 체크카드도 쓴다 (달력 월로 센다). 빈 값이면 조건 없음. */
    performanceAmount?: string;
    statementClosingDay?: number; // 신용카드 필수. 1~31
    paymentDueDay?: number;       // 신용카드 필수. 1~31
    /** 카드 앞면 색 (CardColor). 생략하면 카드 종류의 기본색이다. */
    color?: string;
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
    /** 실적 기준액. 빈 문자열을 보내면 조건을 지운다. */
    performanceAmount?: string;
    statementClosingDay?: number;
    paymentDueDay?: number;
    /** 카드 앞면 색 (CardColor) */
    color?: string;
    isActive?: boolean;
    /** 목록에서의 자리 (분수 색인). 순서 바꾸기는 이 값 하나로 한다. */
    sortRank?: string;
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
    /**
     * 이 주기의 이름 ('YYYY-MM'). 신용카드는 마감 연월, 체크카드는 달력 월이다.
     *
     * 화면이 주기 하나를 골라 목록을 좁힐 때 이 값으로 가리킨다. 날짜 두 개로 가리키면
     * 실적 원장처럼 주기가 곧 단위인 자리에서 경계를 다시 맞춰야 한다.
     */
    closingKey: string;
    /** `@db.Date` 성격의 달력 날짜 표시자 */
    periodStart: IsoDateString;
    periodEnd: IsoDateString;
    /** 대금이 빠지는 날. 체크카드는 결제 즉시 빠지므로 없다. */
    dueDate?: IsoDateString;
    /** 마감일이 지났으면 true. 진행 중인 주기는 금액이 더 늘 수 있다. */
    closed: boolean;
    /**
     * 이 주기의 **실적** 사용액. 할부는 회차분만 들어간다.
     *
     * 실적에서 뺀 거래(`countsPerformance` 가 꺼진 것)는 여기 들지 않는다. 카드사가
     * 혜택을 정할 때 세는 값이 이것이다.
     */
    usage: string;
    /**
     * 이 주기에 **청구되는** 금액. 실적에서 뺀 거래까지 전부 들어간다.
     *
     * `usage` 와 다른 값이다. 세금·공과금처럼 청구는 되지만 실적에서 빠지는 결제가
     * 있어, 둘을 한 값으로 두면 그래프가 남은 대금과 어긋난다.
     */
    billed: string;
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

  /**
   * 실적 진행 상황.
   *
   * 실적을 세는 구간이 카드 종류마다 다르다. 신용카드는 마감일 기준 청구 주기이고
   * (카드사가 그 주기의 사용액으로 다음 달 혜택을 정한다), 체크카드는 청구 주기가
   * 없으므로 달력 월이다.
   */
  export interface PerformanceResponse {
    cardId: string;
    /** 사용액·기준액의 통화 (= 결제 통장의 통화). 기준통화 환산액이 아니다. */
    currency: string;
    /** 'statement' = 마감일 기준 청구 주기, 'month' = 달력 월 */
    basis: 'statement' | 'month';
    /** 지금 세고 있는 구간. 양끝을 포함하는 달력 날짜다. */
    periodStart: IsoDateString;
    periodEnd: IsoDateString;
    /** 이 구간에 쓴 금액 */
    usage: string;
    /**
     * 직전 구간과 그 사용액.
     *
     * 진행 중인 구간은 첫날 0원에서 시작한다. 그 숫자만 보면 "이번 달은 아직
     * 안 썼다"는 것 말고 알 수 있는 게 없어서, 직전 구간을 함께 준다.
     */
    previousPeriodStart: IsoDateString;
    previousPeriodEnd: IsoDateString;
    previousUsage: string;
    /** 실적 기준액. 카드에 설정하지 않았으면 null이고 아래 두 값도 뜻이 없다. */
    target: string | null;
    /** 기준을 채웠는지. target이 없으면 false */
    achieved: boolean;
    /** 기준까지 남은 금액. 이미 채웠으면 '0'. target이 없으면 null */
    remaining: string | null;
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

  /**
   * 실적 원장 한 줄.
   *
   * 계좌 원장 한 줄(`AccountDto.LedgerRow`)과 같은 모양이되 **잔액 자리에 쌓인 실적이
   * 든다.** 카드 상세의 실적 탭이 그리는 값은 남은 대금이 아니라 "이 주기에 지금까지
   * 얼마를 쌓았나"라서다.
   *
   * 할부는 회차마다 한 줄이다. 주기별 합계(`UsagePeriod.usage`)가 회차분만 세므로,
   * 구매한 달에 전액을 한 줄로 두면 줄의 합과 진행률 막대가 갈린다.
   */
  export interface PerformanceLedgerRow {
    /**
     * 줄을 가르는 값. 다리 id 하나로는 모자란다.
     *
     * 할부는 한 다리가 여러 주기에 나뉘어 들어가, 회차 번호까지 붙여야 줄마다 다르다.
     */
    key: string;
    entryId: string;
    date: IsoDateString;
    description: string;
    merchant: string | null;
    /** 카드 관점의 증감. 계좌 원장과 같은 부호 규칙이라 **사용이 음수**다. */
    amount: string;
    /** 이 주기 시작부터 이 줄까지 쌓인 실적. 사용이 양수다. */
    performanceAfter: string;
    /** 이 줄이 든 주기의 시작. 같은 값을 가진 줄끼리 한 머리글 아래 선다. */
    periodStart: IsoDateString;
    cardId: string | null;
    cardName: string | null;
    categoryName: string | null;
    parentCategoryName: string | null;
    /** 할부 회차와 개월수. 일시불이면 둘 다 1 이다. */
    installmentIndex: number;
    installmentMonths: number;
  }

  /**
   * 실적 원장의 한 주기. 줄의 머리글이 되는 값이다.
   *
   * 합계는 **그 주기 전부**의 값이다. 한 쪽에 그 주기의 뒷부분만 실려 와도 머리글의
   * 숫자는 달라지지 않는다 -- 주기는 통째로 세고 자르는 것은 보여 줄 줄뿐이다.
   */
  export interface PerformanceLedgerPeriod {
    periodStart: IsoDateString;
    periodEnd: IsoDateString;
    /** 마감일이 지났으면 true. 진행 중인 주기는 더 늘 수 있다. */
    closed: boolean;
    /** 이 주기의 실적 합계. 가장 오래된 줄부터 더한 값이고 `UsagePeriod.usage` 와 같다. */
    total: string;
  }

  /**
   * 카드 실적 원장 한 쪽. 주기마다 0에서 다시 쌓는다.
   *
   * 다른 원장과 같은 수만큼 끊어 준다. 줄에 붙은 누적은 잘린 자리와 상관없이 **주기
   * 시작부터** 센 값이다 -- 주기는 통째로 만들어 두고 자르는 것은 보여 줄 줄뿐이다.
   */
  /** 실적 원장 한 쪽을 부를 때의 조건. */
  export interface PerformanceLedgerQuery {
    limit?: number;
    cursor?: string;
    /**
     * 이 주기의 줄만 ('YYYY-MM', `UsagePeriod.closingKey`).
     *
     * 그래프에서 주기 하나를 골랐을 때 쓴다. 날짜 구간이 아니라 주기 이름으로 가리키는
     * 것은, 할부 회차가 산 날이 아니라 청구되는 주기에 쌓이기 때문이다 -- 날짜로 자르면
     * 그 주기에 쌓인 회차가 빠진다.
     */
    closingKey?: string;
  }

  export interface PerformanceLedgerResponse {
    cardId: string;
    /** 아래 금액들의 통화 (= 결제 통장의 통화) */
    currency: string;
    /** 'statement' = 마감일 기준 청구 주기, 'month' = 달력 월 */
    basis: 'statement' | 'month';
    /** 실적 기준액. 설정하지 않았으면 null 이다. */
    target: string | null;
    /** 이 쪽에 실린 줄들이 속한 주기. 최신이 앞이다. */
    periods: PerformanceLedgerPeriod[];
    /** 줄. 최신이 앞이고, 주기가 바뀌는 자리는 `periodStart` 로 가른다. */
    rows: PerformanceLedgerRow[];
    /** 다음 쪽을 부를 자리. null 이면 더 볼 것이 없다. */
    nextCursor: string | null;
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
}

/**
 * 기간 조회가 함께 받는 조건. 사람 필터에 거래 화면의 검색이 얹힌 것.
 *
 * 한 덩이로 두는 이유는 셋이 언제나 함께 다니기 때문이다. 검색을 켠 채 달을 훑으면
 * 년월 목록도, 그 안의 분류별·수단별 목록도, 마지막 거래 목록도 같은 조건으로
 * 걸러져야 화면 안에서 숫자가 어긋나지 않는다.
 */
export type EntryScopeQuery = EntryFilterQuery &
  EntrySearchQuery & {
    /** 한 사람만 볼 때. 여러 명은 personIds 를 쓴다. */
    personId?: string;
  };

export namespace EntryDto {
  /**
   * 화면이 다루는 개념 그대로 받는다. 서버가 전표(postings)로 번역한다.
   * 클라이언트는 Posting을 직접 만들지 않는다.
   */
  export interface CreateRequest {
    /**
     * 기기가 만든 식별자 (UUID). 생략하면 서버가 만든다.
     *
     * 오프라인에서 적은 것을 곧바로 고치고 지우려면 이름이 먼저 있어야 하고,
     * 같은 명령을 다시 보내도 행이 하나로 남으려면 그 이름이 기기에서 정해져
     * 있어야 한다. 형식 검사는 `isClientId` 가 한다.
     */
    id?: string;
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
    /**
     * 분류 줄 하나뿐인 거래의 줄 키. **화면이 만든다** (uuid).
     *
     * 지출·수입에는 반드시 있어야 하고, 없으면 서버가 거절한다. 줄에 붙는 것(태그·차감)이
     * 이 키에 매달리는데, 서버가 대신 만들면 그 연결이 저장할 때마다 끊긴다.
     * 분할이면 `splits[].lineKey` 가 대신 쓰인다.
     */
    lineKey?: string;
    /**
     * 한 결제를 여러 카테고리로 쪼갤 때. 지정하면 categoryId/amount 대신 이 값을 쓴다.
     *
     * 태그와 차감이 줄마다 따로다. 여행경비만 환불받았다면 그 줄의 `discountAmount`
     * 에만 값이 실리고, 식비 줄은 그대로 남는다.
     *
     * **실적 두 칸은 줄에 없다.** 카드사가 보는 것은 승인 한 건이라 거래에 하나씩 둔다
     * (`countsPerformance`, `discountCountsPerformance`).
     */
    splits?: Array<{
      categoryId: string;
      amount: string;
      /** 이 줄의 키. 화면이 만들어 편집 내내 들고 다닌다. */
      lineKey: string;
      /** 이 줄에서 깎인 금액. `amount` 는 정가 그대로 보낸다. 정가보다 클 수 없다. */
      discountAmount?: string;
      /** 이 줄에 붙일 태그. 생략은 "비운다"다 (`tagIds` 와 같은 규칙). */
      tagIds?: string[];
    }>;
    /** 이체 수수료 줄의 키. 수수료를 적었으면 함께 보낸다. */
    transferFeeLineKey?: string;

    /**
     * 붙일 태그.
     *
     * **태그는 줄에 붙는다.** 지출·수입이면 이 목록은 그 거래의 분류 줄 하나에 붙고,
     * 분할이면 `splits[].tagIds` 를 대신 쓴다. 이체와 카드 대금 결제는 분류 줄이 없어
     * 거래 자체에 붙는다.
     *
     * **수정은 전체 교체다.** 준 목록이 그대로 그 줄의 태그가 되고, 생략하면 태그를
     * 건드리지 않는 것이 아니라 **비운다** -- 수정이 전표를 통째로 갈아 끼우는 것과
     * 같은 규칙이라, 여기만 "생략은 유지"로 두면 태그를 다 뗀 수정과 구별할 수 없다.
     */
    tagIds?: string[];

    // ── 결제수단 (expense·income 모두 둘 중 하나) ──
    /**
     * 수입에도 카드를 쓸 수 있다.
     *
     * 카드사가 되돌려 주는 돈이 통장을 거치지 않고 다음 청구에서 빠지는 일이 있어,
     * 그때 돈이 들어오는 자리는 통장이 아니라 그 카드의 빚이다.
     */
    accountId?: string;
    cardId?: string;
    /**
     * 할부 개월수. 신용카드 지출에만 쓰며 2 이상일 때 할부가 된다.
     *
     * 원금과 지출은 구매 시점에 전액 잡힌다. 이 값은 "언제 청구되는지"만 나눈다.
     * 회차별 금액과 귀속 주기는 저장하지 않고 읽을 때 계산한다.
     */
    installmentMonths?: number;

    // ── 즉시 차감 (expense) ──
    /**
     * 분류 줄 하나뿐인 거래에서 그 줄이 깎인 금액. 분할이면 `splits[].discountAmount`.
     *
     * 카드 포인트 사용, 자동할인, 그리고 **취소**가 든다.
     *
     * `amount` 는 정가 그대로 보낸다. 서버가 정가를 분류에, 이 값을 차감 분류에 음수로
     * 적어 실제로 나간 돈과 지출 총계를 맞춘다. 정가보다 작아야 한다.
     *
     * 청구서에서 나중에 빠지는 신용카드 청구할인은 여기 들지 않는다. 그쪽은 결제
     * 시점에 전액이 승인되어 부채가 그대로 잡힌다.
     */
    discountAmount?: string;
    /**
     * 이 거래를 카드 실적에 셀지. 카드로 낼 때만 뜻이 있다.
     *
     * **분할해도 하나다.** 카드사가 보는 것은 승인 한 건이라, 분류로 나눴다고 절반만
     * 실적에 드는 일은 없다.
     *
     * 생략하면 갈래의 기본값을 쓴다 -- **지출은 포함, 카드로 들어온 수입은 제외**다.
     * 꺼도 갚을 대금은 그대로 남는다. 실적과 청구액은 다른 값이다.
     */
    countsPerformance?: boolean;
    /**
     * 차감·취소 금액을 카드 실적에서도 뺄지. 지출에만 뜻이 있다. **분할해도 하나다.**
     *
     * 깎인 금액은 줄마다 따로 적지만, 그것을 실적에서 뺄지는 카드사의 방침 하나라
     * 거래에 둔다. 생략하면 뺀다 -- 다리에 이미 깎인 금액이 들어가 있어 그것이
     * 지금까지의 동작이고, 꺼 두면 실적만 정가로 센다.
     */
    discountCountsPerformance?: boolean;

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
  export interface UpdateRequest extends Omit<CreateRequest, 'projectId'> {
    /**
     * 이 수정이 딛고 선 판. 폼을 열 때 받은 `EntryListItem.updatedHlc` 를 그대로 되돌려 준다.
     *
     * 서버는 지금 값과 견주어 다르면 저장하지 않고 `ENTRY_MODIFIED` 로 거절한다. 폼을
     * 열어 둔 사이에 다른 사람이 같은 거래를 고쳤다는 뜻이고, 그대로 저장하면 그 편집이
     * 아무 흔적 없이 사라진다 (설계 문서의 D6).
     *
     * **생략하면 검사하지 않는다.** 옛 화면과, 시계가 없던 시절의 전표를 위해 남긴
     * 자리다. 새 화면은 언제나 보낸다.
     */
    baseHlc?: string | null;
  }

  /**
   * 여러 거래의 태그를 한 번에 바꾼다. 목록에서 여러 건을 골라 정리할 때 쓴다.
   *
   * 수정(전체 교체)과 갈라 둔 이유가 둘이다.
   *
   * 1. **바꿀 것만 말한다.** 더할 것과 뗄 것을 따로 받고, 어느 쪽에도 없는 태그는
   *    건드리지 않는다. 여러 건을 한꺼번에 다룰 때 고른 거래마다 붙은 태그가 다를 수
   *    있어, 목록 하나를 "이것이 전부다"로 받으면 화면에 보이지 않던 태그가 사라진다.
   * 2. **전표를 건드리지 않는다.** 수정은 다리를 지우고 다시 만드는데, 그러려면 금액·
   *    분할·외화까지 온전한 값을 보내야 한다. 목록 한 줄(`EntryListItem`)에는 분할의
   *    나머지 줄이 없어, 그것으로 수정을 만들면 분할 거래가 조용히 뭉개진다.
   */
  export interface ChangeTagsRequest {
    /**
     * 손댈 줄. 한 번에 보낼 수 있는 수는 서버가 제한한다.
     *
     * 태그가 줄에 붙으므로 대상도 줄이다 -- 목록에서 분할 거래의 한 줄만 골라 표시할
     * 수 있어야 하고, 그것이 이 바꿈을 전표 단위로 두지 않은 까닭이다. 분류 줄이 없는
     * 거래(이체, 카드 대금 결제)는 `lineKey` 를 null 로 둔다.
     */
    targets: Array<{ entryId: string; lineKey?: string | null }>;
    /** 더할 태그. 이미 붙어 있는 것은 그대로 지나간다. */
    addTagIds?: string[];
    /** 뗄 태그. 붙어 있지 않은 것은 그대로 지나간다. */
    removeTagIds?: string[];
    projectId?: string;
  }

  export interface ChangeTagsResponse {
    /** 새로 붙은 연결의 수. 이미 붙어 있던 것은 세지 않는다. */
    added: number;
    /** 떼어 낸 연결의 수. 붙어 있지 않던 것은 세지 않는다. */
    removed: number;
    /** 태그가 하나라도 달라진 거래의 수. 줄 수가 아니다. */
    entries: number;
    /**
     * 적용하지 못한 대상. 그 줄이 이미 사라진 경우다.
     *
     * 다른 기기가 그 사이 분할을 고쳤거나 거래를 지웠으면 붙일 자리가 없다. 조용히
     * 버리면 사용자는 표시가 된 줄 알고 다음 동기화가 덮을 때에야 알게 되므로,
     * 무엇이 빠졌는지 돌려주어 화면이 한 번 알린다.
     */
    skipped: Array<{ entryId: string; lineKey?: string | null }>;
  }

  export interface ListQuery extends EntryFilterQuery, EntrySearchQuery {
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

    /*
     * 거래 화면의 검색(분류 여럿·자산 여럿·유형)은 `EntrySearchQuery` 가 갖는다.
     * 무리 안은 OR, 무리끼리는 AND 이고 그 규칙은 `types/entry-search.ts` 하나다.
     */
    personId?: string;
    categoryId?: string;
    /**
     * 단일 `categoryId` 를 정확히 그 분류로만 본다 (소분류 제외).
     *
     * 기본은 대분류를 지정하면 소분류 거래까지 포함이다. 예산 화면의 "미분류"(소분류
     * 없이 대분류에 바로 기록한 건)만 따로 보려면 이 값을 켠다.
     *
     * 거래 화면의 검색은 이 값을 쓰지 않는다. 그쪽은 분류를 여럿 고르고 **분류마다**
     * 전체·미분류가 갈려야 해서, 고른 값 자체에 표를 붙인다 (`SELF_CATEGORY_PREFIX`).
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
    /**
     * 한 달을 본다 ("YYYY-MM"). `startDate`/`endDate` 보다 앞선다.
     *
     * 왜 따로 두는가. 달의 경계는 **프로젝트 타임존의 벽시계**다. 부르는 쪽이 그것을
     * 인스턴트로 만들어 넘기면 두 가지가 어긋난다.
     *
     *   ① 달 길이. `"2026-11-31"` 은 오류가 아니라 **2026-12-01 로 넘어간다**(2월은
     *      3월 3일까지). 그렇게 만든 구간은 다음 달 초하루를 함께 담는다.
     *   ② 시차. `"2026-08-01"` 은 UTC 자정이라 한국의 8월 1일 오전 9시부터다.
     *      그 앞 아홉 시간의 거래가 목록에서 빠지는데, 월 합계는 그것을 세고 있다.
     *
     * 달 이름을 그대로 넘기면 양쪽이 각자 아는 방법으로 경계를 만든다. 서버는
     * `zonedMonthRange` 로, 기기는 동기화할 때 박아 둔 `yearMonth` 컬럼으로.
     */
    yearMonth?: string;
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
    /**
     * 기기가 만든 식별자 (UUID). 생략하면 서버가 만든다.
     *
     * 오프라인에서 적은 것을 곧바로 고치고 지우려면 이름이 먼저 있어야 하고,
     * 같은 명령을 다시 보내도 행이 하나로 남으려면 그 이름이 기기에서 정해져
     * 있어야 한다. 형식 검사는 `isClientId` 가 한다.
     */
    id?: string;
    name: string;
    parentId?: string; // 소분류인 경우 대분류 ID
    type: 'income' | 'expense';
    icon?: string;
    projectId?: string;
  }

  export interface UpdateRequest {
    name?: string;
    icon?: string;
    /**
     * **오직 `false` 만, 그리고 "지워 달라"는 뜻으로만 쓴다.**
     *
     * 분류와 태그에는 감춰진 상태가 없다 -- 지우기는 행을 정말 지운다. 그런데 기기가
     * 끊긴 동안 쌓는 명령(`category.update`·`tag.update`)에는 지우기 갈래가 따로 없어,
     * 이 칸이 그 표식 노릇을 한다. 서버는 이 값을 보면 `deleteCategory`/`deleteTag` 를
     * 부르고, 그 앞의 조건(거래가 없을 것, 붙은 자리를 뗄 것)을 그대로 지킨다.
     *
     * 표에는 이런 칸이 없다. 값을 저장하는 자리가 아니라 명령의 이름이다.
     */
    isActive?: false;
    /** 목록에서의 자리 (분수 색인). 순서 바꾸기는 이 값 하나로 한다. */
    sortRank?: string;
  }

  export interface Response extends Category {}

  export interface Tree extends Response {
    children?: Tree[];
  }

  /**
   * 분류 하나를 없애면서 그 거래를 다른 분류로 옮긴다.
   *
   * **옮길 곳을 줄마다 고른다.** 대분류를 없애면 그 소분류도 함께 사라지는데, 소분류마다
   * 성격이 달라 한 곳으로 몰아 보낼 수 없다 ("식비 > 외식"과 "식비 > 카페"가 같은 데로
   * 갈 까닭이 없다). 그래서 없앨 것마다 짝을 적는다.
   *
   * 없애기만 하고 옮기지 않는 길은 여기 없다. 거래가 없는 분류는 그냥 지우면 된다
   * (`DELETE /categories/:id`). 이 요청은 거래가 있어서 막힌 자리를 푸는 것이다.
   */
  export interface MergeRequest {
    projectId?: string;
    moves: MergeMove[];
  }

  export interface MergeMove {
    /** 없앨 분류. 이 분류에 달린 거래가 `toId` 로 옮겨진 뒤 감춰진다. */
    fromId: string;
    /**
     * 옮겨 받을 분류. 같은 유형이어야 하고, 함께 없애는 것 중 하나일 수 없다.
     *
     * **없으면 옮기지 않고 감추기만 한다.** 거래가 하나도 없는 분류에는 옮길 것이
     * 없는데, 그때도 갈 곳을 고르게 하면 대분류 하나를 없애려고 빈 소분류마다
     * 뜻 없는 선택을 해야 한다. 거래가 있는 분류에 이 값이 없으면 서버가 막는다.
     */
    toId?: string;
  }

  /**
   * 이 분류와 그 소분류에 달린 거래 다리의 수. 열쇠는 분류 id 다.
   *
   * 없애기 전에 묻는 데 쓴다. 거래가 있으면 곧바로 "어떻게 할까요"를 내주고, 없으면
   * 지금까지처럼 한 번 물어보고 지운다. 소분류마다 따로 세는 까닭은, 대분류를 없앨 때
   * 거래가 있는 소분류에만 갈 곳을 묻기 위해서다.
   */
  export interface UsageResponse {
    counts: Record<string, number>;
  }

  /** 통합의 결과. 몇 줄이 옮겨졌는지 알려 준다. */
  export interface MergeResponse {
    /** 옮긴 거래 다리의 수. 화면이 "N건을 옮겼습니다"로 적는다. */
    movedPostings: number;
    /** 감춘 분류의 수. 대분류를 없애면 소분류까지 세어진다. */
    removedCategories: number;
  }
}

/**
 * 보관함. 아직 거래가 아닌 후보를 담는다.
 *
 * 만드는 쪽은 **기기**다. 알림을 읽고 캡처에서 글자를 뽑아 문구를 해석하는 일은
 * 전부 기기에서 끝나고, 서버는 그 결과를 받아 두었다가 다른 기기와 웹에 나른다.
 * 그래서 이 창구에는 "문구를 해석해 달라"는 요청이 없다 -- 해석은 core 의
 * `draft-parse` 가 한 자리에서 한다.
 *
 * 등록(후보 -> 거래)도 여기 없다. 거래를 만드는 길은 하나여야 하므로
 * (`EntryDto.CreateRequest` 와 오프라인 명령), 화면은 그 길로 거래를 만든 뒤
 * `markRegistered` 로 후보에 표시만 남긴다.
 */
export namespace EntryDraftDto {
  export interface ListQuery {
    projectId?: string;
    source?: EntryDraftSource;
    /** 생략하면 대기 중인 것만 온다. 등록·무시된 것은 목록의 본론이 아니다. */
    status?: EntryDraftStatus | 'all';
    limit?: number;
  }

  /**
   * 기기가 만든 후보 하나.
   *
   * `id` 를 기기가 정한다. 오프라인에서 사본에 먼저 담고 나중에 올리므로, 서버가
   * 이름을 붙이면 그때까지 화면이 가리킬 것이 없다 (전표와 같은 규칙이다).
   */
  export interface CreateItem {
    id?: string;
    source: EntryDraftSource;
    dedupeKey: string;
    rawText: string;
    appPackage?: string | null;
    appTitle?: string | null;
    kind?: EntryKind | null;
    amount?: string | null;
    currency?: string | null;
    occurredAt?: IsoDateString | null;
    merchant?: string | null;
    description?: string | null;
    installmentMonths?: number | null;
    personId?: string | null;
    categoryId?: string | null;
    accountId?: string | null;
    cardId?: string | null;
    /** 붙일 태그. 반복에서 온 후보만 채운다 (그 규칙의 태그다). */
    tagIds?: string[];
    confidence?: number;
    parser?: string | null;
    /**
     * 이 후보를 만든 반복 등록.
     *
     * 반복에서 온 후보만 채운다. 서버는 이것으로 그 규칙이 이 가계부의 것인지, 열쇠와
     * 날짜가 규칙에 맞는지 본다.
     */
    recurringRuleId?: string | null;
  }

  /**
   * 여러 건을 한 번에 담는다.
   *
   * 캡처 하나에서 대여섯 건이 나오고, 알림도 오프라인 동안 쌓였다가 한꺼번에
   * 올라간다. 건마다 요청을 보내면 그만큼 실패할 자리가 늘어난다.
   */
  export interface CreateRequest {
    projectId?: string;
    drafts: CreateItem[];
  }

  /** 담은 결과. 이미 있던 것은 `skipped` 로 센다 (같은 dedupeKey). */
  export interface CreateResponse {
    created: number;
    skipped: number;
    drafts: Response[];
  }

  /** 사람이 후보를 손볼 때. 준 칸만 바꾼다. */
  export interface UpdateRequest {
    kind?: EntryKind | null;
    amount?: string | null;
    currency?: string | null;
    occurredAt?: IsoDateString | null;
    merchant?: string | null;
    description?: string | null;
    installmentMonths?: number | null;
    personId?: string | null;
    categoryId?: string | null;
    accountId?: string | null;
    cardId?: string | null;
    /** 준 배열로 통째로 갈아 끼운다. 생략하면 건드리지 않는다. */
    tagIds?: string[];
    status?: EntryDraftStatus;
    /** 등록으로 만들어진 거래. status 를 registered 로 바꿀 때 함께 준다. */
    registeredEntryId?: string | null;
  }

  export interface Response extends EntryDraft {}
}

/**
 * 반복 등록. 정해 둔 날마다 보관함에 후보를 만든다.
 *
 * 일정 셈(`@money/types` 의 recurring)은 서버와 화면이 함께 쓴다. 이 창구는 규칙을
 * 담고 꺼내는 일만 하고, "언제 만들어지는가"는 그 셈이 정한다.
 */
export namespace RecurringRuleDto {
  /** 일정과 담을 값. 만들 때와 고칠 때가 같은 모양이다. */
  export interface Body {
    isActive?: boolean;
    frequency: RecurringFrequency;
    /** daily: 며칠마다. 생략하면 1 (매일) */
    everyDays?: number | null;
    /** monthly·yearly: 며칟날 */
    dayOfMonth?: number | null;
    /** yearly: 몇 월 */
    month?: number | null;
    /** "YYYY-MM-DD" (프로젝트 타임존의 달력 날짜) */
    startDate: string;
    endDate?: string | null;
    /** "HH:mm". 없으면 그 날 정오로 만든다. */
    timeOfDay?: string | null;

    kind: EntryKind;
    amount?: string | null;
    currency?: string | null;
    description: string;
    merchant?: string | null;
    personId?: string | null;
    categoryId?: string | null;
    accountId?: string | null;
    cardId?: string | null;
    installmentMonths?: number | null;
    /**
     * 이 반복이 만드는 후보에 붙일 태그.
     *
     * 준 배열로 통째로 갈아 끼운다. 고치기에서 생략하면 건드리지 않는다 -- 빈 배열은
     * "전부 뗀다" 이고 생략은 "그대로 둔다" 다.
     */
    tagIds?: string[];
  }

  export interface CreateRequest extends Body {
    /** 기기가 만든 식별자 (UUID). 규칙은 `CategoryDto.CreateRequest.id` 와 같다. */
    id?: string;
    projectId?: string;
  }

  /** 고치기. 준 칸만 바꾼다. */
  export interface UpdateRequest extends Partial<Body> {}

  export interface Response extends RecurringRule {
    /**
     * 다음에 후보가 만들어질 날. 끝났으면 null 이다.
     *
     * 서버가 셈해 실어 보낸다 -- 화면이 저마다 세면 "오늘"의 기준(타임존)이 달라져
     * 하루 어긋난 날이 보인다.
     */
    nextRunOn: string | null;
    /**
     * 이 반복으로 후보를 만든 마지막 날. 만든 것이 없으면 null 이다.
     *
     * **저장된 값이 아니라 후보에서 셈한 값이다** (`r:<규칙>:<날짜>` 열쇠의 최댓값).
     * 회차를 만드는 쪽이 기기라, 서버가 따로 표를 들고 있으면 그 표와 실제 후보가
     * 어긋날 수 있다 -- 올리다 끊긴 회차가 "만들었다"로 남으면 아무도 그 날을 다시
     * 만들지 않는다. 후보 자신을 세면 그런 자리가 없다.
     *
     * 기기는 이 날 다음부터 셈해 올린다.
     */
    lastMadeOn: string | null;
  }
}

/**
 * 태그. 카테고리와 나란히 서지만 계층도 유형도 없어 훨씬 짧다.
 *
 * 목록(`Tree`)에 해당하는 것이 없다. 평평한 배열 하나가 전부다.
 */
export namespace TagDto {
  export interface CreateRequest {
    /** 기기가 만든 식별자 (UUID). 규칙은 `CategoryDto.CreateRequest.id` 와 같다. */
    id?: string;
    name: string;
    /** "#RRGGBB". 생략하면 색을 정하지 않은 것이다. */
    color?: string;
    projectId?: string;
  }

  export interface UpdateRequest {
    name?: string;
    /** null 을 주면 색을 지운다. 생략은 "건드리지 않는다"이고 둘은 다르다. */
    color?: string | null;
    /**
     * **오직 `false` 만, 그리고 "지워 달라"는 뜻으로만 쓴다.**
     *
     * 분류와 태그에는 감춰진 상태가 없다 -- 지우기는 행을 정말 지운다. 그런데 기기가
     * 끊긴 동안 쌓는 명령(`category.update`·`tag.update`)에는 지우기 갈래가 따로 없어,
     * 이 칸이 그 표식 노릇을 한다. 서버는 이 값을 보면 `deleteCategory`/`deleteTag` 를
     * 부르고, 그 앞의 조건(거래가 없을 것, 붙은 자리를 뗄 것)을 그대로 지킨다.
     *
     * 표에는 이런 칸이 없다. 값을 저장하는 자리가 아니라 명령의 이름이다.
     */
    isActive?: false;
    /** 목록에서의 자리 (분수 색인). 순서 바꾸기는 이 값 하나로 한다. */
    sortRank?: string;
  }

  export interface Response extends Tag {}

  /**
   * 이 태그가 붙어 있는 자리의 수.
   *
   * 없애기 전에 묻는 데 쓴다. 붙은 데가 없으면 지금까지처럼 한 번 물어보고 감추고,
   * 있으면 "어떻게 할까요"를 내준다 -- 다른 태그로 옮길지, 거래내역을 열어 손으로
   * 손볼지, 전부 떼고 없앨지.
   *
   * 거래는 **줄 단위**로 센다. 한 거래를 둘로 나눠 두 줄에 같은 태그를 붙였으면 2 다.
   * 사람이 보는 수와 어긋나지만, 뗄 연결의 수가 그만큼이고 옮기기도 그 단위다.
   */
  export interface UsageResponse {
    /** 거래 줄 */
    entries: number;
    /** 보관함 후보 */
    drafts: number;
    /** 반복 등록 */
    rules: number;
  }

  /**
   * 태그를 없애면서 붙어 있던 자리를 다른 태그로 옮긴다.
   *
   * 분류의 통합(`CategoryDto.MergeRequest`)과 달리 줄이 하나다. 태그는 계층이 없어
   * "함께 사라지는 것"이 없고, 없앨 것도 옮길 곳도 늘 하나씩이다.
   */
  export interface MergeRequest {
    projectId?: string;
    /** 없앨 태그. 붙어 있던 자리가 `toId` 로 옮겨진 뒤 감춰진다. */
    fromId: string;
    /** 옮겨 받을 태그. 없앨 태그 자신일 수 없고, 감춘 태그일 수 없다. */
    toId: string;
  }

  /** 옮기기의 결과. 어디로 몇 줄이 갔는지 알려 준다. */
  export interface MergeResponse {
    /** 옮긴 거래 줄. 옮길 곳에 이미 그 태그가 있던 줄은 세지 않는다. */
    movedEntries: number;
    movedDrafts: number;
    movedRules: number;
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
  export interface PeriodQuery extends EntryFilterQuery, EntrySearchQuery {
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

  /**
   * 계좌 유형별 소계. 금액이 0인 유형은 키가 없다.
   *
   * cash/investment/liability 세 칸보다 잘게 나눠 봐야 하는 화면(홈의 유형별 카드)이
   * 있어 함께 준다. 자본 계정(opening_balance)은 순자산에서 빠지므로 여기에도 없고,
   * 부채 유형(loan, credit_card)은 음수다. 그래서 모든 값을 더하면 total 과 같다.
   */
  export type NetWorthByType = Partial<Record<AccountType, string>>;

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
    byType: NetWorthByType;
    byPerson: Array<{
      personId: string;
      personName: string;
      total: string;
      cash: string;
      investment: string;
      liability: string;
      byType: NetWorthByType;
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
   * 거래가 있는 달만 훑는다. 거래 화면의 첫 목록이 쓴다.
   *
   * TrendQuery 와 달리 기간을 받지 않는다. 전체 기간이고, 거래가 없는 달은 아예
   * 빠진다. 그래서 응답 길이가 곧 "이 가계부가 몇 달치인가"다.
   */
  export interface EntryMonthsQuery extends EntryFilterQuery, EntrySearchQuery {
    projectId?: string;
    /**
     * 이 기간에 걸친 달만, 그 기간에 든 거래만 센다.
     *
     * 날짜는 **프로젝트 타임존의 달력 날짜**이고 양끝을 포함한다(PeriodQuery 와 같은
     * 규칙이다. 목록 API 의 startDate/endDate 는 인스턴트라 뜻이 다르다).
     * 둘을 함께 주어야 하고, 하나만 주면 무시한다 -- 반쪽 구간은 사용자가 고른 것이
     * 아니라 입력이 덜 끝난 상태다.
     *
     * 달을 통째로 덮지 않는 기간이면 그 달의 합계도 기간만큼만 센다. 그러지 않으면
     * 년월 줄의 금액과 그 안을 펴서 나온 거래의 합이 어긋난다.
     */
    startDate?: string;
    endDate?: string;
  }

  /** 최신 달이 먼저 온다. */
  export interface EntryMonth {
    /** "YYYY-MM" */
    yearMonth: string;
    income: string;
    expense: string;
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
    /**
     * 여러 구성원의 계좌 합계. 쉼표로 잇는다. accountId/ownerId 와 함께 쓰지 않는다.
     *
     * 키가 없으면 전체, 빈 문자열이면 아무도 고르지 않은 것이라 결과가 비어야 한다.
     * 목록 필터(personIds)와 같은 세 상태 규칙이다.
     */
    ownerIds?: string;
    /** 기본 month */
    granularity?: 'year' | 'month' | 'day';
    /**
     * 창의 마지막 달 "YYYY-MM". 생략하면 이번 달.
     * granularity=year면 이 값의 연도가 마지막 해가 된다.
     */
    endMonth?: string;
    /**
     * granularity=day에서 그 달 1일~말일을 그린다 ("YYYY-MM"). 생략하면 days일 창이다.
     *
     * 창이 달에 딱 맞아야 하는 자리를 위한 것이다. 자산 추이 그래프는 달을 눌러도
     * 일별 창(days + endDate)을 그 달에 갖다 대는 쪽을 쓴다 -- 그래야 거기서 앞뒤
     * 날짜로 이어 끌 수 있다.
     */
    yearMonth?: string;
    /**
     * granularity=day이고 yearMonth가 없을 때 창의 마지막 날 "YYYY-MM-DD". 생략하면 오늘.
     *
     * 그래프를 가로로 끌어 지난 날짜를 볼 때 쓴다. endMonth 가 월·연 단위에서 하는
     * 일을 일 단위에서 한다 -- 창의 크기(days)는 그대로 두고 끝나는 자리만 옮긴다.
     */
    endDate?: string;
    /** granularity=month일 때만 쓴다. 기본 12, 최대 60 */
    months?: number;
    /** granularity=year일 때만 쓴다. 기본 5, 최대 30 */
    years?: number;
    /** granularity=day이고 yearMonth가 없을 때. 오늘을 포함해 뒤로 며칠. 기본 30, 최대 366 */
    days?: number;
  }

  export interface BalanceHistoryPoint {
    /** granularity=year면 "YYYY", month면 "YYYY-MM", day면 "YYYY-MM-DD" */
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
    /** 이 수단으로 나간 지출 */
    amount: string;
    count: number;
    /**
     * 이 통장으로 들어온 수입.
     *
     * 계좌는 돈이 나가는 곳이기도 하고 들어오는 곳이기도 하다. 카드는 언제나 "0"이다
     * (카드로는 수입이 들어오지 않는다. 환불 입금은 카드대금 결제로 기록된다).
     */
    income: string;
    /**
     * 실적 기준액. 카드에만 있고, 카드에 설정하지 않았으면 없다.
     *
     * 위 amount와 나란히 읽히도록 표시 통화로 환산해 보낸다. 카드에 저장된 값은
     * 결제 통장의 통화라 그대로 보내면 달러 카드의 기준액이 원화 사용액과
     * 비교된다.
     */
    performanceTarget?: string;
    /** 카드 앞면 색 (CardColor). 고르지 않은 카드와 통장에는 없다. */
    color?: string;
    /**
     * 신용카드 마감일 (1~31). 체크카드에는 없다.
     *
     * 31이면 청구 주기가 달력 월과 같다. 그 밖의 값이면 이 화면의 월 사용액이
     * 실적을 세는 구간과 어긋나므로, 화면은 달성률 대신 안내를 띄운다.
     */
    statementClosingDay?: number;
  }

  /**
   * 날짜별 합계 조회.
   *
   * type을 주지 않으면 지출이다. 홈의 지출/수입 탭이 같은 그래프를 두 벌 그리므로
   * 수입도 같은 규칙으로 받아야 한다.
   */
  export interface DailyExpenseQuery extends PeriodQuery {
    type?: 'income' | 'expense';
  }

  /**
   * 하루치 지출(또는 수입). 그날 아무것도 없으면 행이 없다.
   *
   * 월 합계(Summary)와 같은 규칙으로 센다("그 유형 카테고리 posting의 합"). 누적
   * 그래프는 이 값을 날짜순으로 더해서 그린다. 서버가 누적까지 만들지 않는 이유는
   * 화면마다 누적을 끊는 지점(오늘까지 / 말일까지)이 다르기 때문이다.
   */
  export interface DailyExpensePoint {
    /** 프로젝트 타임존 기준 "YYYY-MM-DD" */
    date: string;
    /** 그날의 합계 */
    amount: string;
  }

  /** 투자·저축 계좌 하나의 누적 수익 */
  export interface AccountProfit {
    accountId: string;
    /**
     * 그 계좌에 수입·지출로 기록한 금액의 합. 손실이면 음수다.
     *
     * 계좌 통화다. 화면이 잔액을 계좌 통화로 보여 주므로 같은 단위여야 나란히 읽힌다.
     */
    profit: string;
  }
}

// ===== Budget =====

export namespace BudgetDto {
  export interface CreateRequest {
    /**
     * 기기가 만든 식별자 (UUID). 생략하면 서버가 만든다.
     *
     * 오프라인에서 적은 것을 곧바로 고치고 지우려면 이름이 먼저 있어야 하고,
     * 같은 명령을 다시 보내도 행이 하나로 남으려면 그 이름이 기기에서 정해져
     * 있어야 한다. 형식 검사는 `isClientId` 가 한다.
     */
    id?: string;
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
    /** 이 달에 실제로 적용되는 금액. 조정이 있으면 조정값이다. 문자열. */
    monthlyAmount: string;
    /**
     * 조정을 걷어냈을 때 돌아갈 규칙 금액.
     *
     * 조정이 없으면 monthlyAmount와 같다. 예산 팝업의 "여러 달 한꺼번에 바꾸기"는
     * 이 값을 채워야 한다. 조정값을 채우면 이 달 화면에서 본 금액을 저장했을 뿐인데
     * 다른 달까지 그 금액이 되어 버린다.
     */
    ruleAmount?: string;
    usedAmount?: string;  // 이달 사용금액 (대분류는 소분류 합을 포함한다)
    isOverridden: boolean;  // 직접 오버라이드했는지
    /** 이 달만 조정한 값의 id. 해제하려면 이 값이 필요하다. 조정이 없으면 없다. */
    overrideId?: string;
    /** 이 규칙이 적용되는 첫 달 "YYYY-MM". 없으면 처음부터다. */
    effectiveFrom?: string;
    /** 이 규칙이 적용되는 마지막 달 "YYYY-MM". 없으면 끝이 없다. */
    effectiveTo?: string;
    hasChildren: boolean;  // 자식 예산이 있는지
    isVirtualBudget?: boolean;  // 소분류 합으로 만든 가상 예산인지
  }

  /** 월별 예산 목록 조회. 한 분류(또는 전체 예산)가 달마다 얼마인지 본다. */
  export interface ScheduleQuery {
    projectId?: string;
    /**
     * 분류 예산이면 그 분류 id. 전체 예산은 'BUDGET_TOTAL_INCOME' /
     * 'BUDGET_TOTAL_EXPENSE' 센티널을 쓴다 (CreateRequest와 같은 규칙).
     */
    categoryId?: string;
    type?: 'income' | 'expense';
    /** 첫 달 "YYYY-MM". 생략하면 이번 달 */
    startMonth?: string;
    /** 기본 12, 최대 60 */
    months?: number;
  }

  /** 한 달의 예산. 그 달에 적용되는 규칙이 없으면 amount도 budgetId도 없다. */
  export interface ScheduleMonth {
    yearMonth: string;
    /** 실제로 적용되는 금액 (조정이 있으면 조정값) */
    amount?: string;
    /** 조정을 걷어냈을 때 돌아갈 규칙 금액 */
    ruleAmount?: string;
    /** 이 달에 적용되는 규칙 */
    budgetId?: string;
    /** 이 달만 씌운 조정값. 조정이 없으면 없다. */
    overrideId?: string;
    isOverridden: boolean;
    /** 이 달에 적용되는 규칙의 기간. 어디서 규칙이 갈리는지 화면에 표시한다. */
    effectiveFrom?: string;
    effectiveTo?: string;
  }

  export interface OverrideRequest {
    /** 기기가 만든 식별자 (UUID). 생략하면 서버가 만든다. */
    id?: string;
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

// ===== 동기화 =====

/**
 * 기기가 "내가 마지막으로 본 번호 뒤"를 받아 가는 변경 피드.
 *
 * 행 모양은 서버 표를 그대로 둔다. 화면용 DTO(EntryListItem 등)로 바꾸지 않는 것은,
 * 기기가 그 행으로 자기 원장을 다시 세워 스스로 집계해야 하기 때문이다. 화면용
 * 모양은 이미 계산이 끝난 값이라 그 일에 쓸 수 없다.
 */
export namespace SyncDto {
  export interface PullQuery {
    projectId?: string;
    /** 마지막으로 받은 번호. 처음이면 0 (또는 생략) */
    since?: number;
    /** 한 번에 받을 표당 최대 행 수 */
    limit?: number;
  }

  /** 지워진 행. entity 는 서버 표 이름 그대로다 ("JournalEntry"). */
  export interface Tombstone {
    entity: string;
    entityId: string;
    deletedVersion: number;
  }

  /**
   * 전표는 다리와 함께 하나의 단위로 움직인다.
   *
   * 다리만 따로 병합하면 합계 0이라는 불변식이 깨진다. 그래서 다리에는 번호를
   * 붙이지 않고, 전표가 바뀔 때마다 다리 전체를 함께 실어 보낸다.
   */
  export interface EntryRow {
    id: string;
    postings: unknown[];
    /**
     * 이 전표에 달린 태그 연결. 다리와 같은 이유로 전표에 실어 함께 보낸다.
     *
     * **어느 줄의 태그인지가 함께 온다.** `lineKey` 가 있으면 그 분류 줄의 것이고,
     * null 이면 거래 자체의 것이다 (분류 줄이 없는 이체·카드 대금 결제).
     *
     * 태그 자체(이름·색)는 `changes.tags` 로 따로 오고 여기에는 연결만 담는다.
     * 이름이 바뀌었다고 그 태그가 붙은 전표를 전부 다시 보낼 수는 없기 때문이다.
     */
    tagLinks: Array<{ lineKey: string | null; tagId: string }>;
  }

  export interface Changes {
    /** 프로젝트 자신이 바뀌었을 때만 채워진다 (이름, 통화, 타임존) */
    project: unknown | null;
    members: unknown[];
    people: unknown[];
    accounts: unknown[];
    categories: unknown[];
    tags: unknown[];
    cards: unknown[];
    entries: EntryRow[];
    budgets: unknown[];
    budgetOverrides: unknown[];
    exchangeRates: unknown[];
    /**
     * 투자성 계좌의 평가 기록. 없으면 그 계좌를 장부 잔액으로 세게 되어 총자산이 틀린다.
     *
     * 계좌마다 최신 한 건만 쓰이지만 표를 통째로 미러링한다. "최신"은 날짜로 정해지고,
     * 뒤늦게 도착한 과거 기록이 최신을 밀어내지 않아야 해서 골라내는 일은 읽을 때 한다.
     */
    assetValuations: unknown[];
    /**
     * 할부 개월수. 회차 금액은 담지 않는다(총액과 개월수에서 다시 계산되는 파생값이다).
     *
     * 전표보다 뒤에 적용해야 한다. 전표를 갈아 끼울 때 옛 다리에 걸린 계획이 함께
     * 지워지므로, 순서를 뒤집으면 방금 받은 계획이 사라진다.
     */
    installmentPlans: unknown[];
    /**
     * 보관함의 후보. 거래가 아니라 제안이지만 기기 사본에 함께 둔다.
     *
     * 한 기기가 알림으로 담은 것을 웹에서 정리하고, 그 결과를 다시 기기가 보아야
     * 한다. 따로 조회하게 두면 화면마다 "언제 다시 물을지"를 정하게 되어 같은
     * 보관함이 자리마다 다르게 보인다.
     */
    entryDrafts: unknown[];
  }

  export interface PullResponse {
    projectId: string;
    /** 요청에 실려 온 번호 */
    since: number;
    /**
     * 이 응답이 포함한 마지막 번호. 다음 요청의 since 로 그대로 쓴다.
     *
     * hasMore 가 true 면 서버가 안전한 자리에서 끊은 번호다. 그 번호까지는
     * 빠진 것이 없다.
     */
    version: number;
    hasMore: boolean;
    changes: Changes;
    tombstones: Tombstone[];
    /**
     * 자리표를 어디까지 지웠는가. 이 번호 아래의 삭제는 서버에 더 남아 있지 않다.
     *
     * 커서가 이 번호보다 오래된 기기는 놓친 삭제를 델타로 따라잡을 수 없다. 지운
     * 거래가 그 기기에 영영 남는다. 그래서 그런 기기는 사본을 버리고 처음부터 받는다
     * (`sync-engine` 이 그 판단을 한다 -- 서버는 값만 알려 준다).
     *
     * 아직 한 번도 지우지 않았으면 0 이고, 그때는 어떤 커서든 따라잡을 수 있다.
     */
    tombstoneFloor: number;
  }
}
