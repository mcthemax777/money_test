'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { AppBrand } from '@/components/AppLogo';
import ProjectSwitchModal from '@/components/ProjectSwitchModal';
import { UserAvatar } from '@/components/UserAvatar';
import { useNavPending } from '@/hooks/useNavPending';
import { useProjectSwitch } from '@/hooks/useProjectSwitch';
import { useTranslation } from '@/lib/i18n';
import { isActiveNav, navItemsOf } from '@/lib/nav';
import { useAuth } from '@/store/auth';
import { useProject } from '@/store/project';

/**
 * 넓은 화면의 왼쪽 사이드바.
 *
 * 좁은 화면에서는 아예 그리지 않는다. 예전에는 왼쪽 위 버튼으로 이 사이드바를
 * 서랍처럼 꺼냈는데, 꺼내기 전에는 지금 무슨 프로젝트를 보고 있는지도 알 수 없고
 * 꺼내면 화면을 통째로 덮었다. 좁은 화면은 위쪽 막대(MobileTopBar)와 아래쪽
 * 탭(MobileTabBar)이 대신 맡는다.
 */
export default function DashboardSidebar() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const { projects, selectedProjectId } = useProject();
  const { user } = useAuth();
  const switcher = useProjectSwitch();
  const { pendingHref, start } = useNavPending();

  const hasProject = projects.length > 0;
  const menuItems = navItemsOf(hasProject);

  return (
    <>
      <aside className="hidden md:block fixed left-0 top-0 h-screen w-64 bg-white border-r border-gray-200 overflow-y-auto z-40">
        {/* 맨 위는 앱 표시. 좁은 화면의 위쪽 막대 가운데에 오는 것과 같고, 누르면 홈으로 간다. */}
        <div className="flex items-center p-4 border-b border-gray-200">
          <AppBrand size="md" />
        </div>

        <Link
          href="/settings/profile"
          className={`flex items-center gap-3 p-4 border-b border-gray-200 transition ${
            pathname.startsWith('/settings/profile') ? 'bg-blue-50' : 'hover:bg-gray-50'
          }`}
        >
          <UserAvatar name={user?.name} avatar={user?.avatar} />
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {user?.name ?? t('topbar.myInfo')}
            </p>
            <p className="text-xs text-gray-500 truncate">{user?.email}</p>
          </div>
        </Link>

        <div className="p-4 border-b border-gray-200">
          <label className="block text-xs font-semibold text-gray-600 mb-3 uppercase tracking-wider">
            {t('sidebar.projects')}
          </label>
          <div className="space-y-2">
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => switcher.request(project.id)}
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

        <nav className="p-4">
          <ul className="space-y-2">
            {menuItems.map((item) => {
              const pending = pendingHref === item.href;
              // 누르는 즉시 켠다. 다음 화면이 뜨기 전에는 이 표시가 유일한 대답이다.
              const active = pending || isActiveNav(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => start(item.href)}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center justify-between gap-2 px-4 py-2 rounded-lg transition ${
                      active
                        ? 'bg-blue-50 text-blue-600 font-medium'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {t(item.labelKey)}
                    {pending && (
                      <span
                        className="h-4 w-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600"
                        aria-hidden
                      />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>

          {!hasProject && (
            <p className="mt-4 px-4 text-xs text-gray-500">{t('sidebar.noProject')}</p>
          )}
        </nav>
      </aside>

      <ProjectSwitchModal
        isOpen={switcher.isAsking}
        isChanging={switcher.isChanging}
        onConfirm={switcher.confirm}
        onCancel={switcher.cancel}
      />
    </>
  );
}
