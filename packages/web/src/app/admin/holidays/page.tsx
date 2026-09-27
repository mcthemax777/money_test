'use client';

/*
 * 공휴일 관리. 반복 등록의 "휴일 제외"·"휴일이면 앞/뒤 평일"이 이 목록을 쓴다.
 *
 *   - 새 연도의 공휴일이 발표되면(한국은 대개 6월 월력요항) "갱신"을 누른다. 한국은 관보 기준
 *     공개 데이터, 다른 나라는 서버의 date-holidays 에서 받는다.
 *   - 임시공휴일처럼 급히 정해진 날은 아래에서 직접 더한다. 갱신이 그 줄은 지우지 않는다.
 *
 * 가계부의 나라는 시간대로 정해진다(서울·UTC 한국, 도쿄 일본, 상하이 중국, 싱가포르,
 * 런던 영국, 뉴욕·LA 미국).
 */
import { useCallback, useEffect, useState } from 'react';
import { HOLIDAY_COUNTRIES, weekdayOf, type HolidayCountry } from '@money/types';

import {
  AdminAuthError,
  addHoliday,
  listHolidays,
  removeHoliday,
  syncHolidays,
  type AdminHoliday,
  type HolidaySyncResult,
} from '@/lib/admin-api';
import { useRouter } from 'next/navigation';

const COUNTRY_NAME: Record<HolidayCountry, string> = {
  KR: '한국',
  JP: '일본',
  CN: '중국',
  SG: '싱가포르',
  GB: '영국(잉글랜드)',
  US: '미국',
};

const SOURCE_LABEL: Record<AdminHoliday['source'], { text: string; className: string }> = {
  gazette: { text: '관보', className: 'bg-green-50 text-green-700' },
  library: { text: '어림', className: 'bg-amber-50 text-amber-700' },
  manual: { text: '직접', className: 'bg-blue-50 text-blue-700' },
};

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

