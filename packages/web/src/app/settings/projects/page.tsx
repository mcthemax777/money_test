'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/store/auth';
import { useProject } from '@/store/project';
import { apiClient } from '@/lib/api-client';
import Link from 'next/link';

interface Project {
  id: string;
  name: string;
  description?: string;
  projectKey?: string | null;
  role: 'owner' | 'editor' | 'viewer';
  /** 집계 기준 타임존. 월 합계와 카드 청구주기 경계가 이 값을 따른다. */
  timezone?: string;
  /** 이 사용자가 이 프로젝트에서 "나"로 지정한 구성원 */
  myPersonId?: string | null;
}

/**
 * 고를 수 있는 기준 타임존.
 *
 * 전 세계 목록을 다 늘어놓을 필요는 없다. 필요해지면 여기에 추가한다.
 */
const TIME_ZONE_OPTIONS = [
  { id: 'Asia/Seoul', name: '서울 (UTC+9)' },
  { id: 'Asia/Tokyo', name: '도쿄 (UTC+9)' },
  { id: 'Asia/Shanghai', name: '상하이 (UTC+8)' },
  { id: 'Asia/Singapore', name: '싱가포르 (UTC+8)' },
  { id: 'Europe/London', name: '런던 (UTC+0/+1)' },
  { id: 'America/New_York', name: '뉴욕 (UTC-5/-4)' },
  { id: 'America/Los_Angeles', name: '로스앤젤레스 (UTC-8/-7)' },
  { id: 'UTC', name: 'UTC' },
];

interface SearchResult {
  id: string;
  projectKey: string;
  name: string;
  description?: string | null;
  ownerName: string | null;
  memberCount: number;
  isMember: boolean;
  myRequestStatus: 'pending' | 'approved' | 'rejected' | null;
}

interface JoinRequest {
  id: string;
  userId: string;
  name: string;
  email: string;
  avatar: string | null;
  message: string | null;
  createdAt: string;
}

interface ProjectMember {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'editor' | 'viewer';
  joinedAt: string;
}

interface Invitation {
  id: string;
  invitationCode: string;
  role: 'editor' | 'viewer';
  expiresAt: string | null;
  createdAt: string;
}

interface MyJoinRequest {
  id: string;
  projectId: string;
  projectName: string;
  projectKey: string | null;
  status: 'pending' | 'approved' | 'rejected';
  message: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export default function ProjectsPage() {
  const router = useRouter();
  const { isAuthenticated, isInitializing } = useAuth();
  const { projects, setProjects, selectedProjectId, setSelectedProjectId } = useProject();
  const [loading, setLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [error, setError] = useState('');
  const [createForm, setCreateForm] = useState({ name: '', description: '' });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // 가입 요청 관련 상태
  const [showJoinForm, setShowJoinForm] = useState(false);
  const [joinForm, setJoinForm] = useState({ key: '', message: '' });
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [searchError, setSearchError] = useState('');
  const [joinRequestsByProject, setJoinRequestsByProject] = useState<Record<string, JoinRequest[]>>({});
  const [myRequests, setMyRequests] = useState<MyJoinRequest[]>([]);
  const [membersByProject, setMembersByProject] = useState<Record<string, ProjectMember[]>>({});
  /** 프로젝트별 구성원(Person) 목록. "나" 지정에 쓴다. */
  const [peopleByProject, setPeopleByProject] = useState<Record<string, Array<{ id: string; name: string }>>>({});
  const [invitationsByProject, setInvitationsByProject] = useState<Record<string, Invitation[]>>({});
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
  }, []);

