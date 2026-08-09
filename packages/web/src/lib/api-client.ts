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

  // v2 API Methods
  async getPeople() {
    const response = await this.client.get<any>('/v2/people');
    return response.data;
  }

  async createPerson(data: any) {
    const response = await this.client.post<any>('/v2/people', data);
    return response.data;
  }

  async updatePerson(id: string, data: any) {
    const response = await this.client.patch<any>(`/v2/people/${id}`, data);
    return response.data;
  }

  async deletePerson(id: string) {
    await this.client.delete(`/v2/people/${id}`);
  }

  async getAccountsV2() {
    const response = await this.client.get<any>('/v2/accounts');
    return response.data;
  }

  async getAccountV2(id: string) {
    const response = await this.client.get<any>(`/v2/accounts/${id}`);
    return response.data;
  }

  async createAccountV2(data: any) {
    const response = await this.client.post<any>('/v2/accounts', data);
    return response.data;
  }

  async updateAccountV2(id: string, data: any) {
    const response = await this.client.patch<any>(`/v2/accounts/${id}`, data);
    return response.data;
  }

  async deleteAccountV2(id: string) {
    await this.client.delete(`/v2/accounts/${id}`);
  }

  async getCards() {
    const response = await this.client.get<any>('/v2/cards');
    return response.data;
  }

  async getCard(id: string) {
    const response = await this.client.get<any>(`/v2/cards/${id}`);
    return response.data;
  }

  async createCard(data: any) {
    const response = await this.client.post<any>('/v2/cards', data);
    return response.data;
  }

  async useCard(cardId: string, data: any) {
    const response = await this.client.post<any>(`/v2/cards/${cardId}/use`, data);
    return response.data;
  }

  async payCard(cardId: string, data: any) {
    const response = await this.client.post<any>(`/v2/cards/${cardId}/pay`, data);
    return response.data;
  }

  async updateCard(id: string, data: any) {
    const response = await this.client.patch<any>(`/v2/cards/${id}`, data);
    return response.data;
  }

  async deleteCard(id: string) {
    await this.client.delete(`/v2/cards/${id}`);
  }

  async getTransactionsV2(query?: any) {
    const response = await this.client.get<any>('/v2/transactions', { params: query });
    return response.data;
  }

  async getTransaction(id: string) {
    const response = await this.client.get<any>(`/v2/transactions/${id}`);
    return response.data;
  }

  async createTransactionV2(data: any) {
    const response = await this.client.post<any>('/v2/transactions', data);
    return response.data;
  }

  async updateTransaction(id: string, data: any) {
    const response = await this.client.patch<any>(`/v2/transactions/${id}`, data);
    return response.data;
  }

  async deleteTransaction(id: string) {
    await this.client.delete(`/v2/transactions/${id}`);
  }

  async getCategories() {
    const response = await this.client.get<any>('/v2/categories');
    return response.data;
  }

  async createCategory(data: any) {
    const response = await this.client.post<any>('/v2/categories', data);
    return response.data;
  }

  async updateCategory(id: string, data: any) {
    const response = await this.client.patch<any>(`/v2/categories/${id}`, data);
    return response.data;
  }

  async deleteCategory(id: string) {
    await this.client.delete(`/v2/categories/${id}`);
  }

  async getTransactionStats(query?: any) {
    const response = await this.client.get<any>('/v2/transactions/statistics', { params: query });
    return response.data;
  }
}

export const apiClient = new ApiClient();
