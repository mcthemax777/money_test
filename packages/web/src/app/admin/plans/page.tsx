'use client';

/*
 * 이용권 관리. 이용권은 프로젝트(가계부)에 붙는다.
 *
 *   - 위에서 프로젝트를 찾는다. 이름의 일부, 참여 키, id, 소유자 이메일의 일부로 찾고, 빈 칸이면
 *     최근에 만든 것부터 20개를 보인다.
 *   - 고른 프로젝트의 지금 이용권과 권한 줄(결제·지급 기록)을 본다. 거둔 줄도 흐리게 남는다.
 *   - 보상·시험으로 이용권을 준다(금액 0). 평생 이용권이 있는 프로젝트에는 주지 않는다.
 *   - 환불한 것은 거둔다. 뒤에 이어 붙어 있던 기간제는 서버가 앞으로 당긴다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  PLANS,
  type AdminPlanProjectDto,
  type AdminProjectPlanDto,
  type PlanGrantDto,
  type PlanGrantSource,
  type PlanId,
  type ProjectPlanStatus,
} from '@money/types';

import {
  AdminAuthError,
  getProjectPlan,
  grantPlan,
  revokePlanGrant,
  searchPlanProjects,
} from '@/lib/admin-api';

const PLAN_NAME: Record<PlanId, string> = {
  lifetime: '평생',
  month1: '1개월',
  month3: '3개월',
  month6: '6개월',
  month12: '1년',
};

const SOURCE_LABEL: Record<PlanGrantSource, { text: string; className: string }> = {
  admin: { text: '관리자', className: 'bg-gray-100 text-gray-700' },
  google_play: { text: 'Google Play', className: 'bg-green-50 text-green-700' },
  web: { text: '웹 결제', className: 'bg-blue-50 text-blue-700' },
};

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
const date = (iso: string) => new Date(iso).toLocaleDateString('ko-KR');

function StatusBadge({ status }: { status: ProjectPlanStatus }) {
  if (status.kind === 'lifetime') {
    return <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">평생</span>;
  }
  if (status.kind === 'period') {
    return (
      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
        {date(status.endsAt)}까지
      </span>
    );
  }
  return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">무료</span>;
}

export default function AdminPlansPage() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [projects, setProjects] = useState<AdminPlanProjectDto[]>([]);
  const [isSearching, setIsSearching] = useState(true);
  const [selected, setSelected] = useState<AdminPlanProjectDto | null>(null);
  const [detail, setDetail] = useState<AdminProjectPlanDto | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [plan, setPlan] = useState<PlanId>('month1');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  /**
   * 가장 최근에 고른 프로젝트. 빨리 다른 프로젝트를 누르면 앞서 보낸 요청이 늦게 도착해 뒤에
   * 고른 프로젝트의 자리를 덮을 수 있다 -- 도착한 답이 이 값과 다르면 버린다.
   */
  const latestProjectId = useRef<string | null>(null);

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

  const search = useCallback(
    async (text: string) => {
      setIsSearching(true);
      try {
        setProjects(await searchPlanProjects(text.trim()));
      } catch (error) {
        setProjects([]);
        fail(error);
      } finally {
        setIsSearching(false);
      }
    },
    [fail],
  );

  useEffect(() => {
    void search('');
  }, [search]);

  const loadDetail = useCallback(
    async (projectId: string) => {
      latestProjectId.current = projectId;
      setIsLoadingDetail(true);
      try {
        const result = await getProjectPlan(projectId);
        if (latestProjectId.current !== projectId) return;
        setDetail(result);
        // 찾기 목록의 상태 칸도 함께 맞춘다. 지급·거두기 뒤에 목록만 옛 값으로 남지 않게.
        setProjects((previous) =>
          previous.map((row) => (row.id === projectId ? { ...row, plan: result.status } : row)),
        );
      } catch (error) {
        if (latestProjectId.current !== projectId) return;
        setDetail(null);
        fail(error);
      } finally {
        if (latestProjectId.current === projectId) setIsLoadingDetail(false);
      }
    },
    [fail],
  );

  const select = (project: AdminPlanProjectDto) => {
    setSelected(project);
    setDetail(null);
    setMessage(null);
    setNote('');
    void loadDetail(project.id);
  };

  const grant = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    const memo = note.trim();
    if (!window.confirm(`'${selected.name}' 에 ${PLAN_NAME[plan]} 이용권을 줄까요? (금액 0원)`)) return;

    setBusy('grant');
    setMessage(null);
    try {
      const created = await grantPlan(selected.id, plan, memo);
      setMessage({
        kind: 'ok',
        text: created.endsAt
          ? `${PLAN_NAME[plan]} 이용권을 주었습니다 (${date(created.startsAt)} ~ ${date(created.endsAt)}).`
          : '평생 이용권을 주었습니다.',
      });
      setNote('');
      await loadDetail(selected.id);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (grantRow: PlanGrantDto) => {
    if (!selected) return;
    const paid = grantRow.amount > 0 ? `\n${grantRow.amount.toLocaleString('ko-KR')}원 결제 건입니다. 환불은 결제한 곳에서 따로 해야 합니다.` : '';
    const reason = window.prompt(
      `${PLAN_NAME[grantRow.plan]} 이용권을 거둡니다. 까닭을 적어 주세요.${paid}`,
      grantRow.amount > 0 ? '환불' : '',
    );
    if (reason === null) return;
    if (!reason.trim()) {
      setMessage({ kind: 'error', text: '거두는 까닭을 적어 주세요. 나중에 기록을 볼 때 필요합니다.' });
      return;
    }

    setBusy(grantRow.id);
    setMessage(null);
    try {
      await revokePlanGrant(grantRow.id, reason.trim());
      setMessage({ kind: 'ok', text: '거두었습니다. 뒤에 이어 붙어 있던 기간이 있으면 앞으로 당겨졌습니다.' });
      await loadDetail(selected.id);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  };

  const isLifetime = detail?.status.kind === 'lifetime';

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">이용권</h1>
        <p className="mt-1 text-sm text-gray-600">
          프로젝트를 찾아 이용권과 결제·지급 기록을 봅니다. 보상이나 시험으로 주고, 환불한 것은 거둡니다.
        </p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void search(query);
        }}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4"
      >
        <label className="block min-w-[14rem] flex-1">
          <span className="mb-1 block text-xs font-medium text-gray-600">프로젝트 찾기</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="이름, 참여 키, id, 소유자 이메일"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={isSearching}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50"
        >
          {isSearching ? '찾는 중…' : '찾기'}
        </button>
      </form>

      <section className="rounded-xl border border-gray-200 bg-white">
        {isSearching && projects.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">불러오는 중…</p>
        ) : projects.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">맞는 프로젝트가 없습니다.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {projects.map((project) => (
              <li key={project.id}>
                <button
                  type="button"
                  onClick={() => select(project)}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-gray-50 ${
                    selected?.id === project.id ? 'bg-blue-50 hover:bg-blue-50' : ''
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-900">{project.name}</span>
                    <span className="block truncate text-xs text-gray-500">
                      {project.ownerEmail ?? '소유자 없음'}
                      {project.projectKey ? ` · ${project.projectKey}` : ''}
                    </span>
                  </span>
                  <StatusBadge status={project.plan} />
                </button>
              </li>
            ))}
          </ul>
        )}
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

      {selected ? (
        <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-900">{selected.name}</h2>
            {detail ? <StatusBadge status={detail.status} /> : null}
            <span className="ml-auto font-mono text-xs text-gray-400">{selected.id}</span>
          </div>

          <form onSubmit={grant} className="flex flex-wrap items-end gap-3 rounded-lg bg-gray-50 p-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">이용권</span>
              <select
                value={plan}
                onChange={(event) => setPlan(event.target.value as PlanId)}
                disabled={isLifetime}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:opacity-50"
              >
                {PLANS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {PLAN_NAME[option.id]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-[12rem] flex-1">
              <span className="mb-1 block text-xs font-medium text-gray-600">메모 (왜 주는가)</span>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                disabled={isLifetime}
                placeholder="예: 결제 오류 보상"
                maxLength={200}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:opacity-50"
              />
            </label>
            <button
              type="submit"
              disabled={busy !== null || !detail || isLifetime}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50"
            >
              {busy === 'grant' ? '주는 중…' : '이용권 주기'}
            </button>
            <p className="w-full text-xs text-gray-500">
              {isLifetime
                ? '이미 평생 이용권이 있어 더 줄 수 없습니다.'
                : '기간제는 지금 이어지는 기간이 끝나는 날부터 시작합니다. 금액은 0원으로 적힙니다.'}
            </p>
          </form>

          {isLoadingDetail && !detail ? (
            <p className="text-sm text-gray-500">불러오는 중…</p>
          ) : detail && detail.grants.length === 0 ? (
            <p className="text-sm text-gray-500">결제·지급 기록이 없습니다.</p>
          ) : detail ? (
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
              {detail.grants.map((row) => {
                const revoked = row.revokedAt !== null;
                return (
                  <li key={row.id} className={`flex flex-wrap items-center gap-3 px-3 py-2.5 ${revoked ? 'opacity-50' : ''}`}>
                    <span className="w-14 shrink-0 text-sm font-medium text-gray-900">{PLAN_NAME[row.plan]}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${SOURCE_LABEL[row.source].className}`}
                    >
                      {SOURCE_LABEL[row.source].text}
                    </span>
                    <span className="min-w-0 flex-1 text-sm text-gray-700">
                      <span className={revoked ? 'line-through' : ''}>
                        {date(row.startsAt)} ~ {row.endsAt ? date(row.endsAt) : '평생'}
                      </span>
                      <span className="block text-xs text-gray-500">
                        {row.amount.toLocaleString('ko-KR')}원 · {dateTime(row.createdAt)}
                        {row.externalId ? ` · ${row.externalId}` : ''}
                        {row.note ? ` · ${row.note}` : ''}
                      </span>
                      {revoked ? (
                        <span className="block text-xs text-red-600">
                          {dateTime(row.revokedAt!)} 거둠{row.revokeReason ? ` · ${row.revokeReason}` : ''}
                        </span>
                      ) : null}
                    </span>
                    {revoked ? null : (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void revoke(row)}
                        className="rounded-lg px-2 py-1 text-xs text-red-600 transition-colors hover:bg-red-50 active:bg-red-100 disabled:opacity-50"
                      >
                        {busy === row.id ? '거두는 중…' : '거두기'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
