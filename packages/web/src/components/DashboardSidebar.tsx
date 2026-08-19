'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useUserFilter } from '@/store/user-filter';
import { useProject } from '@/store/project';
import { useAuth } from '@/store/auth';
import { apiClient } from '@/lib/api-client';
import { UserAvatar } from '@/components/UserAvatar';
import type { Person } from '@/lib/types';


interface Project {
  id: string;
  name: string;
  description?: string;
  role: 'owner' | 'editor' | 'viewer';
}

// 프로젝트가 있어야 의미가 있는 메뉴. 프로젝트가 없으면 감춘다.
const projectMenuItems = [
  { label: '홈', href: '/dashboard' },
  { label: '자산', href: '/assets' },
  { label: '카테고리', href: '/categories' },
];

// 프로젝트가 없어도 접근할 수 있어야 하는 메뉴 (여기서 프로젝트를 만든다)
const alwaysVisibleItems = [{ label: '설정', href: '/settings' }];

export default function DashboardSidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [showProjectChangeModal, setShowProjectChangeModal] = useState(false);
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);
  const [isChanging, setIsChanging] = useState(false);
  const { people, setPeople, selectedPersonIds, togglePersonId, setSelectedPersonIds } = useUserFilter();
  const { projects, setProjects, selectedProjectId, setSelectedProjectId } = useProject();
  const { setDefaultProject, defaultProjectData, user } = useAuth();

  const hasProject = projects.length > 0;
  const visibleMenuItems = hasProject
    ? [...projectMenuItems, ...alwaysVisibleItems]
    : alwaysVisibleItems;

  // 프로젝트 로드
  useEffect(() => {
    const loadProjects = async () => {
      try {
        const data = await apiClient.getMyProjects();
        setProjects(data || []);
        // 기본값: 첫 번째 프로젝트 선택
        if (!selectedProjectId && data && data.length > 0) {
          setSelectedProjectId(data[0].id);
        }
      } catch (err) {
        console.error('프로젝트 목록 조회 실패:', err);
      }
    };

    if (projects.length === 0) {
      loadProjects();
    }
  }, [projects.length, selectedProjectId, setProjects, setSelectedProjectId]);

  // 사용자 로드
  useEffect(() => {
    if (!selectedProjectId) return;

    const loadPeople = async () => {
      try {
        console.log('[Sidebar] Loading people from API for project:', selectedProjectId);
        const data = await apiClient.getPeople(selectedProjectId);
        console.log('[Sidebar] Loaded people:', data);
        setPeople(data || []);
        // 기본값: 모든 사용자 선택
        if (selectedPersonIds.length === 0) {
          setSelectedPersonIds((data || []).map((p: Person) => p.id));
        }
      } catch (err) {
        console.error('[Sidebar] 사용자 목록 조회 실패:', err);
        setPeople([]);
      }
    };

    loadPeople();
  }, [selectedProjectId]);

  const isActive = (href: string) => {
    if (href === '/dashboard') {
      return pathname === '/dashboard';
    }
    if (href === '/assets') {
      return pathname === '/assets' || pathname === '/assets/';
    }
    // 내 정보는 사이드탭 상단의 별도 항목이므로 설정 메뉴와 함께 강조되지 않게 한다.
    if (href === '/settings') {
      return pathname.startsWith('/settings') && !pathname.startsWith('/settings/profile');
    }
    return pathname.startsWith(href);
  };

  // 프로젝트 변경 요청
  const handleProjectChangeRequest = (projectId: string) => {
    if (selectedProjectId === projectId) return; // 이미 선택된 프로젝트면 무시
    setPendingProjectId(projectId);
    setShowProjectChangeModal(true);
  };

  // 프로젝트 변경 확인
  const handleConfirmProjectChange = async () => {
    if (!pendingProjectId) return;

    try {
      setIsChanging(true);
      // 기본 프로젝트 변경 API 호출
      const projectData = await setDefaultProject(pendingProjectId);

      if (projectData) {
        // 응답 데이터를 각 스토어에 동시에 설정
        // 이렇게 하면 모든 useEffect가 정확한 캐시 조건으로 실행됨
        setPeople(projectData.people || []);
        setSelectedPersonIds((projectData.people || []).map((p) => p.id));
        setSelectedProjectId(pendingProjectId);
        console.log(`✅ 프로젝트 변경됨: ${pendingProjectId}`, projectData);
      }

      setShowProjectChangeModal(false);
      setPendingProjectId(null);
      setIsOpen(false);
    } catch (err) {
      console.error('프로젝트 변경 실패:', err);
      alert('프로젝트 변경에 실패했습니다.');
    } finally {
      setIsChanging(false);
    }
  };

  // 프로젝트 변경 취소
  const handleCancelProjectChange = () => {
    setShowProjectChangeModal(false);
    setPendingProjectId(null);
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 left-4 z-50 md:hidden p-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
      >
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 6h16M4 12h16M4 18h16"
          />
        </svg>
      </button>

      <aside
        className={`fixed left-0 top-0 h-screen w-64 bg-white border-r border-gray-200 pt-20 md:pt-0 overflow-y-auto transition-transform duration-300 z-40 ${
          isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <Link
          href="/settings/profile"
          onClick={() => setIsOpen(false)}
          className={`flex items-center gap-3 p-4 border-b border-gray-200 transition ${
            isActive('/settings/profile') ? 'bg-blue-50' : 'hover:bg-gray-50'
          }`}
        >
          <UserAvatar name={user?.name} avatar={user?.avatar} />
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{user?.name ?? '내 정보'}</p>
            <p className="text-xs text-gray-500 truncate">{user?.email}</p>
          </div>
        </Link>

        <div className="p-4 border-b border-gray-200">
          <label className="block text-xs font-semibold text-gray-600 mb-3 uppercase tracking-wider">
            프로젝트
          </label>
          <div className="space-y-2">
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => handleProjectChangeRequest(project.id)}
                className={`w-full text-left px-3 py-2 rounded-lg transition text-sm ${
                  selectedProjectId === project.id
                    ? 'bg-blue-50 text-blue-600 font-medium'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <div className="font-medium">{project.name}</div>
                <div className="text-xs text-gray-500 mt-0.5">{project.role}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 border-b border-gray-200">
          <label className="block text-xs font-semibold text-gray-600 mb-3 uppercase tracking-wider">
            사용자
          </label>
          {people && people.length > 0 ? (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {people.map((person) => (
                <label key={person.id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedPersonIds.includes(person.id)}
                    onChange={() => togglePersonId(person.id)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">{person.name}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">사용자 로딩 중...</p>
          )}
        </div>

        <nav className="p-4">
          <div className="mb-4">
            <ul className="space-y-2">
              {visibleMenuItems.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setIsOpen(false)}
                    className={`block px-4 py-2 rounded-lg transition ${
                      isActive(item.href)
                        ? 'bg-blue-50 text-blue-600 font-medium'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>

            {!hasProject && (
              <p className="mt-4 px-4 text-xs text-gray-500">
                참여 중인 프로젝트가 없습니다. 설정에서 프로젝트를 만들거나 참여하세요.
              </p>
            )}
          </div>
        </nav>
      </aside>

      {/* 프로젝트 변경 확인 모달 */}
      {showProjectChangeModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white rounded-lg shadow-lg p-6 max-w-sm w-full mx-4">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              프로젝트를 변경하시겠습니까?
            </h2>
            <p className="text-gray-600 mb-6">
              현재 프로젝트의 데이터가 초기화됩니다.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleCancelProjectChange}
                disabled={isChanging}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={handleConfirmProjectChange}
                disabled={isChanging}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 flex items-center justify-center"
              >
                {isChanging ? (
                  <>
                    <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2" />
                    변경 중...
                  </>
                ) : (
                  '변경'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        className={`fixed inset-0 bg-black/50 z-30 md:hidden ${
          isOpen ? 'block' : 'hidden'
        }`}
        onClick={() => setIsOpen(false)}
      />
    </>
  );
}
