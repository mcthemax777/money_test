import axios, { AxiosInstance, AxiosError } from 'axios';
import Cookie from 'js-cookie';

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

  private isRefreshing = false;

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
        const originalRequest = error.config;
        const isRefreshRequest = originalRequest?.url?.includes('/auth/refresh');

        if (error.response?.status === 401 && !isRefreshRequest && !this.isRefreshing) {
          const refreshToken = Cookie.get('refreshToken');
          if (refreshToken && originalRequest) {
            this.isRefreshing = true;
            try {
              const response = await this.client.post<any>('/auth/refresh', { refreshToken });
              const data = response.data.data || response.data;
              const { accessToken, refreshToken: newRefreshToken } = data;

              Cookie.set('accessToken', accessToken);
              Cookie.set('refreshToken', newRefreshToken);

              originalRequest.headers.Authorization = `Bearer ${accessToken}`;
              return this.client(originalRequest);
            } catch {
              Cookie.remove('accessToken');
              Cookie.remove('refreshToken');
              window.location.href = '/login';
            } finally {
              this.isRefreshing = false;
            }
          }
        }

        if (error.response?.status === 401) {
          Cookie.remove('accessToken');
          Cookie.remove('refreshToken');
          window.location.href = '/login';
        }

        return Promise.reject(error);
      },
    );
  }

  async signUp(email: string, password: string, name: string) {
    const response = await this.client.post<any>('/auth/signup', {
      email,
      password,
      name,
    });
    return response.data;
  }

  async signIn(email: string, password: string) {
    const response = await this.client.post<any>('/auth/signin', {
      email,
      password,
    });
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

  async setDefaultProject(projectId: string) {
    const response = await this.client.patch<any>('/users/me/default-project', {
      projectId,
    });
    return response.data;
  }

  // API Methods
  async getPeople(projectId?: string | null) {
    const response = await this.client.get<any>('/people', {
      params: projectId ? { projectId } : {}
    });
    return response.data;
  }

  async createPerson(data: any) {
    const { projectId, ...payload } = data;
    const response = await this.client.post<any>('/people', payload, {
      params: projectId ? { projectId } : {}
    });
    return response.data;
  }

  async updatePerson(id: string, data: any) {
    const response = await this.client.patch<any>(`/people/${id}`, data);
    return response.data;
  }

  async deletePerson(id: string) {
    await this.client.delete(`/people/${id}`);
  }

  async getAccountsV2(projectId?: string | null) {
    const response = await this.client.get<any>('/accounts', {
      params: projectId ? { projectId } : {}
    });
    return response.data;
  }

  async getAccountV2(id: string) {
    const response = await this.client.get<any>(`/accounts/${id}`);
    return response.data;
  }

  async createAccountV2(data: any) {
    const { projectId, ...payload } = data;
    const response = await this.client.post<any>('/accounts', payload, {
      params: projectId ? { projectId } : {}
    });
    return response.data;
  }

  async updateAccountV2(id: string, data: any) {
    const response = await this.client.patch<any>(`/accounts/${id}`, data);
    return response.data;
  }

  async deleteAccountV2(id: string) {
    await this.client.delete(`/accounts/${id}`);
  }

  async getCards(projectId?: string | null) {
    const response = await this.client.get<any>('/cards', {
      params: projectId ? { projectId } : {}
    });
    return response.data;
  }

  async getCard(id: string) {
    const response = await this.client.get<any>(`/cards/${id}`);
    return response.data;
  }

  async createCard(data: any) {
    const { projectId, ...payload } = data;
    const response = await this.client.post<any>('/cards', payload, {
      params: projectId ? { projectId } : {}
    });
    return response.data;
  }

  async useCard(cardId: string, data: any) {
    const response = await this.client.post<any>(`/cards/${cardId}/use`, data);
    return response.data;
  }

  async payCard(cardId: string, data: any) {
    const response = await this.client.post<any>(`/cards/${cardId}/pay`, data);
    return response.data;
  }

  async updateCard(id: string, data: any) {
    const response = await this.client.patch<any>(`/cards/${id}`, data);
    return response.data;
  }

  async deleteCard(id: string) {
    await this.client.delete(`/cards/${id}`);
  }

  async getTransactionsV2(query?: any, projectId?: string | null) {
    const params = { ...query };
    if (projectId) params.projectId = projectId;
    const response = await this.client.get<any>('/transactions', { params });
    return response.data;
  }

  async getTransaction(id: string) {
    const response = await this.client.get<any>(`/transactions/${id}`);
    return response.data;
  }

  async createTransactionV2(data: any) {
    const { projectId, ...payload } = data;
    const response = await this.client.post<any>('/transactions', payload, {
      params: projectId ? { projectId } : {}
    });
    return response.data;
  }

  async updateTransaction(id: string, data: any) {
    const response = await this.client.patch<any>(`/transactions/${id}`, data);
    return response.data;
  }

  async deleteTransaction(id: string) {
    await this.client.delete(`/transactions/${id}`);
  }

  async getCategories(projectId?: string | null, type?: 'income' | 'expense') {
    const params: any = {};
    if (projectId) params.projectId = projectId;
    if (type) params.type = type;
    const response = await this.client.get<any>('/categories', {
      params
    });
    return response.data;
  }

  async createCategory(data: any) {
    const { projectId, ...payload } = data;
    const response = await this.client.post<any>('/categories', payload, {
      params: projectId ? { projectId } : {}
    });
    return response.data;
  }

  async updateCategory(id: string, data: any) {
    const response = await this.client.patch<any>(`/categories/${id}`, data);
    return response.data;
  }

  async deleteCategory(id: string) {
    await this.client.delete(`/categories/${id}`);
  }

  async getTransactionStats(query?: any) {
    const response = await this.client.get<any>('/transactions/statistics', { params: query });
    return response.data;
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

  async sendEmailInvitation(projectId: string, email: string, role: string) {
    const response = await this.client.post<any>(`/projects/${projectId}/invitations/email`, {
      email,
      role,
    });
    return response.data;
  }

  async generateInvitationLink(projectId: string, role: string) {
    const response = await this.client.post<any>(`/projects/${projectId}/invitations/link`, {
      role,
    });
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

  // 예산 API Methods
  async createBudget(data: any) {
    const { projectId, ...payload } = data;
    const response = await this.client.post<any>('/budgets', payload, {
      params: projectId ? { projectId } : {},
    });
    return response.data;
  }

  async getBudgets(projectId?: string | null) {
    const response = await this.client.get<any>('/budgets', {
      params: projectId ? { projectId } : {},
    });
    return response.data;
  }

  async getBudget(id: string) {
    const response = await this.client.get<any>(`/budgets/${id}`);
    return response.data;
  }

  async updateBudget(id: string, data: any) {
    const response = await this.client.patch<any>(`/budgets/${id}`, data);
    return response.data;
  }

  async deleteBudget(id: string) {
    await this.client.delete(`/budgets/${id}`);
  }

  async getBudgetForMonth(year: number, month: number, projectId?: string | null) {
    const response = await this.client.get<any>(`/budgets/${year}/${month}`, {
      params: projectId ? { projectId } : {},
    });
    return response.data;
  }

  async createBudgetOverride(data: any) {
    const response = await this.client.post<any>('/budgets/override', data);
    return response.data;
  }

  async deleteBudgetOverride(id: string) {
    await this.client.delete(`/budgets/override/${id}`);
  }

  // 신용카드 결제 API Methods
  async getPendingCardPayments(projectId: string | null | undefined, cardId?: string) {
    const params: any = {};
    if (projectId) params.projectId = projectId;
    if (cardId) params.cardId = cardId;
    const response = await this.client.get<any>('/card-payments/pending', { params });
    return response.data;
  }

  async getCardPaymentDetail(paymentId: string) {
    const response = await this.client.get<any>(`/card-payments/${paymentId}`);
    return response.data;
  }

  async payCardPayment(paymentId: string, data: { amount: number; transactionDate?: string }) {
    const response = await this.client.post<any>(`/card-payments/${paymentId}/pay`, data);
    return response.data;
  }

  async cancelCardPayment(transactionId: string) {
    const response = await this.client.post<any>(`/card-payments/cancel/${transactionId}`);
    return response.data;
  }
}

export const apiClient = new ApiClient();
