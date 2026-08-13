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
  role: 'owner' | 'editor' | 'viewer';
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
      const data = await apiClient.getMyProjects();
      setProjects(data || []);
      setError('');
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
      const newProject = await apiClient.createProject(createForm.name, createForm.description);
      setCreateForm({ name: '', description: '' });
      setShowCreateForm(false);
      setError('');
      setSelectedProjectId(newProject.id);
      await loadProjects();
      alert('프로젝트가 생성되었습니다.');
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
        <button
          onClick={() => setShowCreateForm(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
        >
          + 새 프로젝트 생성
        </button>
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
                  <button
                    onClick={() => setSelectedProjectId(project.id)}
                    className="text-left hover:text-blue-600 transition"
                  >
                    <h3 className="text-lg font-semibold text-gray-900">{project.name}</h3>
                  </button>
                  {project.description && (
                    <p className="text-sm text-gray-600 mt-1">{project.description}</p>
                  )}
                  <div className="flex items-center gap-4 mt-3">
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                      {getRoleLabel(project.role)}
                    </span>
                    {selectedProjectId === project.id && (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                        현재 선택됨
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