  const loadProjects = async () => {
    try {
      setLoading(true);
      const data: Project[] = (await apiClient.getMyProjects()) || [];
      setProjects(data);
      setError('');

      // owner인 프로젝트의 대기 중인 요청과, 내가 보낸 요청을 함께 갱신한다.
      const ownerProjects = data.filter((p) => p.role === 'owner');
      await Promise.all([
        // 가입 요청과 초대 링크는 소유자만 다루므로 소유 프로젝트만 조회한다.
        loadJoinRequests(ownerProjects),
        loadInvitations(ownerProjects),
        loadMembers(data),
        loadPeople(data),
        loadMyRequests(),
      ]);
    } catch (err) {
      console.error('프로젝트 목록 조회 실패:', err);
      setError('프로젝트 목록을 불러올 수 없습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleChangeTimeZone = async (projectId: string, timezone: string) => {
    try {
      await apiClient.updateProject(projectId, { timezone });
      // 사이드바와 각 화면이 이 값으로 날짜를 해석하므로 목록을 다시 받아 스토어를 갱신한다.
      const data: Project[] = (await apiClient.getMyProjects()) || [];
      setProjects(data);
      setError('');
    } catch (err: any) {
      setError(err.response?.data?.error?.message || '타임존 변경에 실패했습니다.');
    }
  };

  const handleCreateProject = async () => {
    if (!createForm.name.trim()) {
      setError('프로젝트 이름을 입력해주세요.');
      return;
    }

    try {
      const created = await apiClient.createProject(createForm.name, createForm.description);
      setCreateForm({ name: '', description: '' });
      setShowCreateForm(false);
      setError('');

      // 선택된 프로젝트가 없던 상태(첫 프로젝트이거나 전부 삭제한 뒤)라면
      // 방금 만든 프로젝트를 바로 선택한다. 그러지 않으면 사이드탭이 계속
      // 프로젝트 없는 상태로 남는다.
      const isFirstProject = !selectedProjectId;
      if (isFirstProject && created?.id) {
        setSelectedProjectId(created.id);
      }

      await loadProjects();

      if (!isFirstProject) {
        alert('프로젝트가 생성되었습니다. 사이드바에서 프로젝트를 선택해주세요.');
      }
    } catch (err) {
      setError('프로젝트 생성에 실패했습니다.');
      console.error(err);
    }
  };

  const handleLeaveProject = async (projectId: string) => {
    if (!confirm('정말 프로젝트를 탈퇴하시겠습니까?')) {
      return;
    }

    try {
      await apiClient.leaveProject(projectId);
      setDeleteConfirm(null);
      setError('');

      // 탈퇴한 프로젝트가 선택되어 있었다면 다른 프로젝트 선택
      if (selectedProjectId === projectId) {
        const remaining = projects.filter(p => p.id !== projectId);
        if (remaining.length > 0) {
          setSelectedProjectId(remaining[0].id);
        }
      }

      await loadProjects();
      alert('프로젝트에서 탈퇴했습니다.');
    } catch (err: any) {
      setError(err.response?.data?.message || '프로젝트 탈퇴에 실패했습니다.');
      console.error(err);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!confirm('정말 프로젝트를 삭제하시겠습니까? 모든 데이터가 삭제됩니다.')) {
      return;
    }

    try {
      await apiClient.deleteProject(projectId);
      setDeleteConfirm(null);
      setError('');

      // 삭제한 프로젝트가 선택되어 있었다면 다른 프로젝트 선택
      if (selectedProjectId === projectId) {
        const remaining = projects.filter(p => p.id !== projectId);
        if (remaining.length > 0) {
          setSelectedProjectId(remaining[0].id);
        }
      }

      await loadProjects();
      alert('프로젝트가 삭제되었습니다.');
    } catch (err: any) {
      setError(err.response?.data?.message || '프로젝트 삭제에 실패했습니다.');
      console.error(err);
    }
  };


  // ===== 가입 요청 =====

  const loadJoinRequests = async (ownerProjects: Project[]) => {
    const entries = await Promise.all(
      ownerProjects.map(async (project) => {
        try {
          const data = await apiClient.getProjectJoinRequests(project.id);
          return [project.id, data || []] as const;
        } catch (err) {
          console.error(`가입 요청 조회 실패 (${project.id}):`, err);
          return [project.id, []] as const;
        }
      }),
    );

    setJoinRequestsByProject(Object.fromEntries(entries));
  };

  // 멤버 목록은 소유자뿐 아니라 참여 중인 모든 멤버가 볼 수 있다.
  const loadMembers = async (allProjects: Project[]) => {
    const entries = await Promise.all(
      allProjects.map(async (project) => {
        try {
          const data = await apiClient.getProjectMembers(project.id);
          return [project.id, data || []] as const;
        } catch (err) {
          console.error(`멤버 조회 실패 (${project.id}):`, err);
          return [project.id, []] as const;
        }
      }),
    );

    setMembersByProject(Object.fromEntries(entries));
  };

  /** "나"로 지정할 수 있는 구성원 목록. 멤버(로그인 사용자)와 구성원(Person)은 다른 개념이다. */
  const loadPeople = async (allProjects: Project[]) => {
    const entries = await Promise.all(
      allProjects.map(async (project) => {
        try {
          const data = await apiClient.getPeople(project.id);
          return [project.id, data || []] as const;
        } catch (err) {
          console.error(`구성원 조회 실패 (${project.id}):`, err);
          return [project.id, []] as const;
        }
      }),
    );

    setPeopleByProject(Object.fromEntries(entries));
  };

  const handleChangeMyPerson = async (projectId: string, personId: string) => {
    try {
      await apiClient.setMyPerson(projectId, personId || null);
      const data: Project[] = (await apiClient.getMyProjects()) || [];
      setProjects(data);
      setError('');
    } catch (err: any) {
      setError(err.response?.data?.error?.message || '"나" 지정에 실패했습니다.');
    }
  };

  const loadInvitations = async (ownerProjects: Project[]) => {
    const entries = await Promise.all(
      ownerProjects.map(async (project) => {
        try {
          const data = await apiClient.getProjectPendingInvitations(project.id);
          return [project.id, data || []] as const;
        } catch (err) {
          console.error(`초대 목록 조회 실패 (${project.id}):`, err);
          return [project.id, []] as const;
        }
      }),
    );

    setInvitationsByProject(Object.fromEntries(entries));
  };

  const buildInviteUrl = (invitationCode: string) =>
    `${window.location.origin}/join?code=${invitationCode}`;

  const handleGenerateInviteLink = async (projectId: string) => {
    try {
      const role = inviteRoleByProject[projectId] ?? 'editor';
      const created = await apiClient.generateInvitationLink(projectId, role);
      setError('');
      await loadProjects();

      // 만든 직후 바로 공유할 수 있도록 클립보드에 담는다.
      if (created?.invitationCode) {
        await handleCopyInviteLink(created.invitationCode);
      }
    } catch (err: any) {
      setError(err.response?.data?.error?.message || '초대 링크 생성에 실패했습니다.');
    }
  };

  const handleCopyInviteLink = async (invitationCode: string) => {
    try {
      await navigator.clipboard.writeText(buildInviteUrl(invitationCode));
      setCopiedCode(invitationCode);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch {
      setError('클립보드 복사에 실패했습니다. 링크를 직접 선택해 복사해주세요.');
    }
  };

  const handleRevokeInvitation = async (invitationId: string) => {
    if (!confirm('이 초대 링크를 무효화하시겠습니까? 링크를 받은 사람은 참여할 수 없게 됩니다.')) {
      return;
    }

    try {
      await apiClient.revokeInvitation(invitationId);
      setError('');
      await loadProjects();
    } catch (err: any) {
      setError(err.response?.data?.error?.message || '초대 무효화에 실패했습니다.');
    }
  };

  const handleRemoveMember = async (projectId: string, member: ProjectMember) => {
    if (!confirm(`${member.name} 님을 프로젝트에서 내보내시겠습니까?`)) return;

    try {
      await apiClient.removeProjectMember(projectId, member.id);
      setError('');
      await loadProjects();
    } catch (err: any) {
      setError(err.response?.data?.error?.message || '강퇴에 실패했습니다.');
    }
  };

  const loadMyRequests = async () => {
    try {
      const data = await apiClient.getMyJoinRequests();
      setMyRequests(data || []);
    } catch (err) {
      console.error('내 가입 요청 조회 실패:', err);
    }
  };

  const handleSearchProject = async () => {
    const key = joinForm.key.trim();

    if (!key) {
      setSearchError('프로젝트 키를 입력해주세요.');
      return;
    }

    try {
      setSearching(true);
      setSearchError('');
      const data = await apiClient.findProjectByKey(key);
      setSearchResult(data);
    } catch (err: any) {
      setSearchResult(null);
      setSearchError(err.response?.data?.error?.message || '프로젝트를 찾을 수 없습니다.');
    } finally {
      setSearching(false);
    }
  };

  const handleRequestJoin = async () => {
    if (!searchResult) return;

    try {
      await apiClient.requestToJoinProject(searchResult.id, joinForm.message);
      setSearchResult({ ...searchResult, myRequestStatus: 'pending' });
      setJoinForm({ key: '', message: '' });
      setSearchError('');
      await loadMyRequests();
      alert('가입 요청을 보냈습니다. 소유자의 승인을 기다려주세요.');
    } catch (err: any) {
      setSearchError(err.response?.data?.error?.message || '가입 요청에 실패했습니다.');
    }
  };

  const handleApproveRequest = async (requestId: string, role: 'editor' | 'viewer') => {
    try {
      const result = await apiClient.approveJoinRequest(requestId, role);
      setError('');
      await loadProjects();
      alert(`${result.userName} 님을 멤버로 추가했습니다.`);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || '승인에 실패했습니다.');
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    if (!confirm('이 가입 요청을 거절하시겠습니까?')) return;

    try {
      await apiClient.rejectJoinRequest(requestId);
      setError('');
      await loadProjects();
    } catch (err: any) {
      setError(err.response?.data?.error?.message || '거절에 실패했습니다.');
    }
  };

  const handleCancelMyRequest = async (requestId: string) => {
    if (!confirm('보낸 가입 요청을 취소하시겠습니까?')) return;

    try {
      await apiClient.cancelJoinRequest(requestId);
      await loadMyRequests();
    } catch (err: any) {
      setError(err.response?.data?.error?.message || '요청 취소에 실패했습니다.');
    }
  };

  const handleCopyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      setError('클립보드 복사에 실패했습니다. 키를 직접 선택해 복사해주세요.');
    }
  };

  const getRoleLabel = (role: string) => {
    const labels: Record<string, string> = {
      owner: '소유자',
      editor: '편집자',
      viewer: '조회자',
    };
    return labels[role] || role;
  };

  if (isInitializing || !isAuthenticated) {
    return <div className="flex justify-center items-center h-screen">로그인 중...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">프로젝트 관리</h1>
          <p className="text-gray-600 mt-2">프로젝트를 생성, 관리, 탈퇴할 수 있습니다</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowJoinForm((prev) => !prev)}
            className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition"
          >
            프로젝트 참여
          </button>
          <button
            onClick={() => setShowCreateForm(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            + 새 프로젝트 생성
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* 프로젝트 생성 폼 */}
      {showCreateForm && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">새 프로젝트 생성</h2>
          <div className="space-y-4">
            <input
              type="text"
              placeholder="프로젝트 이름"
              value={createForm.name}
              onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <textarea
              placeholder="프로젝트 설명 (선택사항)"
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
                생성
              </button>
              <button
                onClick={() => {
                  setShowCreateForm(false);
                  setCreateForm({ name: '', description: '' });
                }}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 프로젝트 참여 (키 검색 -> 가입 요청) */}
      {showJoinForm && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">프로젝트 참여</h2>
            <p className="text-sm text-gray-600 mt-1">
              참여하려는 프로젝트의 키를 입력하세요. 소유자가 승인하면 멤버가 됩니다.
            </p>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="예: 4DVURPZZ"
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
              disabled={searching}
              className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 disabled:opacity-50 transition"
            >
              {searching ? '검색 중...' : '검색'}
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
                  소유자 {searchResult.ownerName ?? '알 수 없음'} · 멤버 {searchResult.memberCount}명
                </p>
              </div>

              {searchResult.isMember ? (
                <p className="text-sm text-green-700">이미 이 프로젝트의 멤버입니다.</p>
              ) : searchResult.myRequestStatus === 'pending' ? (
                <p className="text-sm text-blue-700">승인 대기 중입니다.</p>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="소유자에게 남길 메시지 (선택사항)"
                    value={joinForm.message}
                    onChange={(e) => setJoinForm({ ...joinForm, message: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {searchResult.myRequestStatus === 'rejected' && (
                    <p className="text-xs text-orange-600">
                      이전 요청이 거절되었습니다. 다시 요청할 수 있습니다.
                    </p>
                  )}
                  <button
                    onClick={handleRequestJoin}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                  >
                    가입 요청 보내기
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* 내가 보낸 가입 요청 */}
      {myRequests.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">내가 보낸 가입 요청</h2>
          <div className="space-y-2">
            {myRequests.map((request) => (
              <div
                key={request.id}
                className="flex items-center justify-between border border-gray-100 rounded-lg px-4 py-3"
              >
                <div>
                  <p className="font-medium text-gray-900">{request.projectName}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {new Date(request.createdAt).toLocaleDateString('ko-KR')} 요청
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
                      ? '승인 대기'
                      : request.status === 'approved'
                        ? '승인됨'
                        : '거절됨'}
                  </span>
                  {request.status === 'pending' && (
                    <button
                      onClick={() => handleCancelMyRequest(request.id)}
                      className="text-xs text-gray-500 hover:text-red-600"
                    >
                      취소
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
        {loading ? (
          <div className="text-center text-gray-500 py-8">로딩 중...</div>
        ) : projects.length === 0 ? (
          <div className="bg-gray-50 rounded-lg p-8 text-center">
            <p className="text-gray-600 mb-4">프로젝트가 없습니다.</p>
            <button
              onClick={() => setShowCreateForm(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              프로젝트 생성하기
            </button>
          </div>
        ) : (
          projects.map((project) => (
            <div
              key={project.id}
              className={`bg-white rounded-lg shadow p-6 ${
                selectedProjectId === project.id ? 'ring-2 ring-blue-500' : ''
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900">{project.name}</h3>
                  {project.description && (
                    <p className="text-sm text-gray-600 mt-1">{project.description}</p>
                  )}
                  <div className="flex items-center gap-4 mt-3 flex-wrap">
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                      {getRoleLabel(project.role)}
                    </span>
                    {selectedProjectId === project.id && (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                        현재 선택됨
                      </span>
                    )}
                    {project.projectKey && (
                      <span className="inline-flex items-center gap-2 text-xs text-gray-600">
                        <span>참여 키</span>
                        <code className="font-mono tracking-widest bg-gray-100 px-2 py-1 rounded">
                          {project.projectKey}
                        </code>
                        <button
                          onClick={() => handleCopyKey(project.projectKey!)}
                          className="text-blue-600 hover:underline"
                        >
                          {copiedKey === project.projectKey ? '복사됨' : '복사'}
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
                        {deleteConfirm === project.id ? '확인' : '삭제'}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleLeaveProject(project.id)}
                      className="px-3 py-1 text-sm bg-orange-600 text-white rounded hover:bg-orange-700 transition"
                    >
                      탈퇴
                    </button>
                  )}
                </div>
              </div>

              {project.role === 'owner' && (
                <div className="mt-4 border-t border-gray-100 pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900">기준 타임존</h4>
                      <p className="text-xs text-gray-500 mt-1">
                        월 합계와 카드 마감/결제일 경계를 이 타임존으로 계산합니다. 구성원 모두에게 같이 적용됩니다.
                      </p>
                    </div>
                    <select
                      value={project.timezone || 'Asia/Seoul'}
                      onChange={(e) => handleChangeTimeZone(project.id, e.target.value)}
                      className="px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {TIME_ZONE_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div className="mt-4 border-t border-gray-100 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900">구성원 중 나</h4>
                    <p className="text-xs text-gray-500 mt-1">
                      거래를 입력할 때 기본으로 선택됩니다. 사용자마다 따로 지정합니다.
                    </p>
                  </div>
                  <select
                    value={project.myPersonId ?? ''}
                    onChange={(e) => handleChangeMyPerson(project.id, e.target.value)}
                    className="px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">지정 안 함</option>
                    {(peopleByProject[project.id] ?? []).map((person) => (
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
                    <h4 className="text-sm font-semibold text-gray-900">초대 링크</h4>
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
                        <option value="editor">편집자</option>
                        <option value="viewer">조회자</option>
                      </select>
                      <button
                        onClick={() => handleGenerateInviteLink(project.id)}
                        className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                      >
                        링크 만들기
                      </button>
                    </div>
                  </div>

                  {(invitationsByProject[project.id]?.length ?? 0) === 0 ? (
                    <p className="text-xs text-gray-500">
                      유효한 초대 링크가 없습니다. 링크를 만들면 30일간 사용할 수 있습니다.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {invitationsByProject[project.id].map((invitation) => (
                        <div
                          key={invitation.id}
                          className="flex flex-wrap items-center justify-between gap-2 bg-gray-50 rounded-lg px-4 py-3"
                        >
                          <div className="min-w-0">
                            <p className="text-xs text-gray-700 break-all font-mono">
                              /join?code={invitation.invitationCode}
                            </p>
                            <p className="text-xs text-gray-500 mt-1">
                              {getRoleLabel(invitation.role)} 권한
                              {invitation.expiresAt &&
                                ` · ${new Date(invitation.expiresAt).toLocaleDateString('ko-KR')}까지`}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => handleCopyInviteLink(invitation.invitationCode)}
                              className="px-3 py-1 text-xs bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-100 transition"
                            >
                              {copiedCode === invitation.invitationCode ? '복사됨' : '링크 복사'}
                            </button>
                            <button
                              onClick={() => handleRevokeInvitation(invitation.id)}
                              className="px-3 py-1 text-xs bg-white border border-red-300 text-red-600 rounded hover:bg-red-50 transition"
                            >
                              무효화
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {(membersByProject[project.id]?.length ?? 0) > 0 && (
                <div className="mt-4 border-t border-gray-100 pt-4">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">
                    멤버 {membersByProject[project.id].length}명
                  </h4>
                  <div className="space-y-2">
                    {membersByProject[project.id].map((member) => (
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
                            강퇴
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {project.role === 'owner' && (joinRequestsByProject[project.id]?.length ?? 0) > 0 && (
                <div className="mt-4 border-t border-gray-100 pt-4">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">
                    대기 중인 가입 요청 {joinRequestsByProject[project.id].length}건
                  </h4>
                  <div className="space-y-2">
                    {joinRequestsByProject[project.id].map((request) => (
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
                            편집자로 승인
                          </button>
                          <button
                            onClick={() => handleApproveRequest(request.id, 'viewer')}
                            className="px-3 py-1 text-xs bg-gray-600 text-white rounded hover:bg-gray-700 transition"
                          >
                            조회자로 승인
                          </button>
                          <button
                            onClick={() => handleRejectRequest(request.id)}
                            className="px-3 py-1 text-xs bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-100 transition"
                          >
                            거절
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {deleteConfirm === project.id && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                  <p className="mb-2">정말로 이 프로젝트를 삭제하시겠습니까?</p>
                  <p className="text-xs mb-3">모든 데이터가 영구적으로 삭제됩니다.</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDeleteProject(project.id)}
                      className="flex-1 px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
                    >
                      삭제
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      className="flex-1 px-3 py-1 bg-gray-300 text-gray-700 rounded hover:bg-gray-400 text-sm"
                    >
                      취소
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
