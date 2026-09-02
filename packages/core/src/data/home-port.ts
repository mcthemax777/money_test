/**
 * 홈 화면이 값을 얻는 창구.
 *
 * 지금까지 훅은 `apiClient` 를 직접 불렀다. 그러면 서버에 닿지 못하는 순간 화면이
 * 통째로 빈다. 창구를 하나 두면 그 자리에 기기 사본을 꽂을 수 있고, 훅과 화면은
 * 어느 쪽에서 온 값인지 모른 채로 같은 코드를 쓴다.
 *
 * 모양은 서버 응답(DTO)을 그대로 쓴다. 도메인 모양으로 새로 그리는 편이 깔끔해
 * 보이지만, 그러면 화면 전체를 함께 고쳐야 하고 오프라인과 온라인이 서로 다른
 * 모양을 보게 될 위험이 생긴다. 같은 모양을 두 곳에서 만들면 화면은 손대지 않아도 된다.
 *
 * 갈아 끼우는 방식은 토큰 저장소(`auth-tokens`)와 스토어 저장소(`persist-storage`)와 같다.
 */

import type {
  AccountDto,
  EntryDto,
  BudgetDto,
  CardDto,
  CategoryDto,
  EntryScopeQuery,
  PersonDto,
  ReportDto,
} from '@money/types';

import { apiClient, type ReportPeriod } from '../lib/api-client';

/** 기간 조회가 함께 받는 조건. 정의는 `@money/types` 에 있다. */
export type { EntryScopeQuery };

/**
 * 홈과 가계 화면이 쓰는 조회.
 *
 * 두 화면이 기준 목록(사람·계좌·카드·카테고리)과 합계를 함께 쓰므로 창구를 하나로 둔다.
 * 화면을 더 옮길 때 그 화면이 쓰는 조회를 여기 더한다.
 */
export interface HomeDataPort {
  getPeople(projectId?: string | null): Promise<PersonDto.Response[]>;
  getCards(projectId?: string | null): Promise<CardDto.Response[]>;
  getAccountsV2(projectId?: string | null): Promise<AccountDto.Response[]>;
  getCategories(projectId?: string | null): Promise<CategoryDto.Response[]>;

  getNetWorth(projectId?: string | null): Promise<ReportDto.NetWorth>;
  getBudgetForMonth(
    year: number,
    month: number,
    projectId?: string | null,
    filter?: EntryScopeQuery,
  ): Promise<BudgetDto.MonthlyBudget[]>;
  getSummary(
    period: ReportPeriod,
    projectId?: string | null,
    filter?: EntryScopeQuery,
  ): Promise<ReportDto.Summary>;
  getPaymentMethods(
    period: ReportPeriod,
    projectId?: string | null,
    filter?: EntryScopeQuery,
  ): Promise<ReportDto.PaymentMethodItem[]>;
  getCardPerformance(cardId: string): Promise<CardDto.PerformanceResponse>;

  /**
   * 분류별 구성비. 거래 화면의 분류별 목록이 쓴다.
   *
   * 가계 화면의 같은 탭은 `apiClient` 를 직접 불러서 오프라인에서 빈다. 거래 화면은
   * 오프라인에서도 돌아야 하므로 창구를 거친다.
   */
  getCategoryBreakdown(
    period: ReportPeriod,
    type: 'income' | 'expense',
    projectId?: string | null,
    options?: { rollup?: boolean } & EntryScopeQuery,
  ): Promise<ReportDto.CategoryBreakdownItem[]>;

  /** 거래가 있는 달. 전체 기간이라 기간을 받지 않는다. */
  getEntryMonths(projectId?: string | null, filter?: EntryScopeQuery): Promise<ReportDto.EntryMonth[]>;

  /**
   * 그 구간의 거래 전부. 커서를 끝까지 따라간 결과다.
   *
   * 한 페이지만 받으면 달력의 일별 합계가 조용히 과소 집계된다. 상단 요약은 전량으로
   * 계산되므로 같은 화면 안에서 숫자가 어긋난다.
   */
  getAllEntries(
    query: EntryDto.ListQuery,
    projectId?: string | null,
  ): Promise<EntryDto.ListResponse['data']>;

  /** 한 쪽씩 받는 목록. 무한 스크롤이 쓴다. */
  getEntries(
    query: EntryDto.ListQuery,
    projectId?: string | null,
  ): Promise<EntryDto.ListResponse>;
}

/** 서버에서 곧바로 받는 창구. 웹은 이것을 쓴다. */
export const httpHomePort: HomeDataPort = {
  getPeople: (projectId) => apiClient.getPeople(projectId),
  getCards: (projectId) => apiClient.getCards(projectId),
  getAccountsV2: (projectId) => apiClient.getAccountsV2(projectId),
  getCategories: (projectId) => apiClient.getCategories(projectId),
  getNetWorth: (projectId) => apiClient.getNetWorth(projectId),
  getBudgetForMonth: (year, month, projectId, filter) =>
    apiClient.getBudgetForMonth(year, month, projectId, filter),
  getSummary: (period, projectId, filter) => apiClient.getSummary(period, projectId, filter),
  getPaymentMethods: (period, projectId, filter) =>
    apiClient.getPaymentMethods(period, projectId, filter),
  getCardPerformance: (cardId) => apiClient.getCardPerformance(cardId),
  getCategoryBreakdown: (period, type, projectId, options) =>
    apiClient.getCategoryBreakdown(period, type, projectId, options),
  getEntryMonths: (projectId, filter) => apiClient.getEntryMonths(projectId, filter),
  getAllEntries: (query, projectId) => apiClient.getAllEntries(query, projectId),
  getEntries: (query, projectId) => apiClient.getEntries(query, projectId),
};

let current: HomeDataPort = httpHomePort;

/**
 * 창구를 갈아 끼운다. 앱이 시작할 때 사본 창구를 넣는다.
 *
 * null 을 주면 서버 창구로 되돌아간다. 사본을 버려야 하는 경우(로그아웃)에 쓴다.
 */
export function setHomeDataPort(port: HomeDataPort | null): void {
  current = port ?? httpHomePort;
}

export function homeDataPort(): HomeDataPort {
  return current;
}
