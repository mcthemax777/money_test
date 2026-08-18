import type {
  User,
  Person,
  Account,
  Card,
  Transaction,
  Category,
  CardPayment,
  CardUsage,
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
}

// ===== Card =====

export namespace CardDto {
  export interface CreateRequest {
    accountId: string;
    name: string;
    cardNumber?: string; // 실제 번호 (서버에서 마스킹)
    cardType: 'debit' | 'credit';
    issuer: string;
    expiryDate?: Date;
    creditLimit?: number; // 신용카드만
    billingDayOfMonth?: number; // 결제일 (1~31, 기본값: 1)
    projectId?: string;
  }

  export interface UpdateRequest {
    name?: string;
    creditLimit?: number;
    billingDayOfMonth?: number;
    isActive?: boolean;
  }

  export interface Response extends Omit<Card, 'cardNumber'> {
    cardNumberMasked: string; // 마스킹된 번호
  }
}

// ===== Transaction =====

export namespace TransactionDto {
  export interface CreateRequest {
    accountId: string;
    personId: string;
    cardId?: string;
    type: 'income' | 'expense' | 'transfer';
    amount: number;
    description: string;
    merchant?: string; // 거래처 (선택사항)
    detailedNote?: string; // 상세설명 (선택사항)
    toAccountId?: string; // 이체 대상 계좌 (type=transfer일 때)
    transferFee?: number; // 이체 수수료 금액 (type=transfer일 때, 선택사항)
    transferFeeMainCategoryId?: string; // 수수료 대분류 (transferFee가 있으면 필수)
    transferFeeSubCategoryId?: string; // 수수료 소분류 (선택사항)
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
    merchant?: string; // 거래처
    detailedNote?: string; // 상세설명
    amount?: number;
    date?: Date;
    type?: 'income' | 'expense' | 'transfer';
    personId?: string;
    cardId?: string;
    toAccountId?: string; // 이체 대상 계좌
    transferFee?: number; // 이체 수수료 금액
    transferFeeMainCategoryId?: string; // 수수료 대분류
    transferFeeSubCategoryId?: string; // 수수료 소분류
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
    subCategoryId?: string;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    limit?: number;
  }

  export interface Response extends Transaction {}
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

// ===== CardPayment / CardUsage =====

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

// ===== Budget =====

export namespace BudgetDto {
  export interface CreateRequest {
    categoryId?: string;    // null=전체, 값=대분류/소분류
    type?: 'income' | 'expense';  // 카테고리 타입 (전체 지출/수입 구분용)
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
    categoryType?: 'income' | 'expense';  // 카테고리 타입
    parentCategoryId?: string;  // 대분류 ID (소분류인 경우)
    monthlyAmount: number;
    usedAmount?: number;  // 이달 사용금액
    isOverridden: boolean;  // 직접 오버라이드했는지
    hasChildren: boolean;  // 자식 예산이 있는지
    isVirtualBudget?: boolean;  // 소분류 합으로 만든 가상 예산인지
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

// ===== 공통 응답 =====

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

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp: string;
}