export default function AdminHolidaysPage() {
  const router = useRouter();
  const thisYear = new Date().getFullYear();
  const [country, setCountry] = useState<HolidayCountry>('KR');
  const [year, setYear] = useState(thisYear);
  const [rows, setRows] = useState<AdminHoliday[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState<'sync' | 'syncAll' | 'add' | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [syncResults, setSyncResults] = useState<HolidaySyncResult[] | null>(null);
  const [newDate, setNewDate] = useState('');
  const [newName, setNewName] = useState('');

  /** 오류를 알린다. 관리자 토큰이 끝났으면 로그인으로 보낸다. */
  const fail = useCallback(
    (error: unknown) => {
      if (error instanceof AdminAuthError) {
        router.replace('/admin/login');
        return;
      }
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    },
    [router],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setRows(await listHolidays(country, year));
    } catch (error) {
      setRows([]);
      fail(error);
    } finally {
      setIsLoading(false);
    }
  }, [country, year, fail]);

  useEffect(() => {
    void load();
  }, [load]);

  const sync = async (all: boolean) => {
    setBusy(all ? 'syncAll' : 'sync');
    setMessage(null);
    try {
      const results = await syncHolidays(all ? undefined : country);
      setSyncResults(results);
      const warnings = results.flatMap((result) => result.warnings);
      setMessage(
        warnings.length > 0
          ? { kind: 'error', text: `갱신했지만 일부는 받지 못했습니다: ${warnings.join(' / ')}` }
          : { kind: 'ok', text: `${all ? '모든 나라' : COUNTRY_NAME[country]} 공휴일을 갱신했습니다.` },
      );
      await load();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  };

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy('add');
    setMessage(null);
    try {
      await addHoliday(country, newDate, newName.trim());
      setMessage({ kind: 'ok', text: `${newDate} ${newName.trim()} 을(를) 더했습니다.` });
      setNewDate('');
      setNewName('');
      if (newDate.startsWith(`${year}-`)) await load();
      else setYear(Number(newDate.slice(0, 4)));
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (row: AdminHoliday) => {
    const note =
      row.source === 'manual' ? '' : '\n관보·어림에서 온 날은 다음 갱신 때 다시 들어옵니다.';
    if (!window.confirm(`${row.date} ${row.name} 을(를) 지울까요?${note}`)) return;
    try {
      await removeHoliday(row.country, row.date);
      setRows((previous) => previous.filter((item) => item.date !== row.date));
    } catch (error) {
      fail(error);
    }
  };

  const countrySync = syncResults?.find((result) => result.country === country);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">공휴일</h1>
        <p className="mt-1 text-sm text-gray-600">
          새 연도의 공휴일이 발표되면 갱신을 누릅니다. 임시공휴일은 아래에서 직접 더합니다.
        </p>
      </div>

      <section className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">나라</span>
          <select
            value={country}
            onChange={(event) => setCountry(event.target.value as HolidayCountry)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            {HOLIDAY_COUNTRIES.map((code) => (
              <option key={code} value={code}>
                {COUNTRY_NAME[code]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">연도</span>
          <select
            value={year}
            onChange={(event) => setYear(Number(event.target.value))}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            {Array.from({ length: 7 }, (_, index) => thisYear - 1 + index).map((option) => (
              <option key={option} value={option}>
                {option}년
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void sync(false)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50"
          >
            {busy === 'sync' ? '갱신 중…' : `${COUNTRY_NAME[country]} 갱신`}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void sync(true)}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 active:bg-gray-100 disabled:opacity-50"
          >
            {busy === 'syncAll' ? '갱신 중…' : '모든 나라 갱신'}
          </button>
        </div>
      </section>

      {message ? (
        <p
          className={`rounded-lg p-3 text-sm ${
            message.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
          }`}
        >
          {message.text}
        </p>
      ) : null}

      {countrySync ? (
        <p className="text-xs text-gray-500">
          방금 갱신:{' '}
          {countrySync.years
            .map((item) => `${item.year}년 ${item.count}건(${SOURCE_LABEL[item.source].text})`)
            .join(', ')}
        </p>
      ) : null}

      <section className="rounded-xl border border-gray-200 bg-white">
        {isLoading ? (
          <p className="p-4 text-sm text-gray-500">불러오는 중…</p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">
            {year}년 {COUNTRY_NAME[country]} 공휴일이 없습니다. 갱신을 눌러 받아 오세요.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((row) => (
              <li key={row.date} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-36 shrink-0 whitespace-nowrap font-mono text-sm text-gray-800">
                  {row.date} ({WEEKDAY[weekdayOf(row.date)]})
                </span>
                <span className="flex-1 text-sm text-gray-900">{row.name}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${SOURCE_LABEL[row.source].className}`}
                >
                  {SOURCE_LABEL[row.source].text}
                </span>
                <button
                  type="button"
                  onClick={() => void remove(row)}
                  className="rounded-lg px-2 py-1 text-xs text-red-600 transition-colors hover:bg-red-50 active:bg-red-100"
                >
                  지우기
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {rows.some((row) => row.source === 'library') ? (
        <p className="text-xs text-amber-700">
          어림: 아직 관보가 발표되지 않아 date-holidays 로 채운 값입니다. 대체공휴일이 빠져 있을 수
          있으니 발표 뒤 다시 갱신하세요.
        </p>
      ) : null}

      <form
        onSubmit={add}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4"
      >
        <p className="w-full text-sm font-medium text-gray-800">
          {COUNTRY_NAME[country]} 공휴일 직접 더하기
        </p>
        <label className="block w-full sm:w-auto">
          <span className="mb-1 block text-xs font-medium text-gray-600">날짜</span>
          <input
            type="date"
            value={newDate}
            onChange={(event) => setNewDate(event.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block min-w-[12rem] flex-1">
          <span className="mb-1 block text-xs font-medium text-gray-600">이름</span>
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="예: 임시공휴일"
            maxLength={100}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={busy !== null || !newDate || !newName.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50"
        >
          {busy === 'add' ? '더하는 중…' : '더하기'}
        </button>
      </form>
    </div>
  );
}
