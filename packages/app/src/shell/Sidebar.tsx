import { Pressable, ScrollView, Text, View } from 'react-native';

import { useTranslation } from '@money/core/lib/i18n';
import { isActiveNav, navItemsOf } from '@money/core/lib/nav';
import { useAuth } from '@money/core/store/auth';
import { useProject } from '@money/core/store/project';

import { AppBrand } from '../components/AppLogo';
import { UserAvatar } from '../components/UserAvatar';
import { useNavigation } from './navigation';

/**
 * 넓은 화면(태블릿·가로)의 왼쪽 사이드바. 웹의 DashboardSidebar 와 같다.
 *
 * 좁은 화면에서는 아예 그리지 않는다. 그쪽은 위쪽 막대와 아래쪽 탭이 맡는다.
 */
export default function Sidebar() {
  const { t } = useTranslation();
  const { path, go } = useNavigation();
  const { projects, selectedProjectId, setSelectedProjectId } = useProject();
  const user = useAuth((state) => state.user);

  const hasProject = projects.length > 0;
  const menuItems = navItemsOf(hasProject);

  return (
    <View className="hidden h-full w-64 border-r border-gray-200 bg-white md:flex">
      <ScrollView>
        {/* 맨 위는 앱 표시. 좁은 화면의 위쪽 막대 가운데에 오는 것과 같고, 누르면 홈으로 간다. */}
        <View className="flex-row items-center border-b border-gray-200 p-4">
          <AppBrand size="md" onPress={() => go('/home')} />
        </View>

        <Pressable
          onPress={() => go('/settings/profile')}
          className={`flex-row items-center gap-3 border-b border-gray-200 p-4 ${
            path.startsWith('/settings/profile') ? 'bg-blue-50' : ''
          }`}
        >
          <UserAvatar name={user?.name} avatar={user?.avatar} />
          <View className="min-w-0 shrink">
            <Text numberOfLines={1} className="text-sm font-medium text-gray-900">
              {user?.name ?? t('topbar.myInfo')}
            </Text>
            <Text numberOfLines={1} className="text-xs text-gray-500">
              {user?.email}
            </Text>
          </View>
        </Pressable>

        <View className="border-b border-gray-200 p-4">
          <Text className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-600">
            {t('sidebar.projects')}
          </Text>
          <View className="gap-2">
            {projects.map((project) => {
              const isSelected = selectedProjectId === project.id;

              return (
                <Pressable
                  key={project.id}
                  onPress={() => setSelectedProjectId(project.id)}
                  className={`rounded-lg px-3 py-2 ${isSelected ? 'bg-blue-50' : ''}`}
                >
                  <Text
                    className={`font-medium ${isSelected ? 'text-blue-600' : 'text-gray-700'}`}
                  >
                    {project.name}
                  </Text>
                  <Text className="mt-0.5 text-xs text-gray-500">{project.role}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View className="p-4">
          <View className="gap-2">
            {menuItems.map((item) => {
              const active = isActiveNav(path, item.href);

              return (
                <Pressable
                  key={item.href}
                  onPress={() => go(item.href)}
                  className={`flex-row items-center justify-between gap-2 rounded-lg px-4 py-2 ${
                    active ? 'bg-blue-50' : ''
                  }`}
                >
                  <Text className={active ? 'font-medium text-blue-600' : 'text-gray-700'}>
                    {t(item.labelKey)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {!hasProject ? (
            <Text className="mt-4 px-4 text-xs text-gray-500">{t('sidebar.noProject')}</Text>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
