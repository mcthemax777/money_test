import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTranslation } from '@money/core/lib/i18n';
import { useAuth } from '@money/core/store/auth';
import { useProject } from '@money/core/store/project';

import { AppBrand } from '../components/AppLogo';
import { UserAvatar } from '../components/UserAvatar';
import { useNavigation } from './navigation';

/**
 * 좁은 화면의 위쪽 막대. 웹의 MobileTopBar 와 같다.
 *
 * 왼쪽은 프로젝트, 가운데는 앱 이름, 오른쪽은 나다. 화면 이동은 아래 탭이 맡는다.
 */
export default function TopBar() {
  const { t } = useTranslation();
  const { go } = useNavigation();
  const insets = useSafeAreaInsets();
  const { projects, selectedProjectId, setSelectedProjectId } = useProject();
  const user = useAuth((state) => state.user);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const selected = projects.find((project) => project.id === selectedProjectId);
  /** 고른 것이 없으면 첫 프로젝트 이름이라도 적는다. 빈 자리는 눌러 볼 곳으로 보이지 않는다. */
  const label = selected?.name ?? projects[0]?.name ?? t('topbar.noProject');

  return (
    <View className="border-b border-gray-200 bg-white md:hidden" style={{ paddingTop: insets.top }}>
      <View className="h-14 flex-row items-center justify-between gap-2 px-3">
        {/* 프로젝트가 여럿이면 눌러서 고르고, 하나뿐이면 고를 것이 없어 홈으로 간다. */}
        {projects.length > 1 ? (
          <Pressable
            onPress={() => setIsPickerOpen((open) => !open)}
            className="min-w-0 flex-1 flex-row items-center gap-1 rounded-lg px-2 py-1 active:bg-gray-100"
          >
            <Text numberOfLines={1} className="shrink font-semibold text-gray-900">
              {label}
            </Text>
            <Text className="shrink-0 text-xs text-gray-500">▾</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => go(projects.length === 1 ? '/home' : '/settings')}
            className="min-w-0 flex-1 rounded-lg px-2 py-1 active:bg-gray-100"
          >
            <Text numberOfLines={1} className="font-semibold text-gray-900">
              {label}
            </Text>
          </Pressable>
        )}

        {/* 앱 표시. 누르면 홈으로 간다. 줄어들지 않게 두어 가운데 자리를 지킨다. */}
        <AppBrand onPress={() => go('/home')} />

        {/* 내 정보. 누르면 내 정보 화면으로 간다. */}
        <Pressable
          onPress={() => go('/settings/profile')}
          className="min-w-0 flex-1 flex-row items-center justify-end gap-2 rounded-lg px-2 py-1 active:bg-gray-100"
        >
          <UserAvatar name={user?.name} avatar={user?.avatar} />
          {/* 아주 좁은 화면에서는 이름을 접는다. 얼굴만으로도 누구인지 알아본다. */}
          <Text numberOfLines={1} className="hidden shrink text-sm text-gray-700 sm:flex">
            {user?.name ?? t('topbar.myInfo')}
          </Text>
        </Pressable>
      </View>

      {/* 프로젝트 고르기. 웹은 막대 아래 붙는 목록이고 앱도 같은 자리에 편다. */}
      {isPickerOpen ? (
        <View className="mx-3 mb-2 rounded-lg border border-gray-200 bg-white p-1">
          {projects.map((project) => {
            const isSelected = selectedProjectId === project.id;

            return (
              <Pressable
                key={project.id}
                onPress={() => {
                  setIsPickerOpen(false);
                  setSelectedProjectId(project.id);
                }}
                className={`rounded-lg px-3 py-2 ${isSelected ? 'bg-blue-50' : ''}`}
              >
                <Text
                  numberOfLines={1}
                  className={`font-medium ${isSelected ? 'text-blue-600' : 'text-gray-700'}`}
                >
                  {project.name}
                </Text>
                <Text className="text-xs text-gray-500">{project.role}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
