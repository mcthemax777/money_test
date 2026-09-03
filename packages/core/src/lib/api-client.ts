import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  clearAuthTokens,
  getAccessToken,
  getRefreshToken,
  saveAuthTokens,
} from './auth-tokens';
import { hasRandomSource, newId, withNewId } from '@money/types';
import type {
  PushRequest,
  PushResponse,
  SyncDto,
  AccountDto,
  BudgetDto,
  CardDto,
  CategoryDto,
  TagDto,
  EntryDto,
  EntryFilterQuery,
  ExchangeRateInfo,
  FinancialInstitutionType,
  InstitutionDto,
  Locale,
  PersonDto,
  ReportDto,
  EntryScopeQuery,
} from '@money/types';

/**
 * 응답 타입은 서버와 같은 `@money/types` DTO를 쓴다.
 *
 * 예전에는 전부 `any`였다. 그 탓에 금액이 number에서 string으로 바뀐 변경이
 * 컴파일 단계에서 걸리지 않아, 예산 진행률이 문자열 비교로 101%가 되는 식의
 * 오류가 화면에서야 드러났다. 여기서 타입을 붙이면 같은 종류의 어긋남이 빌드에서 잡힌다.
 */

/**
 * 환율 응답.
 *
 * rates 는 각 통화 -> 저장 통화다. 거래를 입력할 때 쓴다.
 * displayRate 는 저장 통화 -> 표시 통화이며 화면 합계에 이미 반영돼 온다.
 */
/**
 * 리포트가 볼 구간.
 *
 * 한 달이거나 임의 구간이다. 달력의 달과 어긋나는 구간(카드 청구주기, 여행 기간)을
 * 보는 일이 있어서 둘 다 받는다. 날짜는 프로젝트 타임존의 달력 날짜이고 양끝을 포함한다.
 */
export type ReportPeriod =
  | { yearMonth: string; startDate?: undefined; endDate?: undefined }
  | { startDate: string; endDate: string; yearMonth?: undefined };

export interface ExchangeRatesResponse {
  ledgerCurrency: string;
  displayCurrency: string;
  rates: ExchangeRateInfo[];
  displayRate: ExchangeRateInfo;
}

class ApiClient {
  private client: AxiosInstance;
  /**
   * 서버 주소.
   *
   * 웹은 빌드 때 박히는 환경변수를 쓴다. 앱은 번들에 그 값이 없으므로 시작할 때
   * setBaseUrl로 넣는다 (기기·에뮬레이터마다 보는 주소가 다르다).
   */
  private readonly baseURL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

