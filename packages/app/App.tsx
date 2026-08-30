/*
 * 앱의 뿌리.
 *
 * 시작할 때 core 를 이 기기에 맞춰 놓고(서버 주소·토큰 저장소·스토어 저장소),
 * 로그인 여부에 따라 로그인 화면과 껍데기(사이드바 또는 위·아래 막대)를 가른다.
 */
import './global.css';

import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useTranslation } from '@money/core/lib/i18n';
import { useAuth } from '@money/core/store/auth';

import { setupApi } from './src/api';
import { hydrateStores } from './src/persistence';
import AssetsScreen from './src/screens/AssetsScreen';
import CategoriesScreen from './src/screens/CategoriesScreen';
import HomeScreen from './src/screens/HomeScreen';
import LedgerScreen from './src/screens/LedgerScreen';
import LoginScreen from './src/screens/LoginScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import ProjectsScreen from './src/screens/ProjectsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import AppShell from './src/shell/AppShell';
import { NavigationProvider, useNavigation } from './src/shell/navigation';

export default function App() {
  const { isAuthenticated, loadUser } = useAuth();
  const [isReady, setIsReady] = useState(false);
  /** 준비 중에 난 오류. 화면이 빈 채로 멈추지 않도록 로그인 화면에 적어 준다. */
  const [startupError, setStartupError] = useState('');

  // 시작 준비. 저장된 토큰과 스토어를 먼저 읽어야 첫 화면이 깜빡이지 않는다.
  useEffect(() => {
    const start = async () => {
      try {
        await setupApi(() => useAuth.setState({ user: null, isAuthenticated: false }));
        await hydrateStores();
        await loadUser();
      } catch (error) {
        // 준비가 실패해도 화면은 떠야 한다. 그대로 두면 도는 표시만 남는다.
        setStartupError(String(error));
      } finally {
        setIsReady(true);
      }
    };

    start();
  }, [loadUser]);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {!isReady ? (
        <View className="flex-1 items-center justify-center bg-white">
          <ActivityIndicator />
        </View>
      ) : isAuthenticated ? (
        <NavigationProvider>
          <AppShell>
            <Screen />
          </AppShell>
        </NavigationProvider>
      ) : (
        <LoginScreen startupError={startupError} />
      )}
    </SafeAreaProvider>
  );
}

/**
 * 지금 주소에 해당하는 화면.
 *
 * 주소 문자열은 웹과 같은 값이다(`/home`). 아직 옮기지 않은 화면은 그 사실을 적어
 * 둔다. 메뉴에서 빼 버리면 웹과 갈 수 있는 곳이 달라진다.
 */
function Screen() {
  const { path } = useNavigation();

  switch (path) {
    case '/home':
      return <HomeScreen />;
    case '/dashboard':
      return <LedgerScreen />;
    case '/assets':
      return <AssetsScreen />;
    case '/categories':
      return <CategoriesScreen />;
    case '/settings':
      return <SettingsScreen />;
    case '/settings/profile':
      return <ProfileScreen />;
    case '/settings/projects':
      return <ProjectsScreen />;
    default:
      return <ComingSoon />;
  }
}

function ComingSoon() {
  const { t } = useTranslation();

  return (
    <View className="py-8">
      <Text className="text-gray-600">{t('screen.webOnly')}</Text>
    </View>
  );
}
