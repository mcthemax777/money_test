/*
 * 앱의 뿌리.
 *
 * 시작할 때 core 를 이 기기에 맞춰 놓고(서버 주소·토큰 저장소·스토어 저장소),
 * 로그인 여부에 따라 로그인 화면과 껍데기(사이드바 또는 위·아래 막대)를 가른다.
 */
import './global.css';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useProjectBootstrap } from '@money/core/hooks/useProjectBootstrap';
import { useTranslation } from '@money/core/lib/i18n';
import { useAuth } from '@money/core/store/auth';
import { trackScreen } from '@money/core/lib/analytics';

import { boot } from './src/boot';
import OfflineSync from './src/shell/OfflineSync';
import PushSetup from './src/shell/PushSetup';
import AdsSetup from './src/shell/AdsSetup';
import UpdateGate from './src/shell/UpdateGate';
import ProjectAccessLostAlert from './src/shell/ProjectAccessLostAlert';
import AnalysisScreen from './src/screens/AnalysisScreen';
import AssetsScreen from './src/screens/AssetsScreen';
import CategoriesScreen from './src/screens/CategoriesScreen';
import HomeScreen from './src/screens/HomeScreen';
import InboxScreen, { INBOX_PATH } from './src/screens/InboxScreen';
import LoginScreen from './src/screens/LoginScreen';
import OutboxScreen from './src/screens/OutboxScreen';
import InquiriesScreen from './src/screens/InquiriesScreen';
import EntrySheetScreen from './src/screens/EntrySheetScreen';
import BudgetSettingsScreen from './src/screens/BudgetSettingsScreen';
import { BUDGET_SETTINGS_PATH } from '@money/core/lib/budget';
import ProfileScreen from './src/screens/ProfileScreen';
import ProjectsScreen from './src/screens/ProjectsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import StartScreen from './src/screens/StartScreen';
import TransactionsScreen from './src/screens/TransactionsScreen';
import AppShell from './src/shell/AppShell';
import { FrozenNavigation, NavigationProvider, useNavigation } from './src/shell/navigation';
import { ScreenVisibleContext, useAfterPaint } from './src/shell/after-paint';
import { useScrollRestore } from './src/shell/scroll';
import LoadingBlock from './src/components/LoadingBlock';
import { RevealScope } from './src/components/ChartReveal';

