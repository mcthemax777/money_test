/**
 * 관리 도구(`/admin`)가 서버를 부르는 자리.
 *
 * 사용자 API 창구(`apiClient`)와 섞지 않는다. 토큰이 다르고(관리자 토큰), 401 을 받았을 때
 * 할 일도 다르다(관리 도구 로그인으로 보낸다). 서버 주소만 같은 것을 쓴다.
 *
 * 토큰은 sessionStorage 에 둔다 -- 탭을 닫으면 사라진다. 관리 도구는 잠깐 열어 쓰는 곳이다.
 */
import type {
  AdminPlanProjectDto,
  AdminProjectPlanDto,
  AppPlatform,
  AppVersionPolicy,
  AppVersionPolicyUpdate,
  HolidayCountry,
  InquiryDto,
  InquiryStatus,
  NotificationRule,
  NotificationRuleDto,
  NotificationSampleDto,
  PlanGrantDto,
  PlanId,
} from '@money/types';
import { apiClient } from '@money/core/lib/api-client';

const TOKEN_KEY = 'money-admin-token';

export class AdminAuthError extends Error {}

export function getAdminToken(): string | null {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setAdminToken(token: string | null): void {
  try {
    if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // 사이트 데이터가 막혀 있으면 로그인이 이 페이지에서만 산다.
  }
}

/** 서버를 부른다. 401 이면 토큰을 버리고 `AdminAuthError` 를 던진다. */
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getAdminToken();
  const response = await fetch(`${apiClient.baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (response.ok) return data as T;

  const message: string = data?.error?.message ?? `요청이 실패했습니다 (${response.status}).`;
  if (response.status === 401 && path !== '/admin/login') {
    setAdminToken(null);
    throw new AdminAuthError(message);
  }
  throw new Error(message);
}

export async function adminLogin(username: string, password: string): Promise<void> {
  const { token } = await call<{ token: string }>('POST', '/admin/login', { username, password });
  setAdminToken(token);
}

export function adminLogout(): void {
  setAdminToken(null);
}

export const adminMe = () => call<{ username: string }>('GET', '/admin/me');

export interface AdminHoliday {
  country: HolidayCountry;
  date: string;
  name: string;
  source: 'gazette' | 'library' | 'manual';
}

export interface HolidaySyncResult {
  country: HolidayCountry;
  years: Array<{ year: number; source: 'gazette' | 'library'; count: number }>;
  warnings: string[];
}

export const listHolidays = (country: HolidayCountry, year: number) =>
  call<AdminHoliday[]>('GET', `/admin/holidays?country=${country}&year=${year}`);

export const syncHolidays = (country?: HolidayCountry) =>
  call<HolidaySyncResult[]>('POST', '/admin/holidays/sync', country ? { country } : {});

export const addHoliday = (country: HolidayCountry, date: string, name: string) =>
  call<void>('POST', '/admin/holidays', { country, date, name });

export const removeHoliday = (country: HolidayCountry, date: string) =>
  call<void>('DELETE', `/admin/holidays/${country}/${date}`);

export const listAppVersions = () => call<AppVersionPolicy[]>('GET', '/admin/app-versions');

export const updateAppVersion = (platform: AppPlatform, body: AppVersionPolicyUpdate) =>
  call<AppVersionPolicy>('PUT', `/admin/app-versions/${platform}`, body);

export function listNotificationSamples(query: NotificationSampleDto.ListQuery) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  return call<NotificationSampleDto.ListResponse>('GET', `/admin/notification-samples?${params.toString()}`);
}

export const listNotificationSamplePackages = () =>
  call<NotificationSampleDto.PackageSummary[]>('GET', '/admin/notification-samples/packages');

export const removeNotificationSample = (id: string) =>
  call<void>('DELETE', `/admin/notification-samples/${encodeURIComponent(id)}`);

export const listNotificationRules = (packageName?: string) =>
  call<NotificationRule[]>(
    'GET',
    `/admin/notification-rules${packageName ? `?packageName=${encodeURIComponent(packageName)}` : ''}`,
  );

export const createNotificationRule = (body: NotificationRuleDto.SaveRequest) =>
  call<NotificationRule>('POST', '/admin/notification-rules', body);

export const updateNotificationRule = (id: string, body: Partial<NotificationRuleDto.SaveRequest>) =>
  call<NotificationRule>('PUT', `/admin/notification-rules/${encodeURIComponent(id)}`, body);

export const removeNotificationRule = (id: string) =>
  call<void>('DELETE', `/admin/notification-rules/${encodeURIComponent(id)}`);

export const listInquiries = (status?: InquiryStatus) =>
  call<InquiryDto.AdminSummary[]>('GET', `/admin/inquiries${status ? `?status=${status}` : ''}`);

export const getInquiry = (id: string) =>
  call<InquiryDto.AdminDetail>('GET', `/admin/inquiries/${encodeURIComponent(id)}`);

/** 답장. 그 사용자의 기기로 푸시가 간다. */
export const searchUsers = (query: string) =>
  call<InquiryDto.AdminUser[]>('GET', `/admin/users?q=${encodeURIComponent(query)}`);

/** 사용자가 묻지 않았어도 먼저 보낸다. */
export const startInquiry = (userId: string, body: string) =>
  call<InquiryDto.AdminDetail>('POST', '/admin/inquiries', { userId, body });

export const replyInquiry = (id: string, body: string) =>
  call<InquiryDto.AdminDetail>('POST', `/admin/inquiries/${encodeURIComponent(id)}/replies`, { body });

/** 이용권을 줄 프로젝트 찾기. 이름·참여 키·id·소유자 이메일. 빈 말이면 최근 것부터. */
export const searchPlanProjects = (query: string) =>
  call<AdminPlanProjectDto[]>('GET', `/admin/projects?q=${encodeURIComponent(query)}`);

export const getProjectPlan = (projectId: string) =>
  call<AdminProjectPlanDto>('GET', `/admin/projects/${encodeURIComponent(projectId)}/plan`);

/** 관리자 지급. 금액은 0 으로 적힌다. 평생 이용권이 있는 프로젝트는 서버가 막는다. */
export const grantPlan = (projectId: string, plan: PlanId, note: string) =>
  call<PlanGrantDto>('POST', `/admin/projects/${encodeURIComponent(projectId)}/plan-grants`, { plan, note });

/** 권한 거두기. 뒤에 이어 붙어 있던 기간제는 서버가 앞으로 당긴다. */
export const revokePlanGrant = (grantId: string, reason: string) =>
  call<PlanGrantDto>('POST', `/admin/plan-grants/${encodeURIComponent(grantId)}/revoke`, { reason });
