'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { AppBrand } from '@/components/AppLogo';
import ProjectSwitchModal from '@/components/ProjectSwitchModal';
import { UserAvatar } from '@/components/UserAvatar';
import { useProjectSwitch } from '@/hooks/useProjectSwitch';
import { useAuth } from '@/store/auth';
import { useProject } from '@/store/project';

/**
 * 좁은 화면의 위쪽 막대.
 *
 * 넓은 화면에서는 사이드바가 프로젝트와 내 정보를 늘 보여 준다. 좁은 화면에서는
 * 그 자리가 없어 예전에는 왼쪽 위 버튼을 눌러 사이드바를 꺼내 봐야 했다. 지금
 * 무슨 프로젝트를 보고 있는지, 누구로 로그인해 있는지는 눌러서 확인할 것이 아니라
 * 늘 보여야 하는 값이다.
 *
 * 왼쪽은 프로젝트, 가운데는 앱 이름, 오른쪽은 나다. 화면 이동은 아래 탭이 맡는다.
 */
export default function MobileTopBar() {
  const { projects, selectedProjectId } = useProject();
  const { user } = useAuth();
  const switcher = useProjectSwitch();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const selected = projects.find((project) => project.id === selectedProjectId);
  /** 고른 것이 없으면 첫 프로젝트 이름이라도 적는다. 빈 자리는 눌러 볼 곳으로 보이지 않는다. */
  const label = selected?.name ?? projects[0]?.name ?? '프로젝트 없음';

  useEffect(() => {
    if (!isPickerOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setIsPickerOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsPickerOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isPickerOpen]);

  return (
    <>
      <header className="md:hidden fixed inset-x-0 top-0 z-40 h-14 bg-white border-b border-gray-200">
        <div className="flex h-full items-center justify-between gap-2 px-3">
          {/*
            프로젝트가 여럿이면 눌러서 고르고, 하나뿐이면 고를 것이 없어 홈으로
            간다. 아직 하나도 없으면 만들 수 있는 곳(설정)으로 보낸다.
          */}
          {projects.length > 1 ? (
            <div ref={pickerRef} className="relative min-w-0 flex-1">
              <button
                type="button"
                onClick={() => setIsPickerOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={isPickerOpen}
                className="flex w-full min-w-0 items-center gap-1 rounded-lg px-2 py-1 font-semibold text-gray-900 hover:bg-gray-100"
              >
                <span className="truncate">{label}</span>
                <span className="shrink-0 text-xs text-gray-500" aria-hidden>
                  ▾
                </span>
              </button>

              {isPickerOpen && (
                <div
                  role="menu"
                  className="absolute left-0 top-full mt-1 w-56 rounded-lg border border-gray-200 bg-white p-1 shadow-lg"
                >
                  {projects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setIsPickerOpen(false);
                        switcher.request(project.id);
                      }}
                      className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                        selectedProjectId === project.id
                          ? 'bg-blue-50 font-medium text-blue-600'
                          : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <span className="block truncate font-medium">{project.name}</span>
                      <span className="block text-xs text-gray-500">{project.role}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <Link
              href={projects.length === 1 ? '/home' : '/settings'}
              className="min-w-0 flex-1 truncate rounded-lg px-2 py-1 font-semibold text-gray-900 hover:bg-gray-100"
            >
              {label}
            </Link>
          )}

          {/*
            앱 표시. 양옆과 달리 눌러서 가는 곳이 없다. 여기서 홈으로 보내면 아래
            탭의 홈과 겹치고, 프로젝트가 하나일 때는 왼쪽 이름과도 겹친다.

            줄어들지 않게 두어(shrink-0) 양옆 글자가 길어도 가운데 자리를 지킨다.
          */}
          <AppBrand />

          {/* 내 정보. 누르면 내 정보 화면으로 간다. */}
          <Link
            href="/settings/profile"
            className="flex min-w-0 flex-1 items-center justify-end gap-2 rounded-lg px-2 py-1 hover:bg-gray-100"
          >
            <UserAvatar name={user?.name} avatar={user?.avatar} />
            {/* 아주 좁은 화면에서는 이름을 접는다. 얼굴만으로도 누구인지 알아본다. */}
            <span className="hidden min-w-0 truncate text-sm text-gray-700 sm:inline">
              {user?.name ?? '내 정보'}
            </span>
          </Link>
        </div>
      </header>

      <ProjectSwitchModal
        isOpen={switcher.isAsking}
        isChanging={switcher.isChanging}
        onConfirm={switcher.confirm}
        onCancel={switcher.cancel}
      />
    </>
  );
}
