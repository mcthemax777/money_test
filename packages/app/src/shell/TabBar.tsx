import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTranslation } from '@money/core/lib/i18n';
import { isActiveNav, navItemsOf } from '@money/core/lib/nav';
import { useProject } from '@money/core/store/project';

import NavIcon from '../components/NavIcon';
import { useNavigation } from './navigation';

/**
 * 좁은 화면의 아래쪽 탭. 웹의 MobileTabBar 와 같다.
 *
 * 사이드바의 메뉴를 그대로 아래로 옮긴 것이다. 한 손으로 드는 화면에서는 위쪽
 * 구석보다 엄지가 닿는 아래가 누르기 쉽다.
 */
export default function TabBar() {
  const { t } = useTranslation();
  const { path, go } = useNavigation();
  const projects = useProject((state) => state.projects);
  const insets = useSafeAreaInsets();
  const items = navItemsOf(projects.length > 0);

  return (
    /* 아래 여백은 홈 표시줄 자리다. 그만큼 띄우지 않으면 마지막 칸이 깔려 눌리지 않는다. */
    <View
      className="border-t border-gray-200 bg-white md:hidden"
      style={{ paddingBottom: insets.bottom }}
    >
      <View className="h-14 flex-row items-stretch gap-1 px-2 py-1.5">
        {items.map((item) => {
          const active = isActiveNav(path, item.href);

          return (
            /*
              고른 칸은 옅은 파란 알약이다. 사이드바 메뉴·분류 목록·예산 줄이
              전부 같은 표시(bg-blue-50 + text-blue-600 + rounded-lg)를 쓴다.
            */
            <Pressable
              key={item.href}
              onPress={() => go(item.href)}
              className={`flex-1 items-center justify-center gap-1 rounded-lg ${
                active ? 'bg-blue-50' : ''
              }`}
            >
              {/* 그림은 글자 색을 따른다. 고른 칸이 한 덩이로 보여야 한다. */}
              <NavIcon
                name={item.icon}
                color={active ? '#2563eb' : '#4b5563'}
                strokeWidth={active ? 2.25 : 1.75}
              />
              <Text
                className={`text-[11px] leading-none ${
                  active ? 'font-medium text-blue-600' : 'text-gray-600'
                }`}
              >
                {t(item.labelKey)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
