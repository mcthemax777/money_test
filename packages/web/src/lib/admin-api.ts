/**
 * 관리 도구(`/admin`)가 서버를 부르는 자리.
 *
 * 사용자 API 창구(`apiClient`)와 섞지 않는다. 토큰이 다르고(관리자 토큰), 401 을 받았을 때
 * 할 일도 다르다(관리 도구 로그인으로 보낸다). 서버 주소만 같은 것을 쓴다.
 *
 * 토큰은 sessionStorage 에 둔다 -- 탭을 닫으면 사라진다. 관리 도구는 잠깐 열어 쓰는 곳이다.
 */
import type { HolidayCountry } from '@money/types';
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