  /**
   * 세션이 끊겼을 때 할 일. 화면 이동 방법이 웹과 앱이 달라 밖에서 받는다.
   * 넣지 않으면 브라우저 기준으로 /login 으로 옮긴다.
   */
  private onUnauthorized: (() => void) | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 10000,
    });

    this.setupInterceptors();
  }

  /**
   * 만드는 요청에 기기가 만든 id 를 붙인다.
   *
   * 규칙은 `@money/types` 의 withNewId 가 갖는다(기기도 아웃박스에서 같은 규칙을
   * 쓴다). 지금부터 온라인 경로로 이 id 를 흘려보내 두면, 아웃박스가 붙을 때 새로
   * 검증할 것이 남지 않는다.
   */
  private withId<T extends { id?: string }>(payload: T): T {
    return withNewId(payload);
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
    this.client.interceptors.request.use(async (config) => {
      /*
       * 만료가 코앞이면 보내기 전에 먼저 갱신한다.
       *
       * 예전에는 만료된 토큰으로 그냥 보내고, 401을 받은 뒤에 갱신해 다시 보냈다.
       * 결과는 같지만 그 사이에 왕복이 한 번 더 들어가 화면이 그만큼 늦게 뜨고,
       * 브라우저 콘솔에는 실패한 요청이 빨간 줄로 남는다. 화면 하나가 요청을
       * 여럿 보내는 홈에서는 그 줄이 한 번에 여러 개씩 쌓인다.
       *
       * 갱신 자체는 예외다. 그 요청까지 여기서 갱신을 부르면 서로를 부르는 고리가 된다.
       */
      if (!config.url?.includes('/auth/refresh')) {
        await this.refreshIfExpiring();
      }

      const token = getAccessToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as (typeof error.config & { _retried?: boolean });

        /*
         * 로그인과 토큰 갱신 자체는 갱신으로 되살릴 수 없다. 아직 세션이 없거나,
         * 있던 것이 이미 거절된 요청이기 때문이다.
         *
         * 이것을 가르지 않으면 로그인 실패(401)가 갱신 경로로 흘러들어 "No refresh
         * token"으로 바뀌어 나온다. 서버가 왜 거절했는지가 그 자리에서 지워진다.
         */
        const isSessionRequest =
          originalRequest?.url?.includes('/auth/refresh') ||
          originalRequest?.url?.includes('/auth/google');

        if (error.response?.status !== 401 || !originalRequest || isSessionRequest) {
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

  /**
   * 만료까지 이만큼도 안 남았으면 미리 갱신한다(ms).
   *
   * 0으로 두면 "아직 살아 있는" 토큰으로 보냈다가 서버에 닿는 사이에 죽는 일이
   * 생긴다. 브라우저와 서버의 시계가 조금 어긋나 있을 수도 있다.
   */
  private static readonly REFRESH_LEEWAY_MS = 60_000;

  /**
   * 액세스 토큰의 만료 시각(ms). 읽을 수 없으면 null.
   *
   * 서명을 검증하지는 않는다. 그것은 서버가 할 일이고, 여기서 알고 싶은 것은
   * "언제까지 쓸 수 있는 값인가" 하나뿐이다.
   */
  private expiresAt(token: string): number | null {
    const payload = token.split('.')[1];
    if (!payload) return null;

    try {
      const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
      const { exp } = JSON.parse(json) as { exp?: number };
      return typeof exp === 'number' ? exp * 1000 : null;
    } catch {
      return null;
    }
  }

  /**
   * 만료가 가까우면 갱신하고, 아니면 아무 일도 하지 않는다.
   *
   * 갱신에 실패해도 여기서 로그아웃시키지 않는다. 원래 요청은 그대로 나가고,
   * 서버가 401을 주면 아래 응답 인터셉터가 한 번 더 시도한 뒤 정리한다.
   * 그물망을 두 겹으로 두는 편이 일시적인 네트워크 오류에 강하다.
   */
  private async refreshIfExpiring(): Promise<void> {
    const token = getAccessToken();
    if (!token || !getRefreshToken()) return;

    const expiresAt = this.expiresAt(token);
    if (expiresAt === null) return;
    if (expiresAt - Date.now() > ApiClient.REFRESH_LEEWAY_MS) return;

    try {
      await this.refreshAccessToken();
    } catch {
      // 아래 401 경로가 받는다.
    }
  }

  /** 갱신은 한 번만 실행하고, 동시에 들어온 요청은 같은 결과를 나눠 쓴다. */
  private refreshAccessToken(): Promise<string> {
    if (this.refreshPromise) return this.refreshPromise;

    const refreshToken = getRefreshToken();
    if (!refreshToken) return Promise.reject(new Error('No refresh token'));

    this.refreshPromise = this.client
      .post<{ accessToken: string; refreshToken: string }>('/auth/refresh', { refreshToken })
      .then((response) => {
        const { accessToken, refreshToken: newRefreshToken } = response.data;
        saveAuthTokens(accessToken, newRefreshToken);
        return accessToken;
      })
      .finally(() => {
        this.refreshPromise = null;
      });

    return this.refreshPromise;
  }

  /** 앱이 시작할 때 서버 주소를 정한다. */
  setBaseUrl(url: string) {
    this.client.defaults.baseURL = url;
  }

  /**
   * 지금 보고 있는 서버 주소.
   *
   * 알림 연결(SSE)은 axios 를 쓰지 않는다. 응답을 끝까지 기다리지 않고 조금씩 읽어야
   * 해서 스트리밍을 지원하는 fetch 로 직접 연다. 그 자리에서 이 주소가 필요하다.
   */
  get baseUrl(): string {
    return this.client.defaults.baseURL || this.baseURL;
  }

  /**
   * 만료가 코앞이면 미리 갱신한다.
   *
   * 알림 연결은 붙을 때 한 번만 토큰을 보낸다. 만료된 토큰으로 붙으면 401 로 끊기고,
   * 다시 붙기를 반복하는 동안 화면이 실시간을 잃는다. 그래서 붙기 전에 부른다.
   */
  async ensureFreshToken(): Promise<void> {
    await this.refreshIfExpiring();
  }

  /** 세션이 끊겼을 때 부를 것을 등록한다 (앱은 로그인 화면으로 되돌린다). */
  setUnauthorizedHandler(handler: () => void) {
    this.onUnauthorized = handler;
  }

  private clearSession() {
    clearAuthTokens();

    if (this.onUnauthorized) {
      this.onUnauthorized();
      return;
    }

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
    clearAuthTokens();
  }

  async getProfile() {
    const response = await this.client.get<any>('/users/me');
    return response.data;
  }

  /** 이름·사진·화면 언어. 서버는 준 값만 고친다. */
  async updateProfile(data: { name?: string; avatar?: string; locale?: Locale }) {
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
  /** includeInactive를 주면 숨긴 구성원까지 함께 받는다 (다시 표시 화면용). */
  async getPeople(
    projectId?: string | null,
    options: { includeInactive?: boolean } = {},
  ): Promise<PersonDto.Response[]> {
    const response = await this.client.get<PersonDto.Response[]>('/people', {
      params: {
        ...(projectId ? { projectId } : {}),
        ...(options.includeInactive ? { includeInactive: 'true' } : {}),
      },
    });
    return response.data;
  }

  async createPerson(data: PersonDto.CreateRequest & { projectId?: string | null }): Promise<PersonDto.Response> {
    const { projectId, ...payload } = data;
    const response = await this.client.post<PersonDto.Response>('/people', this.withId(payload), {
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

  /** includeInactive를 주면 숨긴 통장까지 함께 받는다 (다시 표시 화면용). */
  async getAccountsV2(
    projectId?: string | null,
    options: { includeInactive?: boolean } = {},
  ): Promise<AccountDto.Response[]> {
    const response = await this.client.get<AccountDto.Response[]>('/accounts', {
      params: {
        ...(projectId ? { projectId } : {}),
        ...(options.includeInactive ? { includeInactive: 'true' } : {}),
      },
    });
    return response.data;
  }

  async getAccountV2(id: string): Promise<AccountDto.Response> {
    const response = await this.client.get<AccountDto.Response>(`/accounts/${id}`);
    return response.data;
  }

  async createAccountV2(data: AccountDto.CreateRequest): Promise<AccountDto.Response> {
    const { projectId, ...payload } = data;
    const response = await this.client.post<AccountDto.Response>('/accounts', this.withId(payload), {
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

  /** includeInactive를 주면 숨긴 카드까지 함께 받는다 (다시 표시 화면용). */
  async getCards(
    projectId?: string | null,
    options: { includeInactive?: boolean } = {},
  ): Promise<CardDto.Response[]> {
    const response = await this.client.get<CardDto.Response[]>('/cards', {
      params: {
        ...(projectId ? { projectId } : {}),
        ...(options.includeInactive ? { includeInactive: 'true' } : {}),
      },
    });
    return response.data;
  }

  async getCard(id: string): Promise<CardDto.Response> {
    const response = await this.client.get<CardDto.Response>(`/cards/${id}`);
    return response.data;
  }

  async createCard(data: CardDto.CreateRequest): Promise<CardDto.Response> {
    const { projectId, ...payload } = data;
    /*
     * 신용카드는 부채 계정과 함께 만들어진다. 그 계정 id 도 기기가 정해야 한다.
     * 서버가 정하면 오프라인에서 그 카드로 적은 거래가 어느 계정을 가리킬지 알 수 없다.
     */
    const withIds =
      payload.cardType === 'credit' && !payload.liabilityAccountId && hasRandomSource()
        ? { ...payload, liabilityAccountId: newId() }
        : payload;
    const response = await this.client.post<CardDto.Response>('/cards', this.withId(withIds), {
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

  /**
   * 커서를 따라가며 조건에 맞는 거래를 전부 가져온다.
   *
   * 엑셀 내보내기뿐 아니라 가계 화면·예산 상세·수단별 탭이 쓴다. 한 페이지만
   * 받으면 목록이 잘리는 데 그치지 않고, 그 목록으로 계산하는 달력 일별 합계와
   * 일별 누적 그래프가 서버 집계보다 적게 나온다.
   */
  async getAllEntries(query?: EntryDto.ListQuery, projectId?: string | null): Promise<EntryDto.ListResponse['data']> {
    const rows: any[] = [];
    let cursor: string | null = null;
    // 커서가 전진하지 않는 서버 버그가 생겨도 화면이 멈추지는 않게 한다.
    // 200 * 50 = 10,000건이면 어떤 한 달 조회에도 충분하다.
    const MAX_PAGES = 50;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const res: EntryDto.ListResponse = await this.getEntries(
        { ...query, limit: 200, cursor: cursor ?? undefined },
        projectId,
      );
      rows.push(...(res?.data ?? []));
      cursor = res?.nextCursor ?? null;
      if (!cursor) return rows;
    }

    console.warn(`거래를 ${MAX_PAGES}페이지까지만 불러왔습니다. 일부가 빠졌을 수 있습니다.`);
    return rows;
  }

  async getEntry(id: string): Promise<EntryDto.Detail> {
    const response = await this.client.get<EntryDto.Detail>(`/entries/${id}`);
    return response.data;
  }

  async createEntry(data: EntryDto.CreateRequest): Promise<EntryDto.Detail> {
    const { projectId, ...payload } = data;
    const response = await this.client.post<EntryDto.Detail>('/entries', this.withId(payload), {
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
    const response = await this.client.post<CategoryDto.Response>('/categories', this.withId(payload), {
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

  // 태그 API Methods

  async getTags(projectId?: string | null): Promise<TagDto.Response[]> {
    const response = await this.client.get<TagDto.Response[]>('/tags', {
      params: projectId ? { projectId } : {},
    });
    return response.data;
  }

  async createTag(data: TagDto.CreateRequest): Promise<TagDto.Response> {
    const { projectId, ...payload } = data;
    const response = await this.client.post<TagDto.Response>('/tags', this.withId(payload), {
      params: projectId ? { projectId } : {},
    });
    return response.data;
  }

  async updateTag(id: string, data: TagDto.UpdateRequest): Promise<TagDto.Response> {
    const response = await this.client.patch<TagDto.Response>(`/tags/${id}`, data);
    return response.data;
  }

  async deleteTag(id: string) {
    await this.client.delete(`/tags/${id}`);
  }

  /**
   * 여러 거래의 태그를 바꾼다. 더할 것과 뗄 것을 따로 보낸다.
   *
   * 수정(`updateEntry`)과 다른 길이다. 그쪽은 전표를 통째로 갈아 끼우므로 분할·외화까지
   * 온전한 값이 필요하다.
   */
  async changeEntryTags(
    data: { entryIds: string[]; addTagIds?: string[]; removeTagIds?: string[] },
    projectId?: string | null,
  ): Promise<EntryDto.ChangeTagsResponse> {
    const response = await this.client.post<EntryDto.ChangeTagsResponse>('/entries/tags', data, {
      params: projectId ? { projectId } : {},
    });
    return response.data;
  }

  async reorderTags(ids: string[], projectId?: string | null) {
    const response = await this.client.patch<TagDto.Response[]>(
      '/tags/reorder',
      { ids },
      { params: projectId ? { projectId } : {} },
    );
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

  /** 프로젝트 설정 변경 (이름, 설명, 집계 기준 타임존). 소유자만 가능하다. */
  async updateProject(
    projectId: string,
    body: {
      name?: string;
      description?: string | null;
      timezone?: string;
      /** 표시 통화. 저장값은 건드리지 않고 읽을 때만 환산된다. */
      displayCurrency?: string;
    },
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
    const response = await this.client.post<BudgetDto.Response>('/budgets', this.withId(payload), {
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

  /** fromMonth("YYYY-MM")를 주면 그 달부터만 없앤다. 이전 달의 예산은 남는다. */
  async deleteBudget(id: string, fromMonth?: string) {
    await this.client.delete(`/budgets/${id}`, {
      params: fromMonth ? { fromMonth } : {},
    });
  }

  /** 프로젝트의 예산을 모두 지운다. 월별 조정값도 함께 사라진다. */
  async resetBudgets(projectId?: string | null): Promise<{ deleted: number }> {
    const response = await this.client.delete<{ deleted: number }>('/budgets', {
      params: projectId ? { projectId } : {},
    });
    return response.data;
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

  /** 한 분류(또는 전체 예산)가 달마다 얼마인지. 예산 팝업의 월별 목록이 쓴다. */
  async getBudgetSchedule(
    query: Omit<BudgetDto.ScheduleQuery, 'projectId'>,
    projectId?: string | null,
  ): Promise<BudgetDto.ScheduleMonth[]> {
    const response = await this.client.get<BudgetDto.ScheduleMonth[]>('/budgets/schedule', {
      params: { ...query, ...(projectId ? { projectId } : {}) },
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

  /**
   * 기준통화 기준 환율.
   *
   * 거래 입력 화면이 통화를 고르는 순간 환율 칸을 미리 채우는 데 쓴다.
   * 사용자는 그 값을 카드 명세서의 실제 환율로 고칠 수 있다.
   */
  async getExchangeRates(projectId?: string | null): Promise<ExchangeRatesResponse> {
    const response = await this.client.get<ExchangeRatesResponse>('/exchange-rates', {
      params: projectId ? { projectId } : {},
    });
    return response.data;
  }

  /**
   * 환율을 직접 정한다. 설정 화면 전용이다.
   *
   * 거래 입력에서는 환율을 받지 않는다. 사용자가 아는 값은 실제로 빠진 금액이고
   * 환율은 그 비로 유도된다. 여기서 정한 값은 아직 금액을 모르는 거래(신용카드)를
   * 추정할 때와 표시 통화 환산에 쓰인다.
   */
  async setExchangeRate(
    data: { from: string; to: string; rate: string },
    projectId?: string | null,
  ): Promise<ExchangeRateInfo> {
    const response = await this.client.put<ExchangeRateInfo>('/exchange-rates', data, {
      params: projectId ? { projectId } : {},
    });
    return response.data;
  }

  /** 직접 정한 환율을 지우고 기본값으로 되돌린다. */
  async clearExchangeRate(from: string, to: string, projectId?: string | null): Promise<void> {
    await this.client.delete('/exchange-rates', {
      params: { from, to, ...(projectId ? { projectId } : {}) },
    });
  }

  // 카드 원장 API Methods
  //
  // 청구서를 저장하지 않는다. 주기별 사용액은 카드의 현재 마감일로 서버가 계산한다.
  /** 실적 진행 상황. 신용카드는 마감일 기준 주기, 체크카드는 달력 월로 센다. */
  async getCardPerformance(cardId: string): Promise<CardDto.PerformanceResponse> {
    const response = await this.client.get<CardDto.PerformanceResponse>(
      `/cards/${cardId}/performance`,
    );
    return response.data;
  }

  async getCardUsage(cardId: string, months?: number): Promise<CardDto.UsageResponse> {
    const response = await this.client.get<CardDto.UsageResponse>(`/cards/${cardId}/usage`, {
      params: months ? { months } : undefined,
    });
    return response.data;
  }

  /**
   * 청구액이 아직 확정되지 않은 외화 결제 목록.
   *
   * 원화 카드로 외화를 쓰면 청구액은 결제일에 카드사가 정한다. 그때까지는 추정
   * 환산액이 들어가 있고, 명세서가 나오면 아래 settleCardRates로 확정한다.
   */
  async getCardPendingRates(cardId: string): Promise<CardDto.PendingRatesResponse> {
    const response = await this.client.get<CardDto.PendingRatesResponse>(
      `/cards/${cardId}/pending-rates`,
    );
    return response.data;
  }

  /**
   * 실제 청구액(또는 적용 환율)으로 확정한다.
   *
   * 명세서에서 눈으로 읽는 값은 대개 금액이므로 billedAmount가 기본이고, 환율은
   * 서버가 역산한다. 명세서에 적용환율만 한 줄로 적혀 있으면 rate 하나로 전부
   * 확정할 수 있다.
   */
  async settleCardRates(
    cardId: string,
    data: CardDto.SettleRatesRequest,
  ): Promise<CardDto.SettleRatesResponse> {
    const response = await this.client.patch<CardDto.SettleRatesResponse>(
      `/cards/${cardId}/pending-rates`,
      data,
    );
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
  /**
   * filter는 가계 화면의 사람/고정 필터. 목록과 같은 조건을 넘겨야 합계가 맞는다.
   *
   * period 는 한 달(`{ yearMonth }`)이거나 임의 구간(`{ startDate, endDate }`)이다.
   * 서버가 둘을 같은 규칙으로 푼다 (ReportsService.resolvePeriod).
   */
  // ── 동기화 ──

  /**
   * 마지막으로 받은 번호 뒤의 변경분.
   *
   * 기기의 동기화 엔진이 이 함수를 그대로 받아 쓴다(`PullFn`). 오프라인이면 axios 가
   * 응답 없는 오류를 던지고, 엔진이 그것을 "오프라인"으로 다룬다.
   */
  async pullSync(query: SyncDto.PullQuery): Promise<SyncDto.PullResponse> {
    const response = await this.client.get<SyncDto.PullResponse>('/sync/pull', { params: query });
    return response.data;
  }

  /**
   * 오프라인에서 쌓아 둔 명령을 밀어 올린다.
   *
   * 몇 번을 다시 보내도 한 번만 적힌다. 명령마다 붙은 id 와 (기기, 순번) 을 서버가
   * 기억하기 때문이다. 그래서 응답을 못 받았을 때 망설이지 않고 다시 보내면 된다.
   */
  async pushSync(request: PushRequest): Promise<PushResponse> {
    const response = await this.client.post<PushResponse>('/sync/push', request);
    return response.data;
  }

  async getSummary(
    period: ReportPeriod,
    projectId?: string | null,
    filter?: EntryScopeQuery,
  ): Promise<ReportDto.Summary> {
    const response = await this.client.get<ReportDto.Summary>('/reports/summary', {
      params: { ...period, ...(projectId ? { projectId } : {}), ...filter },
    });
    return response.data;
  }

  /**
   * 거래가 있는 달. 전체 기간이라 기간을 넘기지 않는다.
   *
   * 거래 화면의 첫 목록이 쓴다. 응답 길이가 곧 이 가계부가 몇 달치인지라 커서가 없다.
   */
  async getEntryMonths(
    projectId?: string | null,
    filter?: ReportDto.EntryMonthsQuery,
  ): Promise<ReportDto.EntryMonth[]> {
    const response = await this.client.get<ReportDto.EntryMonth[]>('/reports/entry-months', {
      params: { ...(projectId ? { projectId } : {}), ...filter },
    });
    return response.data;
  }

  async getCategoryBreakdown(
    period: ReportPeriod,
    type: 'income' | 'expense',
    projectId?: string | null,
    options?: { rollup?: boolean } & EntryScopeQuery,
  ) {
    const { rollup, ...filter } = options ?? {};
    const response = await this.client.get<any>('/reports/category-breakdown', {
      params: {
        ...period,
        type,
        ...(projectId ? { projectId } : {}),
        ...(rollup === false ? { rollup: false } : {}),
        ...filter,
      },
    });
    return response.data;
  }

  /**
   * 날짜별 지출·수입 (일반/과소비). 그날 아무것도 없으면 행이 없다.
   *
   * 누적 그래프의 재료다. 누적은 화면이 만든다 (이번 달은 오늘까지, 지난달은 말일까지).
   */
  async getDailyExpense(
    period: ReportPeriod,
    type: 'income' | 'expense',
    projectId?: string | null,
    filter?: EntryFilterQuery,
  ): Promise<ReportDto.DailyExpensePoint[]> {
    const response = await this.client.get<ReportDto.DailyExpensePoint[]>(
      '/reports/daily-expense',
      { params: { ...period, type, ...(projectId ? { projectId } : {}), ...filter } },
    );
    return response.data;
  }

  /** 투자·저축 계좌의 누적 수익. 이체로 넣은 원금은 빠져 있다. */
  async getAccountProfit(projectId?: string | null): Promise<ReportDto.AccountProfit[]> {
    const response = await this.client.get<ReportDto.AccountProfit[]>(
      '/reports/account-profit',
      { params: projectId ? { projectId } : {} },
    );
    return response.data;
  }

  async getNetWorth(projectId?: string | null): Promise<ReportDto.NetWorth> {
    const response = await this.client.get<ReportDto.NetWorth>('/reports/net-worth', {
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
      /** target=category일 때 소분류를 빼고 그 분류만 본다 ("미분류" 보기) */
      exact?: boolean;
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
    options: Omit<ReportDto.BalanceHistoryQuery, 'projectId'>,
    projectId?: string | null,
  ): Promise<ReportDto.BalanceHistoryPoint[]> {
    const response = await this.client.get<ReportDto.BalanceHistoryPoint[]>(
      '/reports/balance-history',
      { params: { ...options, ...(projectId ? { projectId } : {}) } },
    );
    return response.data;
  }

  async getPaymentMethods(
    period: ReportPeriod,
    projectId?: string | null,
    filter?: EntryScopeQuery,
  ) {
    const response = await this.client.get<any>('/reports/payment-methods', {
      params: { ...period, ...(projectId ? { projectId } : {}), ...filter },
    });
    return response.data;
  }
}

export const apiClient = new ApiClient();