export default function App() {
  const { isAuthenticated, loadUser } = useAuth();
  const [isReady, setIsReady] = useState(false);
  /** 준비 중에 난 오류. 화면이 빈 채로 멈추지 않도록 로그인 화면에 적어 준다. */
  const [startupError, setStartupError] = useState('');

  // 시작 준비. 저장된 토큰과 스토어를 먼저 읽어야 첫 화면이 깜빡이지 않는다.
  useEffect(() => {
    const start = async () => {
      try {
        await boot();
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
      {/* 로그인 여부와 상관없이 뜬다. 준비(boot)가 끝나야 이 판의 버전이 실린다. */}
      {isReady ? <UpdateGate /> : null}
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
          <PushSetup />
          <AdsSetup />
          <AppShell>
            <Screen />
          </AppShell>
        </NavigationProvider>
      )}
    </>
  );
}

/** 하단 탭의 뿌리 화면. 한 번 열면 지우지 않고 숨겨 둔다(`Screen`). */
const TAB_PATHS = ['/home', '/transactions', '/analysis', '/assets', '/settings'] as const;

/**
 * 지금 주소에 해당하는 화면.
 *
 * 주소 문자열은 웹과 같은 값이다(`/home`). 아직 옮기지 않은 화면은 그 사실을 적어
 * 둔다. 메뉴에서 빼 버리면 웹과 갈 수 있는 곳이 달라진다.
 *
 * **하단 탭 화면은 한 번 열면 지우지 않고 숨겨 둔다** (2026-10-15 사용자 요청 -- 탭을 누를 때마다
 * 화면을 새로 만들어 반응이 느렸다). 다시 누르면 보이기만 해서 곧바로 서고, 보던 자리·펼침·받아
 * 둔 값이 그대로다. 숨은 동안에도 다른 기기의 변경을 받는다. 숨은 화면은 붙박이 단추와 뒤로가기를
 * 가로채지 않는다(`ScreenVisibleContext`). 처음 여는 탭은 탭 표시와 돌림 표시를 먼저 칠하고 두 그림
 * 뒤에 그린다. 하위 화면(설정 > 내 정보 따위)은 탭 화면들을 숨긴 채 위에 선다.
 */
function Screen() {
  const { path } = useNavigation();
  const { offsetOf, restoreTo } = useScrollRestore();

  // 화면 보기 통계. 주소에 실린 값(?month= 따위)은 core 가 떼고 보낸다.
  useEffect(() => {
    trackScreen(path);
  }, [path]);

  const tabPath = (TAB_PATHS as readonly string[]).includes(path) ? path : null;
  /** 한 번 연 탭 화면. */
  const [openedTabs, setOpenedTabs] = useState<string[]>(() => (tabPath ? [tabPath] : []));
  const isOpening = tabPath !== null && !openedTabs.includes(tabPath);
  const canOpen = useAfterPaint(isOpening);
  useEffect(() => {
    if (!canOpen || !tabPath) return;
    setOpenedTabs((prev) => (prev.includes(tabPath) ? prev : [...prev, tabPath]));
  }, [canOpen, tabPath]);

  /*
   * 탭마다 보던 자리. 화면 하나가 껍데기의 스크롤 하나를 함께 쓰므로, 숨겨 둔 화면으로 돌아가면
   * 그 화면이 떠날 때의 자리로 되돌린다. 처음 여는 탭은 맨 위다.
   */
  const offsets = useRef(new Map<string, number>());
  const shownPath = useRef(path);
  useEffect(() => {
    if (shownPath.current === path) return;
    offsets.current.set(shownPath.current, offsetOf());
    shownPath.current = path;
    restoreTo(offsets.current.get(path) ?? 0);
  }, [path, offsetOf, restoreTo]);

  return (
    <>
      {TAB_PATHS.filter((tab) => openedTabs.includes(tab)).map((tab) => (
        <TabPane key={tab} tab={tab} visible={tab === path} />
      ))}
      {isOpening ? <LoadingBlock /> : null}
      {tabPath ? null : screenOf(path)}
    </>
  );
}

/**
 * 숨겨 둘 수 있는 탭 화면 한 장. 숨은 동안에는 자리를 차지하지 않는다.
 *
 * 탭을 누를 때 숨은 화면까지 다시 그리지 않는다 -- 이 칸은 보임이 바뀔 때만 다시 그리고(memo), 안의
 * 화면은 한 번 만든 것을 그대로 두며(useMemo), 이동 값도 숨은 동안 얼려 둔다(`FrozenNavigation`).
 * 보임이 바뀌면 그 값을 읽는 것(붙박이 단추·뒤로가기·그래프 움직임)만 다시 그린다.
 */
const TabPane = memo(function TabPane({ tab, visible }: { tab: string; visible: boolean }) {
  const screen = useMemo(() => screenOf(tab), [tab]);
  return (
    <View style={visible ? undefined : { display: 'none' }}>
      <FrozenNavigation active={visible}>
        <ScreenVisibleContext.Provider value={visible}>
          {/* 다시 보이면 그래프도 다시 그려지듯 움직인다 (ChartReveal). */}
          <RevealScope visible={visible}>{screen}</RevealScope>
        </ScreenVisibleContext.Provider>
      </FrozenNavigation>
    </View>
  );
});

/** 주소의 화면. */
function screenOf(path: string) {
  /*
   * 예산 설정. 주소에 보던 달과 유형이 실려 오므로(`?month=…&type=…`) 앞부분으로 가른다.
   * 홈의 예산 상자에서 들어가는 하위 화면이라 뒤로가기로 돌아온다.
   */
  if (path.split('?')[0] === BUDGET_SETTINGS_PATH) return <BudgetSettingsScreen />;
  // 거래 화면의 머리글이나 보관함 푸시에서 들어간다. 푸시는 열 탭을 주소에 싣는다(`?tab=`).
  if (path.split('?')[0] === INBOX_PATH) return <InboxScreen />;

  switch (path) {
    case '/home':
      return <HomeScreen />;
    case '/transactions':
      return <TransactionsScreen />;
    case '/analysis':
      return <AnalysisScreen />;
    case '/assets':
      return <AssetsScreen />;
    case '/settings':
      return <SettingsScreen />;
    case '/settings/profile':
      return <ProfileScreen />;
    // 분류와 태그. 메뉴가 아니라 설정에서 들어가는 하위 화면이다.
    case '/settings/categories':
      return <CategoriesScreen />;
    case '/settings/projects':
      return <ProjectsScreen />;
    case '/settings/outbox':
      return <OutboxScreen />;
    // 관리자에게 문의. 답장 푸시를 누르면 여기로 온다.
    case '/settings/inquiries':
      return <InquiriesScreen />;
    // 거래내역 엑셀 가져오기·내보내기.
    case '/settings/sheet':
      return <EntrySheetScreen />;
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
