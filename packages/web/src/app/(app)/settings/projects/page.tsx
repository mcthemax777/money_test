'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@money/core/store/auth';
import { useMirrorVersion } from '@money/core/hooks/useMirrorVersion';
import QrCode from '@/components/QrCode';
import { useProjectAdmin } from '@money/core/hooks/useProjectAdmin';
import {
  useProjectMembership,
  type MemberRow,
  type ProjectSearchResult,
} from '@money/core/hooks/useProjectMembership';
import type { Project } from '@money/core/store/project';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import PageHeader from '@/components/PageHeader';
import TypedConfirmModal from '@/components/TypedConfirmModal';

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
  /**
   * 글자로 한 번 더 확인하는 창에 띄운 일. 프로젝트 삭제와 소유자 넘기기는 되돌리기 어려워
   * 확인 단추 한 번으로 끝내지 않는다 (2026-10-09 사용자 요청).
   */
  const [typedAction, setTypedAction] = useState<
    | { kind: 'delete'; project: Project }
    | { kind: 'transfer'; project: Project; member: MemberRow }
    | null
  >(null);
  /** 이름·설명을 고치는 중인 프로젝트와 입력값. 한 번에 하나만 고친다. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '' });

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
    if (admin.projects.length > 0) {
      // 남이 소유자를 넘겨주는 등 내 권한이 바뀌었으면 프로젝트 목록도 다시 받는다.
      membership.load(admin.projects).then((roleChanged) => {
        if (roleChanged) void admin.reload();
      });
    }
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

  const handleLeaveProject = async (projectId: string) => {
    if (!confirm(t('projects.leaveConfirm'))) {
      return;
    }

    // 보고 있던 프로젝트면 훅이 남은 것 하나를 대신 고른다.
    if (!(await run(admin.removeOrLeave(projectId, 'leave')))) return;

    alert(t('projects.left'));
  };

  /** 글자 확인 창이 부른다. 실패하면 창이 이유를 적는다. */
  const handleDeleteProject = async (projectId: string) => {
    // 보고 있던 프로젝트면 훅이 남은 것 하나를 대신 고른다.
    const result = await admin.removeOrLeave(projectId, 'delete');
    if (!result.ok) return result;

    alert(t('projects.deleted'));
    return result;
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

  /** 글자 확인 창이 부른다. 실패하면 창이 이유를 적는다. */
  const handleTransferOwnership = async (projectId: string, member: MemberRow) => {
    const result = await membership.transferOwnership(projectId, member.id);
    // 내 권한이 편집자로 바뀌므로 멤버뿐 아니라 프로젝트 목록도 다시 받는다.
    if (result.ok) await admin.reload();
    return result;
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
                        onClick={() => setTypedAction({ kind: 'delete', project })}
                        className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition"
                      >
                        {t('projects.deleteAction')}
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

              {/*
                기준 타임존·표시 통화·이용권·구성원 중 나는 설정 탭으로 옮겼다 (2026-10-10 사용자 요청).
                지금 보는 가계부의 값으로 그곳에 선다.
              */}

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
                          {/*
                            QR 과 번호를 함께 둔다.

                            링크를 복사해 보내는 길만 있던 자리다. 그런데 사람을 들이는
                            일은 대개 옆에 앉아서 한다 -- 그때는 링크를 주고받는 것보다
                            화면을 보여 주고 폰으로 찍는 쪽이 빠르다. 번호는 QR 을 읽을
                            수 없을 때(다른 방에 있다, 전화로 불러 준다) 쓰는 길이다.
                          */}
                          <QrCode text={buildInviteUrl(invitation.invitationCode)} size={96} />
                          <div className="min-w-0 flex-1">
                            <p className="font-mono text-base font-semibold tracking-widest text-gray-900">
                              {invitation.invitationCode}
                            </p>
                            <p className="mt-0.5 text-xs text-gray-500">{t('invite.qrHint')}</p>
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
                          <div className="flex shrink-0 gap-2">
                            <button
                              onClick={() => setTypedAction({ kind: 'transfer', project, member })}
                              disabled={membership.isSubmitting}
                              className="px-3 py-1 text-xs bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 transition disabled:opacity-50"
                            >
                              {t('projects.transferOwner')}
                            </button>
                            <button
                              onClick={() => handleRemoveMember(project.id, member)}
                              className="px-3 py-1 text-xs bg-white border border-red-300 text-red-600 rounded hover:bg-red-50 transition"
                            >
                              {t('projects.kick')}
                            </button>
                          </div>
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

            </div>
          ))
        )}
      </div>

      <TypedConfirmModal
        isOpen={typedAction !== null}
        onClose={() => setTypedAction(null)}
        title={
          typedAction?.kind === 'transfer'
            ? t('projects.transferOwnerTitle', { project: typedAction.project.name })
            : t('projects.deleteTitle', { name: typedAction?.project.name ?? '' })
        }
        body={
          typedAction?.kind === 'transfer'
            ? [t('projects.transferOwnerConfirm', { name: typedAction.member.name })]
            : [t('projects.deleteWarning')]
        }
        phrase={t(typedAction?.kind === 'transfer' ? 'projects.transferPhrase' : 'projects.deletePhrase')}
        actionLabel={t(
          typedAction?.kind === 'transfer' ? 'projects.transferOwner' : 'projects.deleteAction',
        )}
        isSubmitting={admin.isSubmitting || membership.isSubmitting}
        onConfirm={async () => {
          if (!typedAction) return { ok: false };
          return typedAction.kind === 'transfer'
            ? handleTransferOwnership(typedAction.project.id, typedAction.member)
            : handleDeleteProject(typedAction.project.id);
        }}
      />
    </div>
  );
}
