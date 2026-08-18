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
}

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
      await Promise.all([
        loadJoinRequests(data.filter((p) => p.role === 'owner')),
        loadMyRequests(),
      ]);
    } catch (err) {
      console.error('프로젝트 목록 조회 실패:', err);
      setError('프로젝트 목록을 불러올 수 없습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProject = async () => {
    if (!createForm.name.trim()) {
      setError('프로젝트 이름을 입력해주세요.');
      return;
    }

    try {
      await apiClient.createProject(createForm.name, createForm.description);
      setCreateForm({ name: '', description: '' });
      setShowCreateForm(false);
      setError('');

      await loadProjects();
      alert('프로젝트가 생성되었습니다. 사이드바에서 프로젝트를 선택해주세요.');
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
                        onClick={() => router.push('/settings/invitations')}
                        className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 transition"
                      >
                        초대 관리
                      </button>
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
