import type { ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useProjectBootstrap } from '@money/core/hooks/useProjectBootstrap';
import { useTranslation } from '@money/core/lib/i18n';
import { useAuth } from '@money/core/store/auth';

import { NearBottomProvider, useNearBottomScroll } from './scroll';
import Sidebar from './Sidebar';
import TabBar from './TabBar';

/**
 * 로그인 뒤 화면들의 공통 껍데기. 웹의 AppShell 과 같은 규칙이다.
 *
 * 이동하는 자리는 화면 너비에 따라 갈린다. 넓으면 왼쪽 사이드바, 좁으면 아래쪽 탭이다.
 *
 * 위쪽 막대는 두지 않는다. 프로젝트 이름과 앱 표시, 내 얼굴이 화면마다 한 줄을 차지했는데
 * 그 셋은 어디서나 볼 것이 아니다. 프로젝트를 고르는 일과 내 정보는 설정에 있다
 * (설정 > 프로젝트 관리의 "이걸로 고르기", 설정 > 내 정보).
 *
 * 본문은 웹과 같은 여백(px-4 py-8)과 최대 너비(max-w-7xl)를 쓴다. 태블릿을 가로로
 * 놓아도 글자가 화면 끝까지 늘어지지 않는다.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <NearBottomProvider>
      <Shell>{children}</Shell>
    </NearBottomProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { t, locale } = useTranslation();
  const { isAuthenticated, isInitializing } = useAuth();
  const insets = useSafeAreaInsets();
  /* 바닥에 닿으면 목록이 다음 쪽을 잇는다 (shell/scroll 참고). */
  const onScroll = useNearBottomScroll();

  // 프로젝트 목록과 첫 선택. 웹의 껍데기도 같은 훅을 쓴다.
  useProjectBootstrap();

  if (isInitializing || !isAuthenticated) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <Text className="text-gray-600">{t('shell.signingIn')}</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 flex-row bg-gray-50">
      <Sidebar />

      {/*
        상태 표시줄 자리를 여기서 비운다.

        여백을 굴러가는 본문 안에 주면 올린 만큼 첫 줄이 시계 밑으로 들어간다. 굴러가지
        않는 이 바깥 틀에 주면 굴림 자리가 시계 아래에서 시작해 무엇을 올려도 가려지지
        않는다. 아래쪽은 탭 막대가 제 몫을 맡는다.
      */}
      <View className="flex-1" style={{ paddingTop: insets.top }}>
        {/*
          언어를 바꾸면 본문을 새로 만든다(key).

          사전에서 문구를 꺼내는 화면은 스토어를 구독하고 있어 저절로 다시 그려지지만,
          날짜 표기처럼 훅 없이 지금 언어를 읽어 쓰는 자리는 다시 그릴 까닭이 없어
          옛 표기가 남는다.
        */}
        <ScrollView
          key={locale}
          className="flex-1"
          contentContainerClassName="mx-auto w-full max-w-7xl px-4 pb-8 pt-4 md:pt-8"
          contentContainerStyle={{ paddingBottom: 32 + insets.bottom }}
          onScroll={onScroll}
          scrollEventThrottle={64}
        >
          {children}
        </ScrollView>

        <TabBar />
      </View>
    </View>
  );
}
