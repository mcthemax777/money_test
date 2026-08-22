import axios, { AxiosInstance, AxiosError } from 'axios';
import Cookie from 'js-cookie';
import type {
  AccountDto,
  BudgetDto,
  CardDto,
  CategoryDto,
  EntryDto,
  EntryFilterQuery,
  FinancialInstitutionType,
  InstitutionDto,
  PersonDto,
  ReportDto,
} from '@money/types';

/**
 * 응답 타입은 서버와 같은 `@money/types` DTO를 쓴다.
 *
 * 예전에는 전부 `any`였다. 그 탓에 금액이 number에서 string으로 바뀐 변경이
 * 컴파일 단계에서 걸리지 않아, 예산 진행률이 문자열 비교로 101%가 되는 식의
 * 오류가 화면에서야 드러났다. 여기서 타입을 붙이면 같은 종류의 어긋남이 빌드에서 잡힌다.
 */

class ApiClient {
  private client: AxiosInstance;
  private readonly baseURL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

  constructor() {
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 10000,
    });

    this.setupInterceptors();
  }

  /**
   * 진행 중인 토큰 갱신. 동시에 401을 받은 요청들이 이 약속을 함께 기다린다.
   *
   * 예전에는 갱신 중이면 다른 401이 재시도 없이 바로 로그아웃으로 떨어졌다.
   * 액세스 토큰이 24시간이라 드물었지만, 15분으로 줄이면 화면 하나가 여러 요청을
   * 동시에 보내는 순간마다 로그인 화면으로 튕긴다.
   */
  private refreshPromise: Promise<string> | null = null;

  private setupInterceptors() {
    this.client.interceptors.request.use((config) => {
      const token = Cookie.get('accessToken');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as (typeof error.config & { _retried?: boolean });
        const isRefreshRequest = originalRequest?.url?.includes('/auth/refresh');

        if (error.response?.status !== 401 || !originalRequest || isRefreshRequest) {
          if (error.response?.status === 401) this.clearSession();
          return Promise.reject(error);
        }

        // 갱신한 토큰으로도 401이면 더 시도하지 않는다. 무한 재시도를 막는다.
        if (originalRequest._retried) {
          this.clearSession();
          return Promise.reject(error);
        }

        try {
          const accessToken = await this.refreshAccessToken();
          originalRequest._retried = true;
          originalRequest.headers = originalRequest.headers ?? {};
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
          return await this.client(originalRequest);
        } catch (refreshError) {
          this.clearSession();
          return Promise.reject(refreshError);
        }
      },
    );
  }

  /** 갱신은 한 번만 실행하고, 동시에 들어온 요청은 같은 결과를 나눠 쓴다. */
  private refreshAccessToken(): Promise<string> {
    if (this.refreshPromise) return this.refreshPromise;

    const refreshToken = Cookie.get('refreshToken');
    if (!refreshToken) return Promise.reject(new Error('No refresh token'));

    this.refreshPromise = this.client
      .post<{ accessToken: string; refreshToken: string }>('/auth/refresh', { refreshToken })
      .then((response) => {
        const { accessToken, refreshToken: newRefreshToken } = response.data;
        Cookie.set('accessToken', accessToken);
        Cookie.set('refreshToken', newRefreshToken);
        return accessToken;
      })
      .finally(() => {
        this.refreshPromise = null;
      });

    return this.refreshPromise;
  }

  private clearSession() {
    Cookie.remove('accessToken');
    Cookie.remove('refreshToken');
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
  }

  async signInWithGoogle(idToken: string) {
    const response = await this.client.post<any>('/auth/google', { idToken });
    return response.data;
  }

  async logout(refreshToken?: string) {
    try {
      await this.client.post('/auth/logout', { refreshToken });
    } catch {
      // 네트워크 에러는 무시하고 로컬에서만 삭제
    }
    Cookie.remove('accessToken');
    Cookie.remove('refreshToken');
  }

  async getProfile() {
    const response = await this.client.get<any>('/users/me');
    return response.data;
  }

  async updateProfile(data: { name?: string; avatar?: string }) {
    const response = await this.client.patch<any>('/users/me', data);
    return response.data;
  }

  async setDefaultProject(projectId: string) {
    const response = await this.client.patch<any>('/users/me/default-project', {
      projectId,
    });
    return response.data;
  }

  // API Methods
  async getPeople(projectId?: string | null): Promise<PersonDto.Response[]> {
    const response = await this.client.get<PersonDto.Response[]>('/people', {
      params: projectId ? { projectId } : {}
    });
    return response.data;
  }

  async createPerson(data: PersonDto.CreateRequest & { projectId?: string | null }): Promise<PersonDto.Response> {
    const { projectId, ...payload } = data;
    const response = await this.client.post<PersonDto.Response>('/people', payload, {
      params: projectId ? { projectId } : {}
    });
    return response.data;
  }

  async updatePerson(id: string, data: PersonDto.UpdateRequest): Promise<PersonDto.Response> {
    const response = await this.client.patch<PersonDto.Response>(`/people/${id}`, data);
    return response.data;
  }

  async deletePerson(id: string) {
    await this.client.delete(`/people/${id}`);
  }

  /**
   * 은행/카드사 목록. 기본 제공 항목과 이 프로젝트가 추가한 항목이 함께 온다.
   * type을 주면 그 용도만 걸러서 온다.
   */
  async getInstitutions(
    type?: FinancialInstitutionType,
    projectId?: string | null,
  ): Promise<InstitutionDto.Response[]> {
    const response = await this.client.get<InstitutionDto.Response[]>('/institutions', {
      params: { ...(type ? { type } : {}), ...(projectId ? { projectId } : {}) }
    });
    return response.data;
  }

  async getAccountsV2(projectId?: string | null): Promise<AccountDto.Response[]> {
    const response = await this.client.get<AccountDto.Response[]>('/accounts', {
      params: projectId ? { projectId } : {}
    });
    return response.data;
  }

  async getAccountV2(id: string): Promise<AccountDto.Response> {
    const response = await this.client.get<AccountDto.Response>(`/accounts/${id}`);
    return response.data;
  }

  async createAccountV2(data: AccountDto.CreateRequest): Promise<AccountDto.Response> {
    const { projectId, ...payload } = data;
    const response = await this.client.post<AccountDto.Response>('/accounts', payload, {
      params: projectId ? { projectId } : {}
    });
    return response.data;
  }

  async updateAccountV2(id: string, data: AccountDto.UpdateRequest): Promise<AccountDto.Response> {
    const response = await this.client.patch<AccountDto.Response>(`/accounts/${id}`, data);
    return response.data;
  }

  async deleteAccountV2(id: string) {
    await this.client.delete(`/accounts/${id}`);
  }

  async getCards(projectId?: string | null): Promise<CardDto.Response[]> {
    const response = await this.client.get<CardDto.Response[]>('/cards', {
      params: projectId ? { projectId } : {}
    });
    return response.data;
  }

  async getCard(id: string): Promise<CardDto.Response> {
    const response = await this.client.get<CardDto.Response>(`/cards/${id}`);
    return response.data;
  }

  async createCard(data: CardDto.CreateRequest): Promise<CardDto.Response> {
    const { projectId, ...payload } = data;
    const response = await this.client.post<CardDto.Response>('/cards', payload, {
      params: projectId ? { projectId } : {}
    });
    return response.data;
  }

  async updateCard(id: string, data: CardDto.UpdateRequest): Promise<CardDto.Response> {
    const response = await this.client.patch<CardDto.Response>(`/cards/${id}`, data);
    return response.data;
  }

  async deleteCard(id: string) {
    await this.client.delete(`/cards/${id}`);
  }

  /**
   * 거래 목록. 커서 기반이라 응답은 { data, nextCursor } 형태다.
   * 예전 getTransactionsV2의 가짜 pagination 응답과 다르다.
   */
  async getEntries(query?: EntryDto.ListQuery, projectId?: string | null): Promise<EntryDto.ListResponse> {
    const params: Record<string, unknown> = { ...query };
    if (projectId) params.projectId = projectId;
    const response = await this.client.get<EntryDto.ListResponse>('/entries', { params });
    return response.data;
  }

  /** 커서를 따라가며 조건에 맞는 거래를 전부 가져온다 (엑셀 내보내기 등 일괄 처리용). */
  async getAllEntries(query?: EntryDto.ListQuery, projectId?: string | null): Promise<EntryDto.ListResponse['data']> {
    const rows: any[] = [];
    let cursor: string | null = null;

    do {
      const page = await this.getEntries({ ...query, limit: 200, cursor: cursor ?? undefined }, projectId);
      rows.push(...(page?.data ?? []));
      cursor = page?.nextCursor ?? null;
    } while (cursor);

    return rows;
  }

  async getEntry(id: string): Promise<EntryDto.Detail> {
    const response = await this.client.get<EntryDto.Detail>(`/entries/${id}`);
    return response.data;
  }

  async createEntry(data: EntryDto.CreateRequest): Promise<EntryDto.Detail> {
    const { projectId, ...payload } = data;
    const response = await this.client.post<EntryDto.Detail>('/entries', payload, {
      params: projectId ? { projectId } : {},
    });
    return response.data;
  }

  async updateEntry(id: string, data: EntryDto.UpdateRequest): Promise<EntryDto.Detail> {
    const response = await this.client.patch<EntryDto.Detail>(`/entries/${id}`, data);
    return response.data;
  }

  async deleteEntry(id: string) {
    await this.client.delete(`/entries/${id}`);
  }

  async getAccountPostings(
    accountId: string,
    query?: { limit?: number; cursor?: string },
  ): Promise<AccountDto.LedgerResponse> {
    const response = await this.client.get<AccountDto.LedgerResponse>(`/accounts/${accountId}/postings`, {
      params: query ?? {},
    });
    return response.data;
  }

  async getCategories(
    projectId?: string | null,
    type?: 'income' | 'expense',
  ): Promise<CategoryDto.Response[]> {
    const params: any = {};
    if (projectId) params.projectId = projectId;
    if (type) params.type = type;
    const response = await this.client.get<CategoryDto.Response[]>('/categories', {
      params
    });
    return response.data;
  }

  async createCategory(data: CategoryDto.CreateRequest): Promise<CategoryDto.Response> {
    const { projectId, ...payload } = data;
    const response = await this.client.post<CategoryDto.Response>('/categories', payload, {
      params: projectId ? { projectId } : {}
    });
    return response.data;
  }

  async updateCategory(id: string, data: CategoryDto.UpdateRequest): Promise<CategoryDto.Response> {
    const response = await this.client.patch<CategoryDto.Response>(`/categories/${id}`, data);
    return response.data;
  }

  async deleteCategory(id: string) {
    await this.client.delete(`/categories/${id}`);
  }

  // 프로젝트 API Methods
  async createProject(name: string, description?: string) {
    const response = await this.client.post<any>('/projects', {
      name,
      description,
    });
    return response.data;
  }

  async getMyProjects() {
    const response = await this.client.get<any>('/projects');
    return response.data;
  }

  /** 프로젝트 설정 변경 (이름, 설명, 집계 기준 타임존). 소유자만 가능하다. */
  async updateProject(
    projectId: string,
    body: { name?: string; description?: string | null; timezone?: string },
  ) {
    const response = await this.client.patch<any>(`/projects/${projectId}`, body);
    return response.data;
  }

  /** "구성원 중 나" 지정. null이면 해제. */
  async setMyPerson(projectId: string, personId: string | null) {
    const response = await this.client.patch<any>(`/projects/${projectId}/me`, { personId });
    return response.data;
  }

  /** 목록 표시 순서 저장. 화면에 보이는 순서대로 id를 보낸다. */
  async reorderPeople(ids: string[], projectId?: string | null) {
    const response = await this.client.patch<PersonDto.Response[]>('/people/reorder', { ids }, {
      params: projectId ? { projectId } : {},
    });
    return response.data;
  }

  async reorderAccounts(ids: string[], projectId?: string | null) {
    const response = await this.client.patch<AccountDto.Response[]>('/accounts/reorder', { ids }, {
      params: projectId ? { projectId } : {},
    });
    return response.data;
  }

  async reorderCards(ids: string[], projectId?: string | null) {
    const response = await this.client.patch<CardDto.Response[]>('/cards/reorder', { ids }, {
      params: projectId ? { projectId } : {},
    });
    return response.data;
  }

  async reorderCategories(ids: string[], projectId?: string | null) {
    const response = await this.client.patch<CategoryDto.Response[]>('/categories/reorder', { ids }, {
      params: projectId ? { projectId } : {},
    });
    return response.data;
  }

  async leaveProject(projectId: string) {
    const response = await this.client.post<any>(`/projects/${projectId}/leave`);
    return response.data;
  }

  async deleteProject(projectId: string) {
    const response = await this.client.delete<any>(`/projects/${projectId}`);
    return response.data;
  }

  async getProjectMembers(projectId: string) {
    const response = await this.client.get<any>(`/projects/${projectId}/members`);
    return response.data;
  }

  async removeProjectMember(projectId: string, userId: string) {
    const response = await this.client.delete<any>(`/projects/${projectId}/members/${userId}`);
    return response.data;
  }

  async generateInvitationLink(projectId: string, role: 'editor' | 'viewer') {
    const response = await this.client.post<any>(`/projects/${projectId}/invitations/link`, {
      role,
    });
    return response.data;
  }

  async getInvitationByCode(invitationCode: string) {
    const response = await this.client.get<any>(`/projects/invitations/${invitationCode}`);
    return response.data;
  }

  async revokeInvitation(invitationId: string) {
    const response = await this.client.delete<any>(`/projects/invitations/${invitationId}`);
    return response.data;
  }

  async acceptInvitation(invitationCode: string) {
    const response = await this.client.post<any>(`/projects/invitations/${invitationCode}/accept`);
    return response.data;
  }

  async declineInvitation(invitationCode: string) {
    const response = await this.client.post<any>(`/projects/invitations/${invitationCode}/decline`);
    return response.data;
  }

  async getProjectPendingInvitations(projectId: string) {
    const response = await this.client.get<any>(`/projects/${projectId}/invitations/pending`);
    return response.data;
  }

  // 가입 요청 API Methods
  async findProjectByKey(key: string) {
    const response = await this.client.get<any>('/projects/search', { params: { key } });
    return response.data;
  }

  async requestToJoinProject(projectId: string, message?: string) {
    const response = await this.client.post<any>(`/projects/${projectId}/join-requests`, {
      message,
    });
    return response.data;
  }

  async getProjectJoinRequests(projectId: string) {
    const response = await this.client.get<any>(`/projects/${projectId}/join-requests`);
    return response.data;
  }

  async getMyJoinRequests() {
    const response = await this.client.get<any>('/projects/join-requests/mine');
    return response.data;
  }

  async approveJoinRequest(requestId: string, role: 'editor' | 'viewer' = 'editor') {
    const response = await this.client.post<any>(`/projects/join-requests/${requestId}/approve`, {
      role,
    });
    return response.data;
  }

  async rejectJoinRequest(requestId: string) {
    const response = await this.client.post<any>(`/projects/join-requests/${requestId}/reject`);
    return response.data;
  }

  async cancelJoinRequest(requestId: string) {
    const response = await this.client.delete<any>(`/projects/join-requests/${requestId}`);
    return response.data;
  }

  // 예산 API Methods
  async createBudget(data: BudgetDto.CreateRequest): Promise<BudgetDto.Response> {
    const { projectId, ...payload } = data;
    const response = await this.client.post<BudgetDto.Response>('/budgets', payload, {
      params: projectId ? { projectId } : {},
    });
    return response.data;
  }

  async getBudgets(projectId?: string | null): Promise<BudgetDto.Response[]> {
    const response = await this.client.get<BudgetDto.Response[]>('/budgets', {
      params: projectId ? { projectId } : {},
    });
    return response.data;
  }

  async getBudget(id: string): Promise<BudgetDto.Response> {
    const response = await this.client.get<BudgetDto.Response>(`/budgets/${id}`);
    return response.data;
  }

  async updateBudget(id: string, data: BudgetDto.UpdateRequest): Promise<BudgetDto.Response> {
    const response = await this.client.patch<BudgetDto.Response>(`/budgets/${id}`, data);
    return response.data;
  }

  async deleteBudget(id: string) {
    await this.client.delete(`/budgets/${id}`);
  }

  /** filter는 가계 화면의 자산주인/고정 필터. 사용금액에 같은 조건이 걸린다. */
  async getBudgetForMonth(
    year: number,
    month: number,
    projectId?: string | null,
    filter?: EntryFilterQuery,
  ): Promise<BudgetDto.MonthlyBudget[]> {
    const response = await this.client.get<BudgetDto.MonthlyBudget[]>(`/budgets/${year}/${month}`, {
      params: { ...(projectId ? { projectId } : {}), ...filter },
    });
    return response.data;
  }

  async createBudgetOverride(data: BudgetDto.OverrideRequest): Promise<BudgetDto.OverrideResponse> {
    const response = await this.client.post<BudgetDto.OverrideResponse>('/budgets/override', data);
    return response.data;
  }

  async deleteBudgetOverride(id: string) {
    await this.client.delete(`/budgets/override/${id}`);
  }

  // 카드 원장 API Methods
  //
  // 청구서를 저장하지 않는다. 주기별 사용액은 카드의 현재 마감일로 서버가 계산한다.
  async getCardUsage(cardId: string, months?: number): Promise<CardDto.UsageResponse> {
    const response = await this.client.get<CardDto.UsageResponse>(`/cards/${cardId}/usage`, {
      params: months ? { months } : undefined,
    });
    return response.data;
  }

  /** 카드사와 통장 사이 자금 이동. direction으로 대금 결제와 환불 입금을 가른다. */
  async createCardTransfer(cardId: string, data: CardDto.TransferRequest) {
    const response = await this.client.post<any>(`/cards/${cardId}/transfers`, data);
    return response.data;
  }

  // 리포트 API Methods
  //
  // 집계는 전부 서버에서 한다. 화면이 거래 전량을 받아 합산하던 코드를 대체한다.
  /** filter는 가계 화면의 사람/고정 필터. 목록과 같은 조건을 넘겨야 합계가 맞는다. */
  async getSummary(
    yearMonth: string,
    projectId?: string | null,
    filter?: EntryFilterQuery & { personId?: string },
  ) {
    const response = await this.client.get<any>('/reports/summary', {
      params: { yearMonth, ...(projectId ? { projectId } : {}), ...filter },
    });
    return response.data;
  }

  async getCategoryBreakdown(
    yearMonth: string,
    type: 'income' | 'expense',
    projectId?: string | null,
    options?: { rollup?: boolean; personId?: string } & EntryFilterQuery,
  ) {
    const { rollup, ...filter } = options ?? {};
    const response = await this.client.get<any>('/reports/category-breakdown', {
      params: {
        yearMonth,
        type,
        ...(projectId ? { projectId } : {}),
        ...(rollup === false ? { rollup: false } : {}),
        ...filter,
      },
    });
    return response.data;
  }

  async getNetWorth(projectId?: string | null) {
    const response = await this.client.get<any>('/reports/net-worth', {
      params: projectId ? { projectId } : {},
    });
    return response.data;
  }

  async getTrend(
    target: 'category' | 'account' | 'card' | 'total',
    options: {
      targetId?: string;
      endMonth?: string;
      months?: number;
      type?: 'income' | 'expense';
    } & EntryFilterQuery,
    projectId?: string | null,
  ) {
    const response = await this.client.get<any>('/reports/trend', {
      params: { target, ...options, ...(projectId ? { projectId } : {}) },
    });
    return response.data;
  }

  /** 자산 잔액 추이. accountId를 주면 그 계좌만, 생략하면 전체 합계. */
  async getBalanceHistory(
    options: {
      accountId?: string;
      granularity?: 'month' | 'day';
      endMonth?: string;
      yearMonth?: string;
      months?: number;
    },
    projectId?: string | null,
  ): Promise<ReportDto.BalanceHistoryPoint[]> {
    const response = await this.client.get<ReportDto.BalanceHistoryPoint[]>(
      '/reports/balance-history',
      { params: { ...options, ...(projectId ? { projectId } : {}) } },
    );
    return response.data;
  }

  async getPaymentMethods(
    yearMonth: string,
    projectId?: string | null,
    filter?: EntryFilterQuery & { personId?: string },
  ) {
    const response = await this.client.get<any>('/reports/payment-methods', {
      params: { yearMonth, ...(projectId ? { projectId } : {}), ...filter },
    });
    return response.data;
  }
}

export const apiClient = new ApiClient();
