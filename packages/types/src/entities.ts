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

export type ProjectRole = 'owner' | 'editor' | 'viewer';

export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'expired';

export type CategoryType = 'income' | 'expense';

export type StatementStatus =
  | 'open'    // 마감 전
  | 'closed'  // 마감됨, 미결제
  | 'partial' // 일부 결제
  | 'paid';   // 완납

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

// 계좌. 은행 통장뿐 아니라 현금/투자/부동산/카드부채까지 포함한다.
export interface Account {
  id: string;
  projectId: string;
  type: AccountType;
  /** Person ID (통장 주인). opening_balance 같은 시스템 계정은 null */
  ownerId: string | null;
  name: string;
  bankName: string | null;
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
  issuer: string;
  expiryDate: IsoDateString | null;
  /** 금액은 정밀도 손실을 막기 위해 문자열로 오간다 (Prisma Decimal 기본 직렬화) */
  creditLimit: string | null;
  statementClosingDay: number | null; // 마감일 1~31. credit만
  paymentDueDay: number | null;       // 결제일 1~31. credit만
  isActive: boolean;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

// 신용카드 청구서 (한 결제 주기)
export interface CardStatement {
  id: string;
  cardId: string;
  periodStart: IsoDateString;
  periodEnd: IsoDateString; // 마감일
  dueDate: IsoDateString;   // 결제일
  status: StatementStatus;
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
  statementId: string | null;
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
  /**
   * 이체에 붙은 수수료. 이체가 아니면 null, 수수료가 없는 이체면 "0".
   * 이체 자체는 소비가 아니지만 수수료는 지출이라 따로 보여준다.
   */
  feeAmount: string | null;
  feeCategoryId: string | null;
  feeCategoryName: string | null;
  /**
   * 이미 결제한 청구서에 포함된 카드 사용 내역인지.
   *
   * true면 금액·날짜·결제수단을 바꾸거나 삭제할 수 없다.
   * 바꾸면 청구액만 달라지고 결제 기록은 남아 카드 부채가 어긋난다.
   * 설명·카테고리·거래처처럼 청구서와 무관한 값은 고칠 수 있다.
   */
  lockedByStatement: boolean;
  /**
   * 이 거래가 속한 카드 청구 기간. 카드 거래가 아니면 null.
   *
   * lockedByStatement가 true여도 이 기간 안에서는 날짜를 고칠 수 있다.
   * 같은 청구서에 머무르면 청구액이 달라지지 않기 때문이다 (날짜 오타 정정용).
   */
  statementPeriodStart: IsoDateString | null;
  statementPeriodEnd: IsoDateString | null;
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
