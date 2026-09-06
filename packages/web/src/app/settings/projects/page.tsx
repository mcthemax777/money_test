'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@money/core/store/auth';
import { useMirrorVersion } from '@money/core/hooks/useMirrorVersion';
import { useProjectAdmin } from '@money/core/hooks/useProjectAdmin';
import {
  useProjectMembership,
  type MemberRow,
  type ProjectSearchResult,
} from '@money/core/hooks/useProjectMembership';
import type { Project } from '@money/core/store/project';
import { DEFAULT_TIME_ZONE, SUPPORTED_CURRENCIES, type CurrencyCode } from '@money/types';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { currencyLabel } from '@money/core/lib/money';
import { TIME_ZONE_OPTIONS } from '@money/core/lib/time-zones';
import PageHeader from '@/components/PageHeader';

/**
 * 프로젝트 관리 화면.
 *
 * 서버를 부르는 규칙은 훅 둘에 있다. 프로젝트 자체(만들기·이름·타임존·표시 통화·삭제)는
 * `useProjectAdmin`, 그 프로젝트에 누가 들어오고 나가는가(초대·가입 요청·멤버·"나")는
 * `useProjectMembership` 이다. 앱의 프로젝트 관리 화면도 같은 훅을 쓴다 -- 승인·강퇴처럼
 * 되돌리기 어려운 일이 화면마다 다르게 움직이지 않도록.
 *
 * 여기 남은 것은 웹에만 있는 것뿐이다. 클립보드 복사, 알림창, 그리고 떠난 프로젝트를
 * 보고 있었을 때 남은 것 하나를 대신 고르는 일이다.
 */
