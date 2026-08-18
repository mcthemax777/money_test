// 도메인 엔티티 - packages/api/prisma/schema.prisma 와 동기화

// ===== Enum =====

export type TransactionType =
  | 'income'
  | 'expense'
  | 'transfer'
  | 'credit_usage'    // 신용카드 사용
  | 'credit_payment'; // 신용카드 결제

export type CardType = 'debit' | 'credit';

export type PaymentStatus = 'pending' | 'completed';

export type ProjectRole = 'owner' | 'editor' | 'viewer';

export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'expired';

export type CategoryType = 'income' | 'expense';

export type RecurringPattern = 'daily' | 'weekly' | 'monthly' | 'yearly';

// ===== 엔티티 =====

// 앱 사용자 (계정) - 구글 로그인으로만 생성된다
export interface User {
  id: string;
  email: string;
  googleId: string; // Google ID 토큰의 sub 클레임
  name: string;
  avatar: string | null;
  defaultProjectId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// 프로젝트 (가계부 단위)
export interface Project {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// 프로젝트 멤버
export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  joinedAt: Date;
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
  expiresAt: Date | null;
  acceptedAt: Date | null;
  acceptedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// 사람 (가족 구성원)
export interface Person {
  id: string;
  projectId: string;
  userId: string;
  name: string;
  relationship: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// 은행 통장
export interface Account {
  id: string;
  projectId: string;
  userId: string;
  ownerId: string; // Person ID (통장 주인)
  name: string;
  accountNumber: string | null;
  balance: number;
  bankName: string;
  currency: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// 카드 (체크/신용)
export interface Card {
  id: string;
  projectId: string;
  userId: string;
  accountId: string;
  name: string;
  cardNumber: string | null;
  cardType: CardType;
  issuer: string;
  expiryDate: Date | null;
  creditLimit: number | null;
  currentBalance: number | null;
  billingDayOfMonth: number; // 결제일 (1~31)
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// 거래 (입금/출금/이체)
export interface Transaction {
  id: string;
  projectId: string;
  userId: string;
  accountId: string | null; // 신용카드 사용 시 null
  personId: string;
  cardId: string | null;
  cardPaymentId: string | null;
  type: TransactionType;
  amount: number;
  description: string;
  merchant: string | null;      // 거래처 (가맹점, 송금 계좌주 등)
  detailedNote: string | null;  // 상세설명
  toAccountId: string | null;   // 이체 대상 계좌 (type=transfer)
  relatedTransactionId: string | null; // 이체 수수료 거래 연결
  date: Date;
  mainCategoryId: string | null;
  subCategoryId: string | null;
  tags: string[];
  isRecurring: boolean;
  recurringPattern: string | null;
  isFixed: boolean; // 고정 지출/수입 여부
  createdAt: Date;
  updatedAt: Date;
}

// 카테고리 (대분류/소분류)
export interface Category {
  id: string;
  projectId: string;
  userId: string;
  name: string;
  parentId: string | null; // 대분류는 null, 소분류는 대분류 ID
  level: number;           // 1: 대분류, 2: 소분류
  type: string;            // income, expense
  icon: string | null;
  defaultIsFixed: boolean; // 소분류의 기본 고정 여부
  isDefault: boolean;      // 기본 카테고리 (삭제 불가)
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// 카드 사용 기록
export interface CardUsage {
  id: string;
  projectId: string;
  userId: string;
  cardId: string;
  amount: number;
  merchant: string;
  date: Date;
  status: string; // pending, completed, cancelled
  isPaymentDue: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// 신용카드 결제 (사용액을 통장에서 결제)
export interface CardPayment {
  id: string;
  projectId: string;
  userId: string;
  cardId: string;
  accountId: string;
  totalAmount: number;
  paidAmount: number;
  status: string; // pending, completed
  paymentDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

// 신용카드 결제와 사용 기록 연결 (N:N)
export interface CardPaymentUsage {
  id: string;
  cardPaymentId: string;
  cardUsageId: string;
  amount: number; // 분할 결제 시 일부만 포함 가능
  createdAt: Date;
}

// 예산 (기본 규칙)
export interface Budget {
  id: string;
  projectId: string;
  userId: string;
  categoryId: string | null; // null=전체, 값=대분류/소분류
  type: string | null;       // categoryId가 null일 때 income/expense 구분
  monthlyAmount: number;
  effectiveFrom: string | null; // "YYYY-MM"
  effectiveTo: string | null;   // "YYYY-MM"
  createdAt: Date;
  updatedAt: Date;
}

// 예산 월별 직접 오버라이드
export interface BudgetOverride {
  id: string;
  budgetId: string;
  year: number;
  month: number;
  amount: number;
  createdAt: Date;
  updatedAt: Date;
}
