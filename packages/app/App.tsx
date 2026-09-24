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

import { useProjectBootstrap } from '@money/core/hooks/useProjectBootstrap';
import { useTranslation } from '@money/core/lib/i18n';
import { useAuth } from '@money/core/store/auth';

import { setupApi } from './src/api';
import { setupOffline } from './src/offline';
import { hydrateStores } from './src/persistence';
import OfflineSync from './src/shell/OfflineSync';
import ProjectAccessLostAlert from './src/shell/ProjectAccessLostAlert';
import AssetsScreen from './src/screens/AssetsScreen';
import CategoriesScreen from './src/screens/CategoriesScreen';
import HomeScreen from './src/screens/HomeScreen';
import InboxScreen from './src/screens/InboxScreen';
import LedgerScreen from './src/screens/LedgerScreen';
import LoginScreen from './src/screens/LoginScreen';
import OutboxScreen from './src/screens/OutboxScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import ProjectsScreen from './src/screens/ProjectsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import StartScreen from './src/screens/StartScreen';
import TransactionsScreen from './src/screens/TransactionsScreen';
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
        // 사본을 먼저 열어 둔다. 첫 화면이 서버를 기다리지 않고 사본에서 그려진다.
        await setupOffline();
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
        <Authenticated />
      ) : (
        <LoginScreen startupError={startupError} />
      )}
    </SafeAreaProvider>
  );
}

/**
 * 로그인한 사람에게 보여 줄 것.
 *
 * **가계부를 하나도 갖지 않은 사람은 껍데기로 들어오지 못한다.** 사이드바와 아래 탭은
 * 가계부 하나를 고른 상태를 전제로 그려져, 그 사람에게는 어느 칸을 눌러도 빈 화면이
 * 나온다. 첫 로그인 때 서버가 가계부를 만들어 주지 않으므로(`auth.service`) 가입한
 * 사람은 모두 한 번 시작 화면을 지난다.
 *
 * 목록을 받는 일을 여기서 한다. 예전에는 껍데기가 했는데, 껍데기를 그릴지 말지를
 * 그 결과로 정하게 되어 자리가 어긋났다 -- 받기 전에는 "없다"가 아니라 "모른다"이므로
 * 그 동안에는 아무것도 그리지 않고 기다린다 (isLoading).
 */
function Authenticated() {
  const { hasNoProject, isLoading } = useProjectBootstrap();

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <ActivityIndicator />
      </View>
    );
  }

  /*
   * 내보내졌다는 알림은 껍데기 밖에 둔다. 마지막 가계부에서 내보내지면 이 자리에서
   * 시작 화면으로 바뀌는데, 껍데기 안에 두면 알림도 함께 사라진다.
   */
  return (
    <>
      <ProjectAccessLostAlert />
      {hasNoProject ? (
        <StartScreen />
      ) : (
        <NavigationProvider>
          <OfflineSync />
          <AppShell>
            <Screen />
          </AppShell>
        </NavigationProvider>
      )}
    </>
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
    case '/transactions':
      return <TransactionsScreen />;
    // 거래 화면의 머리글에서 들어간다. 하위 화면이라 뒤로가기로 돌아온다.
    case '/transactions/inbox':
      return <InboxScreen />;
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
    case '/settings/outbox':
      return <OutboxScreen />;
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