export default function ProjectsPage() {
  const { t, tag } = useTranslation();
  const router = useRouter();
  const { isAuthenticated, isInitializing } = useAuth();
  const admin = useProjectAdmin();
  const membership = useProjectMembership();
  const mirrorVersion = useMirrorVersion();

  const [error, setError] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', description: '' });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  /** 이름·설명을 고치는 중인 프로젝트와 입력값. 한 번에 하나만 고친다. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '' });
  /** 기준통화 환산이 도는 동안 그 프로젝트의 선택을 잠근다. */
  const [rebasingId, setRebasingId] = useState<string | null>(null);

  // 가입 요청 관련 상태
  const [showJoinForm, setShowJoinForm] = useState(false);
  const [joinForm, setJoinForm] = useState({ key: '', message: '' });
  const [searchResult, setSearchResult] = useState<ProjectSearchResult | null>(null);
  const [searchError, setSearchError] = useState('');
  const [inviteRoleByProject, setInviteRoleByProject] = useState<Record<string, 'editor' | 'viewer'>>({});
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!isInitializing && !isAuthenticated) {
      router.push('/login');
    }
  }, [isInitializing, isAuthenticated, router]);

  useEffect(() => {
    loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * 멤버·초대·요청은 프로젝트 목록이 정해진 뒤에 받는다. id 를 이어 붙인 것을 보는 이유는,
   * 목록을 다시 받을 때마다 배열이 새로 만들어져도 내용이 같으면 다시 묻지 않기 위해서다.
   */
  const projectIds = admin.projects.map((project) => project.id).join(',');
  useEffect(() => {
    if (admin.projects.length > 0) membership.load(admin.projects);
    // 남이 멤버를 넣고 빼거나 가입 요청을 보낸 것도 이 자리에서 따라온다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectIds, mirrorVersion]);

  const loadProjects = async () => {
    const result = await admin.reload();
    setError(result.ok ? '' : result.message);
  };

  /** 멤버·초대·요청만 다시 받는다. 프로젝트 목록 자체는 그대로다. */
  const reloadMembership = () => membership.load(admin.projects);

  /** 손질 하나. 실패하면 이유를 적고, 성공하면 지운다. */
  const run = async (task: Promise<{ ok: boolean; message?: string }>) => {
    const result = await task;
    setError(result.ok ? '' : result.message ?? '');
    return result.ok;
  };

  const startEdit = (project: Project) => {
    setEditingId(project.id);
    setEditForm({ name: project.name, description: project.description ?? '' });
    setError('');
  };

  const handleSaveProject = async (projectId: string) => {
    const name = editForm.name.trim();
    if (!name) {
      setError(t('projects.nameRequired'));
      return;
    }

    // 설명은 비워서 지울 수 있다. 서버가 빈 값을 null로 바꿔 저장한다.
    if (await run(admin.update(projectId, { name, description: editForm.description }))) {
      setEditingId(null);
    }
  };

  const handleChangeTimeZone = (projectId: string, timezone: string) =>
    run(admin.update(projectId, { timezone }, 'projects.timezoneFailed'));

  /**
   * 표시 통화 변경.
   *
   * 저장된 값은 하나도 바뀌지 않는다. 서버가 읽을 때만 환율을 곱해 보여 주므로
   * 몇 번을 오가도 원본이 그대로다. 확인 창을 띄우지 않는 이유도 그래서다.
   */
  const handleChangeDisplayCurrency = async (project: Project, next: string) => {
    if (next === (project.displayCurrency || project.ledgerCurrency || 'KRW')) return;

    setRebasingId(project.id);
    await run(
      admin.update(project.id, { displayCurrency: next as CurrencyCode }, 'projects.currencyFailed'),
    );
    setRebasingId(null);
  };

  const handleCreateProject = async () => {
    /*
     * 첫 프로젝트라면 훅이 방금 만든 것을 바로 고른다. 그때는 화면이 곧 그 프로젝트를
     * 보여 주므로 알림창을 띄우지 않는다.
     */
    const isFirstProject = !admin.selectedProjectId;
    if (!(await run(admin.create(createForm.name, createForm.description)))) return;

    setCreateForm({ name: '', description: '' });
    setShowCreateForm(false);
    if (!isFirstProject) alert(t('projects.created'));
  };

  /**
   * 떠난 프로젝트를 보고 있었으면 남은 것 하나를 대신 고른다.
   *
   * 훅은 고른 것을 비우기만 한다 (없는 프로젝트를 계속 조회하지 않으려고). 웹은 왼쪽 메뉴가
   * 늘 한 프로젝트를 가리키므로, 비워 두면 다음 화면이 통째로 빈 채 남는다.
   *
   * 지우기 **전에** 불러 다음 것을 정해 둔다. 지운 뒤에는 이 목록이 낡는다.
   */
  const pickNextProject = (goneProjectId: string) => {
    const wasSelected = admin.selectedProjectId === goneProjectId;
    const next = admin.projects.find((project) => project.id !== goneProjectId);

    return () => {
      if (wasSelected && next) admin.select(next.id);
    };
  };

  const handleLeaveProject = async (projectId: string) => {
    if (!confirm(t('projects.leaveConfirm'))) {
      return;
    }

    const selectNext = pickNextProject(projectId);
    if (!(await run(admin.removeOrLeave(projectId, 'leave')))) return;

    setDeleteConfirm(null);
    selectNext();
    alert(t('projects.left'));
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!confirm(t('projects.deleteConfirm'))) {
      return;
    }

    const selectNext = pickNextProject(projectId);
    if (!(await run(admin.removeOrLeave(projectId, 'delete')))) return;

    setDeleteConfirm(null);
    selectNext();
    alert(t('projects.deleted'));
  };

  /** "나"는 프로젝트 목록에 붙어 오는 값이라, 바꾼 뒤 목록을 다시 받아야 화면이 따라온다. */
  const handleChangeMyPerson = async (projectId: string, personId: string) => {
    if (await run(membership.setMyPerson(projectId, personId || null))) await loadProjects();
  };

  const buildInviteUrl = (invitationCode: string) =>
    `${window.location.origin}/join?code=${invitationCode}`;

  const handleGenerateInviteLink = async (projectId: string) => {
    const role = inviteRoleByProject[projectId] ?? 'editor';
    const result = await membership.createInvitation(projectId, role);
    setError(result.ok ? '' : result.message);
    if (!result.ok) return;

    await reloadMembership();

    // 만든 직후 바로 공유할 수 있도록 클립보드에 담는다.
    if (result.value?.invitationCode) {
      await handleCopyInviteLink(result.value.invitationCode);
    }
  };

  const handleCopyInviteLink = async (invitationCode: string) => {
    try {
      await navigator.clipboard.writeText(buildInviteUrl(invitationCode));
      setCopiedCode(invitationCode);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch {
      setError(t('projects.copyLinkFailed'));
    }
  };

  const handleRevokeInvitation = async (invitationId: string) => {
    if (!confirm(t('projects.revokeConfirm'))) {
      return;
    }

    if (await run(membership.revokeInvitation(invitationId))) await reloadMembership();
  };

  const handleRemoveMember = async (projectId: string, member: MemberRow) => {
    if (!confirm(t('projects.kickConfirm', { name: member.name }))) return;

    if (await run(membership.removeMember(projectId, member.id))) await reloadMembership();
  };

  const handleSearchProject = async () => {
    const result = await membership.searchByKey(joinForm.key);
    if (!result.ok) {
      setSearchResult(null);
      setSearchError(result.message);
      return;
    }

    setSearchError('');
    setSearchResult(result.value ?? null);
  };

  const handleRequestJoin = async () => {
    if (!searchResult) return;

    const result = await membership.requestToJoin(searchResult.id, joinForm.message);
    if (!result.ok) {
      setSearchError(result.message);
      return;
    }

    setSearchResult({ ...searchResult, myRequestStatus: 'pending' });
    setJoinForm({ key: '', message: '' });
    setSearchError('');
    await reloadMembership();
    alert(t('projects.requestSent'));
  };

  const handleApproveRequest = async (requestId: string, role: 'editor' | 'viewer') => {
    const result = await membership.approveRequest(requestId, role);
    setError(result.ok ? '' : result.message);
    if (!result.ok) return;

    await reloadMembership();
    alert(t('projects.approved', { name: result.value?.userName ?? '' }));
  };

  const handleRejectRequest = async (requestId: string) => {
    if (!confirm(t('projects.rejectConfirm'))) return;

    if (await run(membership.rejectRequest(requestId))) await reloadMembership();
  };

  const handleCancelMyRequest = async (requestId: string) => {
    if (!confirm(t('projects.cancelRequestConfirm'))) return;

    if (await run(membership.cancelMyRequest(requestId))) await reloadMembership();
  };

  const handleCopyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      setError(t('projects.copyKeyFailed'));
    }
  };

  const getRoleLabel = (role: string) => {
    const keys: Record<string, MessageKey> = {
      owner: 'role.owner',
      editor: 'role.editor',
      viewer: 'role.viewer',
    };
    const key = keys[role];
    return key ? t(key) : role;
  };

  if (isInitializing || !isAuthenticated) {
    return (
      <div className="flex justify-center items-center h-screen">{t('shell.signingIn')}</div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('settings.projects.title')}
        backHref="/settings"
        action={
          <>
            <button
              onClick={() => setShowJoinForm((prev) => !prev)}
              className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition"
            >
              {t('projects.join')}
            </button>
            <button
              onClick={() => setShowCreateForm(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              {t('projects.create')}
            </button>
          </>
        }
      />

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* 프로젝트 생성 폼 */}
      {showCreateForm && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('projects.create')}</h2>
          <div className="space-y-4">
            <input
              type="text"
              placeholder={t('projects.namePlaceholder')}
              value={createForm.name}
              onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <textarea
              placeholder={t('projects.descriptionPlaceholder')}
              value={createForm.description}
              onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex gap-2">
              <button
                onClick={handleCreateProject}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
              >
                {t('projects.createSubmit')}
              </button>
              <button
                onClick={() => {
                  setShowCreateForm(false);
                  setCreateForm({ name: '', description: '' });
                }}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 프로젝트 참여 (키 검색 -> 가입 요청) */}
      {showJoinForm && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{t('projects.join')}</h2>
            <p className="text-sm text-gray-600 mt-1">
              {t('projects.joinHint')}
            </p>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              placeholder={t('projects.keyPlaceholder')}
              value={joinForm.key}
              onChange={(e) => setJoinForm({ ...joinForm, key: e.target.value.toUpperCase() })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSearchProject();
              }}
              maxLength={8}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg font-mono tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleSearchProject}
              disabled={membership.isSubmitting}
              className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 disabled:opacity-50 transition"
            >
              {membership.isSubmitting ? t('projects.searching') : t('projects.search')}
            </button>
          </div>

          {searchError && (
            <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm">
              {searchError}
            </div>
          )}

          {searchResult && (
            <div className="border border-gray-200 rounded-lg p-4 space-y-3">
              <div>
                <h3 className="font-semibold text-gray-900">{searchResult.name}</h3>
                {searchResult.description && (
                  <p className="text-sm text-gray-600 mt-1">{searchResult.description}</p>
                )}
                <p className="text-xs text-gray-500 mt-2">
                  {t('projects.ownerAndMembers', {
                        owner: searchResult.ownerName ?? t('projects.unknownOwner'),
                        count: searchResult.memberCount,
                      })}
                </p>
              </div>

              {searchResult.isMember ? (
                <p className="text-sm text-green-700">{t('projects.alreadyMember')}</p>
              ) : searchResult.myRequestStatus === 'pending' ? (
                <p className="text-sm text-blue-700">{t('projects.waitingApproval')}</p>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder={t('projects.messagePlaceholder')}
                    value={joinForm.message}
                    onChange={(e) => setJoinForm({ ...joinForm, message: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {searchResult.myRequestStatus === 'rejected' && (
                    <p className="text-xs text-orange-600">
                      {t('projects.rejectedBefore')}
                    </p>
                  )}
                  <button
                    onClick={handleRequestJoin}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                  >
                    {t('projects.sendRequest')}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* 내가 보낸 가입 요청 */}
      {membership.myRequests.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('projects.myRequests')}</h2>
          <div className="space-y-2">
            {membership.myRequests.map((request) => (
              <div
                key={request.id}
                className="flex items-center justify-between border border-gray-100 rounded-lg px-4 py-3"
              >
                <div>
                  <p className="font-medium text-gray-900">{request.projectName}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {t('projects.requestedOn', {
                            date: new Date(request.createdAt).toLocaleDateString(tag),
                          })}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`text-xs px-2 py-1 rounded ${
                      request.status === 'pending'
                        ? 'bg-blue-100 text-blue-700'
                        : request.status === 'approved'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {request.status === 'pending'
                      ? t('projects.statusPending')
                      : request.status === 'approved'
                        ? t('projects.statusApproved')
                        : t('projects.statusRejected')}
                  </span>
                  {request.status === 'pending' && (
                    <button
                      onClick={() => handleCancelMyRequest(request.id)}
                      className="text-xs text-gray-500 hover:text-red-600"
                    >
                      {t('common.cancel')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 프로젝트 목록 */}
      <div className="grid gap-4">
        {admin.isLoading ? (
          <div className="text-center text-gray-500 py-8">{t('common.loading')}</div>
        ) : admin.projects.length === 0 ? (
          <div className="bg-gray-50 rounded-lg p-8 text-center">
            <p className="text-gray-600 mb-4">{t('projects.empty')}</p>
            <button
              onClick={() => setShowCreateForm(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              {t('projects.createFirst')}
            </button>
          </div>
        ) : (
          admin.projects.map((project) => (
            <div
              key={project.id}
              className={`bg-white rounded-lg shadow p-6 ${
                admin.selectedProjectId === project.id ? 'ring-2 ring-blue-500' : ''
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  {/* 소유자는 이름과 설명을 이 자리에서 바로 고친다. 다른 구성원에게는 읽기 전용이다. */}
                  {editingId === project.id ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        autoFocus
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveProject(project.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        placeholder={t('projects.namePlaceholder')}
                        className="w-full px-2 py-1 text-lg font-semibold text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <input
                        type="text"
                        value={editForm.description}
                        onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveProject(project.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        placeholder={t('projects.descriptionEditPlaceholder')}
                        className="w-full px-2 py-1 text-sm text-gray-700 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSaveProject(project.id)}
                          disabled={admin.isSubmitting}
                          className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition disabled:opacity-50"
                        >
                          {admin.isSubmitting ? t('common.saving') : t('common.save')}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          disabled={admin.isSubmitting}
                          className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition disabled:opacity-50"
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold text-gray-900">{project.name}</h3>
                        {project.role === 'owner' && (
                          <button
                            onClick={() => startEdit(project)}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            {t('projects.editNameDescription')}
                          </button>
                        )}
                      </div>
                      {project.description && (
                        <p className="text-sm text-gray-600 mt-1">{project.description}</p>
                      )}
                    </>
                  )}
                  <div className="flex items-center gap-4 mt-3 flex-wrap">
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                      {getRoleLabel(project.role)}
                    </span>
                    {admin.selectedProjectId === project.id && (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                        {t('projects.selected')}
                      </span>
                    )}
                    {project.projectKey && (
                      <span className="inline-flex items-center gap-2 text-xs text-gray-600">
                        <span>{t('projects.key')}</span>
                        <code className="font-mono tracking-widest bg-gray-100 px-2 py-1 rounded">
                          {project.projectKey}
                        </code>
                        <button
                          onClick={() => handleCopyKey(project.projectKey!)}
                          className="text-blue-600 hover:underline"
                        >
                          {copiedKey === project.projectKey ? t('projects.copied') : t('projects.copy')}
                        </button>
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 ml-4">
                  {project.role === 'owner' ? (
                    <>
                      <button
                        onClick={() => setDeleteConfirm(project.id === deleteConfirm ? null : project.id)}
                        className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition"
                      >
                        {deleteConfirm === project.id ? t('common.confirm') : t('projects.deleteAction')}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleLeaveProject(project.id)}
                      className="px-3 py-1 text-sm bg-orange-600 text-white rounded hover:bg-orange-700 transition"
                    >
                      {t('projects.leave')}
                    </button>
                  )}
                </div>
              </div>

              {project.role === 'owner' && (
                <div className="mt-4 border-t border-gray-100 pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900">{t('projects.timezone')}</h4>
                      <p className="text-xs text-gray-500 mt-1">
                        {t('projects.timezoneHint')}
                      </p>
                    </div>
                    <select
                      value={project.timezone || DEFAULT_TIME_ZONE}
                      onChange={(e) => handleChangeTimeZone(project.id, e.target.value)}
                      className="px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {TIME_ZONE_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {/* UTC처럼 옮길 이름이 없는 항목은 id를 그대로 적는다. */}
                          {option.nameKey ? t(option.nameKey) : option.id}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900">{t('projects.displayCurrency')}</h4>
                      <p className="text-xs text-gray-500 mt-1">
                        {t('projects.displayCurrencyHint')}
                      </p>
                    </div>
                    <select
                      value={project.displayCurrency || project.ledgerCurrency || 'KRW'}
                      disabled={rebasingId === project.id}
                      onChange={(e) => handleChangeDisplayCurrency(project, e.target.value)}
                      className="px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    >
                      {SUPPORTED_CURRENCIES.map((code) => (
                        <option key={code} value={code}>
                          {currencyLabel(code)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="mt-2 text-xs text-gray-400">
                    {t('projects.ledgerCurrencyNote', { currency: project.ledgerCurrency || 'KRW' })}
                  </p>
                </div>
              )}

              <div className="mt-4 border-t border-gray-100 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900">{t('projects.myPerson')}</h4>
                    <p className="text-xs text-gray-500 mt-1">
                      {t('projects.myPersonHint')}
                    </p>
                  </div>
                  <select
                    value={project.myPersonId ?? ''}
                    onChange={(e) => handleChangeMyPerson(project.id, e.target.value)}
                    className="px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">{t('projects.myPersonNone')}</option>
                    {(membership.people[project.id] ?? []).map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {project.role === 'owner' && (
                <div className="mt-4 border-t border-gray-100 pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <h4 className="text-sm font-semibold text-gray-900">{t('projects.inviteLink')}</h4>
                    <div className="flex items-center gap-2">
                      <select
                        value={inviteRoleByProject[project.id] ?? 'editor'}
                        onChange={(e) =>
                          setInviteRoleByProject((prev) => ({
                            ...prev,
                            [project.id]: e.target.value as 'editor' | 'viewer',
                          }))
                        }
                        className="px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="editor">{t('role.editor')}</option>
                        <option value="viewer">{t('role.viewer')}</option>
                      </select>
                      <button
                        onClick={() => handleGenerateInviteLink(project.id)}
                        className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                      >
                        {t('projects.createLink')}
                      </button>
                    </div>
                  </div>

                  {(membership.invitations[project.id]?.length ?? 0) === 0 ? (
                    <p className="text-xs text-gray-500">
                      {t('projects.noInvite')}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {membership.invitations[project.id].map((invitation) => (
                        <div
                          key={invitation.id}
                          className="flex flex-wrap items-center justify-between gap-2 bg-gray-50 rounded-lg px-4 py-3"
                        >
                          <div className="min-w-0">
                            <p className="text-xs text-gray-700 break-all font-mono">
                              /join?code={invitation.invitationCode}
                            </p>
                            <p className="text-xs text-gray-500 mt-1">
                              {t('projects.rolePermission', { role: getRoleLabel(invitation.role) })}
                              {invitation.expiresAt &&
                                t('projects.until', {
                                    date: new Date(invitation.expiresAt).toLocaleDateString(tag),
                                  })}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => handleCopyInviteLink(invitation.invitationCode)}
                              className="px-3 py-1 text-xs bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-100 transition"
                            >
                              {copiedCode === invitation.invitationCode
                                    ? t('projects.copied')
                                    : t('projects.copyLink')}
                            </button>
                            <button
                              onClick={() => handleRevokeInvitation(invitation.id)}
                              className="px-3 py-1 text-xs bg-white border border-red-300 text-red-600 rounded hover:bg-red-50 transition"
                            >
                              {t('projects.revoke')}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {(membership.members[project.id]?.length ?? 0) > 0 && (
                <div className="mt-4 border-t border-gray-100 pt-4">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">
                    {t('projects.memberCount', { count: membership.members[project.id].length })}
                  </h4>
                  <div className="space-y-2">
                    {membership.members[project.id].map((member) => (
                      <div
                        key={member.id}
                        className="flex items-center justify-between gap-4 border border-gray-100 rounded-lg px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900">
                            {member.name}
                            <span className="ml-2 text-xs text-gray-500">
                              {getRoleLabel(member.role)}
                            </span>
                          </p>
                          <p className="text-xs text-gray-500">{member.email}</p>
                        </div>
                        {project.role === 'owner' && member.role !== 'owner' && (
                          <button
                            onClick={() => handleRemoveMember(project.id, member)}
                            className="px-3 py-1 text-xs bg-white border border-red-300 text-red-600 rounded hover:bg-red-50 transition shrink-0"
                          >
                            {t('projects.kick')}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {project.role === 'owner' && (membership.joinRequests[project.id]?.length ?? 0) > 0 && (
                <div className="mt-4 border-t border-gray-100 pt-4">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">
                    {t('projects.pendingRequests', {
                            count: membership.joinRequests[project.id].length,
                          })}
                  </h4>
                  <div className="space-y-2">
                    {membership.joinRequests[project.id].map((request) => (
                      <div
                        key={request.id}
                        className="flex items-start justify-between gap-4 bg-gray-50 rounded-lg px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900">{request.name}</p>
                          <p className="text-xs text-gray-500">{request.email}</p>
                          {request.message && (
                            <p className="text-xs text-gray-700 mt-1 break-words">
                              &ldquo;{request.message}&rdquo;
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => handleApproveRequest(request.id, 'editor')}
                            className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                          >
                            {t('projects.approveEditor')}
                          </button>
                          <button
                            onClick={() => handleApproveRequest(request.id, 'viewer')}
                            className="px-3 py-1 text-xs bg-gray-600 text-white rounded hover:bg-gray-700 transition"
                          >
                            {t('projects.approveViewer')}
                          </button>
                          <button
                            onClick={() => handleRejectRequest(request.id)}
                            className="px-3 py-1 text-xs bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-100 transition"
                          >
                            {t('projects.reject')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {deleteConfirm === project.id && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                  <p className="mb-2">{t('projects.deleteQuestion')}</p>
                  <p className="text-xs mb-3">{t('projects.deleteWarning')}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDeleteProject(project.id)}
                      className="flex-1 px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
                    >
                      {t('projects.deleteAction')}
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      className="flex-1 px-3 py-1 bg-gray-300 text-gray-700 rounded hover:bg-gray-400 text-sm"
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
