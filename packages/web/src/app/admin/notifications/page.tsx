'use client';

/*
 * 알림 원문. 기기가 모은 다른 금융 앱의 알림을 앱별로 본다.
 *
 * 한 표본마다 두 결과를 나란히 둔다 -- 기기가 **그때** 읽은 것(표본과 함께 올라온 값)과,
 * 이 브라우저가 **지금** 파서와 켜 둔 규칙으로 다시 읽은 것. 파서나 규칙을 고친 뒤 무엇이
 * 달라졌는지가 여기서 보인다. 다시 읽기는 기기와 같은 코드(`@money/core` 의
 * `notification-rule`)라 기기에서도 그렇게 읽힌다.
 *
 * 시각은 이 브라우저의 시간대로 읽는다. 기기와 시간대가 다르면 시각 칸이 다르게 보일 수 있다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { NotificationRule, NotificationSampleDto } from '@money/types';
import { parseNotificationWithRules, sampleParsedOf } from '@money/core/lib/notification-rule';

import {
  AdminAuthError,
  listNotificationRules,
  listNotificationSamplePackages,
  listNotificationSamples,
  removeNotificationSample,
} from '@/lib/admin-api';
import { changedRows, errorText, inputOf, ParsedTable } from '../notification-view';

type ParsedFilter = '' | 'yes' | 'no';

const PAGE = 50;

export default function AdminNotificationsPage() {
  const router = useRouter();
  const [packages, setPackages] = useState<NotificationSampleDto.PackageSummary[]>([]);
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [packageName, setPackageName] = useState('');
  const [parsed, setParsed] = useState<ParsedFilter>('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [samples, setSamples] = useState<NotificationSampleDto.Response[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [changedOnly, setChangedOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback(
    (reason: unknown) => {
      if (reason instanceof AdminAuthError) router.replace('/admin/login');
      else setError(errorText(reason));
    },
    [router],
  );

  useEffect(() => {
    Promise.all([listNotificationSamplePackages(), listNotificationRules()])
      .then(([rows, allRules]) => {
        setPackages(rows);
        setRules(allRules);
      })
      .catch(fail);
  }, [fail]);

  const load = useCallback(
    async (cursor: string | null) => {
      setIsLoading(true);
      setError(null);
      try {
        const page = await listNotificationSamples({
          packageName: packageName || undefined,
          parsed: parsed || undefined,
          q: search || undefined,
          cursor: cursor ?? undefined,
          limit: PAGE,
        });
        setSamples((previous) => (cursor ? [...previous, ...page.samples] : page.samples));
        setNextCursor(page.nextCursor);
      } catch (reason) {
        fail(reason);
      } finally {
        setIsLoading(false);
      }
    },
    [packageName, parsed, search, fail],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  /** 표본마다 지금 다시 읽은 결과와 달라진 칸. 켜 둔 규칙만 기기가 쓰므로 그것만 댄다. */
  const rows = useMemo(() => {
    const enabled = rules.filter((rule) => rule.enabled);
    return samples.map((sample) => {
      const now = sampleParsedOf(parseNotificationWithRules(inputOf(sample), enabled));
      return { sample, now, changed: changedRows(sample.parsed, now) };
    });
  }, [samples, rules]);

  const changedCount = rows.filter((row) => row.changed.length > 0).length;
  const shown = changedOnly ? rows.filter((row) => row.changed.length > 0) : rows;

  const remove = async (id: string) => {
    if (!window.confirm('이 원문을 지울까요? 되돌릴 수 없습니다.')) return;
    try {
      await removeNotificationSample(id);
      setSamples((previous) => previous.filter((sample) => sample.id !== id));
    } catch (reason) {
      fail(reason);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">알림 원문</h1>
        <p className="mt-1 text-sm text-gray-600">
          기기가 모은 다른 금융 앱의 알림입니다. 금액과 통화 표기가 있는 알림은 후보가 되지 못했어도
          담깁니다. 오른쪽 열은 지금의 파서와 켜 둔 규칙으로 이 브라우저에서 다시 읽은 결과이고,
          그때와 다른 칸은 노랗게 칠합니다.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 bg-white p-3">
        <label className="block min-w-0 flex-1">
          <span className="mb-1 block text-xs font-medium text-gray-600">앱</span>
          <select
            value={packageName}
            onChange={(event) => setPackageName(event.target.value)}
            className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
          >
            <option value="">모든 앱</option>
            {packages.map((row) => (
              <option key={row.packageName} value={row.packageName}>
                {row.packageName} — {row.count}건 (읽힘 {row.parsedCount}, 규칙 {row.ruleCount})
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">기기가 읽었나</span>
          <select
            value={parsed}
            onChange={(event) => setParsed(event.target.value as ParsedFilter)}
            className="rounded-lg border border-gray-300 px-2 py-2 text-sm"
          >
            <option value="">전체</option>
            <option value="yes">거래로 읽음</option>
            <option value="no">못 읽음</option>
          </select>
        </label>
        <form
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(query.trim());
          }}
        >
          <label className="block min-w-0 flex-1">
            <span className="mb-1 block text-xs font-medium text-gray-600">글 찾기</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="승인, 스타벅스 …"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            className="self-end rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 active:bg-gray-100"
          >
            찾기
          </button>
        </form>
      </div>

      {error ? <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-gray-600">
          불러온 {samples.length}건 가운데 지금 다시 읽으면 달라지는 것 {changedCount}건
        </span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-gray-700">
            <input
              type="checkbox"
              checked={changedOnly}
              onChange={(event) => setChangedOnly(event.target.checked)}
            />
            달라진 것만
          </label>
          {packageName ? (
            <Link
              href={`/admin/notification-rules?package=${encodeURIComponent(packageName)}`}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-white transition-colors hover:bg-blue-700"
            >
              이 앱의 규칙 만들기
            </Link>
          ) : null}
        </div>
      </div>

      <div className="space-y-3">
        {shown.map(({ sample, now, changed }) => (
          <article key={sample.id} className="unfold space-y-3 rounded-xl border border-gray-200 bg-white p-4">
            <header className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-gray-500">
              <button
                type="button"
                onClick={() => setPackageName(sample.packageName)}
                className="font-mono text-gray-700 transition-colors hover:text-blue-700"
                title="이 앱만 보기"
              >
                {sample.packageName}
              </button>
              <span>
                {new Date(sample.postedAt).toLocaleString()}
                {sample.userName ? ` · ${sample.userName}` : ''}
                {sample.deviceName ? ` · ${sample.deviceName}` : ''}
                {sample.appVersion ? ` · 앱 ${sample.appVersion}` : ''}
              </span>
            </header>
            <div className="rounded-lg bg-gray-50 p-3 text-sm">
              {sample.title ? <p className="font-medium text-gray-900">{sample.title}</p> : null}
              <p className="whitespace-pre-wrap break-words text-gray-800">{sample.text}</p>
            </div>
            <ParsedTable parsed={sample.parsed} compare={now} />
            <footer className="flex items-center justify-between text-xs">
              <span className={changed.length ? 'text-amber-700' : 'text-gray-400'}>
                {changed.length ? `달라진 칸: ${changed.join(', ')}` : '그때와 같음'}
              </span>
              <button
                type="button"
                onClick={() => void remove(sample.id)}
                className="rounded px-2 py-1 text-red-600 transition-colors hover:bg-red-50"
              >
                지우기
              </button>
            </footer>
          </article>
        ))}
      </div>

      {isLoading ? <p className="text-sm text-gray-500">불러오는 중...</p> : null}
      {!isLoading && samples.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          아직 모인 원문이 없습니다. 앱에서 알림 접근을 켠 기기에 금융 알림이 오면 여기에 쌓입니다.
        </p>
      ) : null}
      {nextCursor && !isLoading ? (
        <button
          type="button"
          onClick={() => void load(nextCursor)}
          className="w-full rounded-lg border border-gray-300 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 active:bg-gray-100"
        >
          더 보기
        </button>
      ) : null}
    </div>
  );
}
