// 도메인 엔티티 - packages/api/prisma/schema.prisma 와 동기화

/**
 * JSON으로 오갈 때 날짜는 ISO 8601 문자열이다. Date 객체가 아니다.
 *
 * 금액을 문자열로 정한 것과 같은 이유로 타입에 사실을 적는다.
 * `Date`라고 써 두면 화면에서 `.getTime()` 같은 호출이 컴파일은 되고 런타임에 깨진다.
 */
export type IsoDateString = string;

// ===== Enum =====

export type AccountType =
  | 'deposit'
  | 'savings'
  | 'investment'
  | 'cash'
  | 'credit_card'    // 카드 사용액을 담는 부채 계정. 통장 목록에 노출하지 않는다
  | 'loan'
  | 'real_estate'
  | 'opening_balance'; // 기초잔액 자본 계정. 순자산 합계에서 제외한다

export type CardType = 'debit' | 'credit';

/** bank는 은행뿐 아니라 증권사/저축은행/상호금융까지 포함한 "계좌 개설 기관"이다. */
export type FinancialInstitutionType = 'bank' | 'card_issuer';

export type ProjectRole = 'owner' | 'editor' | 'viewer';

export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'expired';

export type CategoryType = 'income' | 'expense';

// ===== 엔티티 =====

// 앱 사용자 (계정) - 구글 로그인으로만 생성된다
export interface User {
  id: string;
  email: string;
  googleId: string; // Google ID 토큰의 sub 클레임
  name: string;
  avatar: string | null;
  defaultProjectId: string | null;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

// 프로젝트 (가계부 단위)
export interface Project {
  id: string;
  name: string;
  description: string | null;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

// 프로젝트 멤버
export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  joinedAt: IsoDateString;
}

// 프로젝트 초대
export interface ProjectInvitation {
  id: string;
  projectId: string;
  email: string;
  invitationCode: string;
  role: ProjectRole;
  status: InvitationStatus;
  invitedByUserId: string;
  expiresAt: IsoDateString | null;
  acceptedAt: IsoDateString | null;
  acceptedByUserId: string | null;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

// 사람 (가족 구성원)
export interface Person {
  id: string;
  projectId: string;
  name: string;
  relationship: string | null;
  isActive: boolean;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

// 은행/카드사. 기본 제공 항목과 사용자 추가 항목이 같은 타입이다.
export interface FinancialInstitution {
  id: string;
  /** null이면 모든 프로젝트가 공유하는 기본 제공 항목 */
  projectId: string | null;
  type: FinancialInstitutionType;
  name: string;
  sortOrder: number;
  iconPath: string | null;
  isActive: boolean;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

// 계좌. 은행 통장뿐 아니라 현금/투자/부동산/카드부채까지 포함한다.
export interface Account {
  id: string;
  projectId: string;
  type: AccountType;
  /** Person ID (통장 주인). opening_balance 같은 시스템 계정은 null */
  ownerId: string | null;
  name: string;
  /** 개설 기관 (FinancialInstitution). 현금/부동산 계정은 null */
  institutionId: string | null;
  accountNumber: string | null;
  /** 금액은 정밀도 손실을 막기 위해 문자열로 오간다 */
  balance: string;
  currency: string;
  isActive: boolean;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

// 카드 (체크/신용)
export interface Card {
  id: string;
  projectId: string;
  /** 사용자가 고른 실제 통장. 체크카드는 즉시 출금, 신용카드는 결제일 출금. */
  paymentAccountId: string;
  /**
   * 신용카드 사용액을 담는 부채 계정. 카드 등록 시 자동 생성된다.
   * 은행 통장이 아니라 "카드사에 갚아야 할 돈"을 기록하는 칸이라 통장 목록에는 노출하지 않는다.
   * 체크카드는 null.
   */
  liabilityAccountId: string | null;
  name: string;
  cardNumber: string | null;
  cardType: CardType;
  /** 카드사 (FinancialInstitution, type = card_issuer) */
  issuerId: string;
  expiryDate: IsoDateString | null;
  /** 금액은 정밀도 손실을 막기 위해 문자열로 오간다 (Prisma Decimal 기본 직렬화) */
  creditLimit: string | null;
  statementClosingDay: number | null; // 마감일 1~31. credit만
  paymentDueDay: number | null;       // 결제일 1~31. credit만
  isActive: boolean;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

// 전표 (하나의 경제적 사건). 소속 Posting.amount 합은 항상 0이다.
export interface JournalEntry {
  id: string;
  projectId: string;
  personId: string;
  date: IsoDateString;
  description: string;
  merchant: string | null;     // 거래처 (가맹점, 송금 계좌주 등)
  detailedNote: string | null; // 상세설명
  createdByUserId: string | null; // 입력자 추적용. 조회 필터로 쓰지 않는다
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

// 전표의 개별 다리. accountId와 categoryId 중 정확히 하나만 채워진다.
export interface Posting {
  id: string;
  entryId: string;
  accountId: string | null;
  categoryId: string | null;
  /** 금액은 문자열. 부호 규칙은 schema.prisma 상단 참고 */
  amount: string;
  quantity: string | null;
  currency: string;
  baseAmount: string;
  exchangeRate: string;
  isFixed: boolean;   // 지출 카테고리 posting에서만 의미가 있다
  cardId: string | null;
}

/**
 * 화면에 한 줄로 보여주기 위해 전표를 평평하게 편 것.
 * 서버가 postings를 해석해 만들어 준다 (클라이언트가 다리를 직접 다루지 않게).
 */
export type EntryKind =
  | 'expense'
  | 'income'
  | 'transfer'
  | 'card_payment' // 카드대금 결제 (부채 상환)
  | 'adjustment';  // 기초잔액/잔액 조정

/** 카드사와 통장 사이 자금 이동의 방향 */
export type CardTransferDirection = 'payment' | 'refund';

export interface EntryListItem {
  id: string;
  kind: EntryKind;
  date: IsoDateString;
  description: string;
  merchant: string | null;
  detailedNote: string | null;
  personId: string;
  personName: string;
  /** 표시용 금액. 항상 양수 */
  amount: string;
  isFixed: boolean;
  categoryId: string | null;
  categoryName: string | null;
  parentCategoryId: string | null;
  parentCategoryName: string | null;
  accountId: string | null;
  accountName: string | null;
  toAccountId: string | null;   // 이체 대상
  toAccountName: string | null;
  cardId: string | null;
  cardName: string | null;
  /** 할부 개월수. 일시불이거나 카드 거래가 아니면 null. */
  installmentMonths: number | null;
  /**
   * 이체에 붙은 수수료. 이체가 아니면 null, 수수료가 없는 이체면 "0".
   * 이체 자체는 소비가 아니지만 수수료는 지출이라 따로 보여준다.
   */
  feeAmount: string | null;
  feeCategoryId: string | null;
  feeCategoryName: string | null;
  /**
   * 카드사 이체의 방향. 그 외 거래는 null.
   *   payment 대금 결제  통장 -> 카드
   *   refund  환불 입금  카드 -> 통장
   *
   * 전표에는 부호로만 남으므로 화면이 되돌려 보낼 수 있도록 풀어서 실어 준다.
   */
  cardTransferDirection: CardTransferDirection | null;
}

// 카테고리 (대분류/소분류)
export interface Category {
  id: string;
  projectId: string;
  name: string;
  parentId: string | null; // 대분류는 null, 소분류는 대분류 ID (level은 여기서 유도한다)
  type: CategoryType;
  icon: string | null;
  defaultIsFixed: boolean; // 소분류의 기본 고정 여부
  isDefault: boolean;      // 기본 카테고리 (삭제 불가)
  isActive: boolean;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}




// 예산 (기본 규칙)
export interface Budget {
  id: string;
  projectId: string;
  categoryId: string | null;  // null=전체, 값=대분류/소분류
  type: CategoryType | null;  // categoryId가 null일 때만 사용
  monthlyAmount: string;
  effectiveFrom: string | null; // "YYYY-MM"
  effectiveTo: string | null;   // "YYYY-MM"
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

// 예산 월별 직접 오버라이드
export interface BudgetOverride {
  id: string;
  budgetId: string;
  year: number;
  month: number;
  amount: string;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}
