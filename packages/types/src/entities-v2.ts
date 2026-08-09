// 새로운 스키마 (v2) - Prisma 스키마와 동기화

export interface User {
  id: string;
  email: string;
  password: string;
  name: string;
  avatar: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// 가족 구성원
export interface Person {
  id: string;
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
  userId: string;
  ownerId: string;
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
  userId: string;
  accountId: string;
  name: string;
  cardNumber: string | null;
  cardType: 'debit' | 'credit';
  issuer: string;
  expiryDate: Date | null;
  creditLimit: number | null;
  currentBalance: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// 거래 (입금/출금/이체)
export interface Transaction {
  id: string;
  userId: string;
  accountId: string;
  personId: string;
  cardId: string | null;
  type: 'income' | 'expense' | 'transfer';
  amount: number;
  description: string;
  date: Date;
  mainCategory: string;
  subCategory: string | null;
  tags: string[];
  isRecurring: boolean;
  recurringPattern: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// 카테고리 (대분류/소분류)
export interface Category {
  id: string;
  userId: string;
  name: string;
  parentId: string | null;
  level: number;
  type: string;
  icon: string | null;
  color: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// 신용카드 결제
export interface CardPayment {
  id: string;
  userId: string;
  cardId: string;
  accountId: string;
  totalAmount: number;
  paidAmount: number;
  status: string;
  paymentDate: Date;
  transactionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// 카드 사용 기록
export interface CardUsage {
  id: string;
  userId: string;
  cardId: string;
  amount: number;
  merchant: string;
  date: Date;
  status: string;
  isPaymentDue: boolean;
  createdAt: Date;
  updatedAt: Date;
}
