import type { Person, Account, Card, Transaction, Category, CardPayment, CardUsage } from './entities-v2';

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

export namespace AccountDto {
  export interface CreateRequest {
    ownerId: string; // Person ID
    name: string;
    balance: number;
    bankName: string;
    accountNumber?: string; // 미입력 시 자동 생성
    currency?: string;
    projectId?: string;
  }

  export interface UpdateRequest {
    name?: string;
    balance?: number;
    isActive?: boolean;
  }

  export interface Response extends Account {}

  export interface WithBalance extends Account {
    currentBalance: number;
    totalIncome: number;
    totalExpense: number;
  }
}

export namespace CardDto {
  export interface CreateRequest {
    accountId: string;
    name: string;
    cardNumber?: string; // 실제 번호 (서버에서 마스킹)
    cardType: 'debit' | 'credit';
    issuer: string;
    expiryDate?: Date;
    creditLimit?: number; // 신용카드만
    projectId?: string;
  }

  export interface UpdateRequest {
    name?: string;
    creditLimit?: number;
    isActive?: boolean;
  }

  export interface UseCardRequest {
    personId: string;
    amount: number;
    merchant: string;
    description: string;
    date: string | Date;
    mainCategoryId: string;
    subCategoryId?: string;
  }

  export interface Response extends Omit<Card, 'cardNumber'> {
    cardNumberMasked: string; // 마스킹된 번호
  }
}

export namespace TransactionDto {
  export interface CreateRequest {
    accountId: string;
    personId: string;
    cardId?: string;
    type: 'income' | 'expense' | 'transfer';
    amount: number;
    description: string;
    date: Date;
    mainCategoryId: string; // 대분류 ID
    subCategoryId?: string; // 소분류 ID
    tags?: string[];
    isRecurring?: boolean;
    recurringPattern?: 'daily' | 'weekly' | 'monthly' | 'yearly';
    isFixed?: boolean; // 고정 지출/수입 여부
    projectId?: string;
  }

  export interface UpdateRequest {
    description?: string;
    amount?: number;
    date?: Date;
    type?: 'income' | 'expense' | 'transfer';
    personId?: string;
    cardId?: string;
    mainCategoryId?: string;
    subCategoryId?: string;
    tags?: string[];
    isFixed?: boolean; // 고정 지출/수입 여부
  }

  export interface ListQuery {
    accountId?: string;
    personId?: string;
    cardId?: string;
    type?: 'income' | 'expense' | 'transfer';
    mainCategoryId?: string;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    limit?: number;
  }

  export interface Response extends Transaction {}

  export interface Statistics {
    totalIncome: number;
    totalExpense: number;
    net: number;
    byCategory: Record<string, number>;
    byPerson: Record<string, number>;
  }
}

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

export namespace CardPaymentDto {
  export interface CreateRequest {
    cardId: string;
    accountId: string;
  }

  export interface CompleteRequest {
    cardPaymentId: string;
    paymentAmount: number;
  }

  export interface Response extends CardPayment {}
}

export namespace CardUsageDto {
  export interface Response extends CardUsage {}
}

export namespace BudgetDto {
  export interface CreateRequest {
    categoryId?: string;    // null=전체, 값=대분류/소분류
    monthlyAmount: number;
    projectId?: string;
  }

  export interface UpdateRequest {
    monthlyAmount?: number;
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
    userId: string;
    categoryId?: string;
    monthlyAmount: number;
    effectiveFrom?: string;
    effectiveTo?: string;
    createdAt: Date;
    updatedAt: Date;
  }

  export interface MonthlyBudget {
    budgetId: string;
    categoryId?: string;
    categoryName?: string;
    monthlyAmount: number;
    isOverridden: boolean;  // 직접 오버라이드했는지
  }

  export interface OverrideRequest {
    budgetId: string;
    year: number;
    month: number;
    amount: number;
  }

  export interface OverrideResponse {
    id: string;
    budgetId: string;
    year: number;
    month: number;
    amount: number;
    createdAt: Date;
  }
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
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
