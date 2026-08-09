import type { User, Account, Category, Transaction, Budget } from './entities';

export namespace Auth {
  export interface SignUpRequest {
    email: string;
    password: string;
    name: string;
  }

  export interface SignInRequest {
    email: string;
    password: string;
  }

  export interface AuthResponse {
    accessToken: string;
    refreshToken: string;
    user: User;
  }

  export interface RefreshRequest {
    refreshToken: string;
  }

  export interface LogoutRequest {
    refreshToken?: string;
  }
}

export namespace AccountDto {
  export interface CreateRequest {
    name: string;
    type: Account['type'];
    balance: number;
    currency?: string;
    color?: string;
  }

  export interface UpdateRequest {
    name?: string;
    balance?: number;
    color?: string;
    isActive?: boolean;
  }
}

export namespace CategoryDto {
  export interface CreateRequest {
    name: string;
    type: 'income' | 'expense';
    icon?: string;
    color?: string;
  }

  export interface UpdateRequest {
    name?: string;
    icon?: string;
    color?: string;
    isActive?: boolean;
  }
}

export namespace TransactionDto {
  export interface CreateRequest {
    accountId: string;
    categoryId: string;
    amount: number;
    type: 'income' | 'expense';
    description?: string;
    date: Date;
    tags?: string[];
  }

  export interface UpdateRequest {
    categoryId?: string;
    amount?: number;
    description?: string;
    date?: Date;
    tags?: string[];
  }

  export interface ListQuery {
    accountId?: string;
    categoryId?: string;
    startDate?: Date;
    endDate?: Date;
    type?: 'income' | 'expense';
    page?: number;
    limit?: number;
  }
}

export namespace BudgetDto {
  export interface CreateRequest {
    categoryId: string;
    amount: number;
    period: 'monthly' | 'yearly';
    startDate: Date;
    alertThreshold: number;
  }

  export interface UpdateRequest {
    amount?: number;
    alertThreshold?: number;
    endDate?: Date;
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

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp: string;
}
