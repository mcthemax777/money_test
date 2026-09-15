import { useRef, type ReactNode } from 'react';
import { Plus } from 'lucide-react-native';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useProjectBootstrap } from '@money/core/hooks/useProjectBootstrap';
import { useTranslation } from '@money/core/lib/i18n';
import { useAuth } from '@money/core/store/auth';

import {
  NearBottomProvider,
  useNearBottomScroll,
  useScrollLocked,
  useScrollRegistration,
} from './scroll';
import { FloatingActionProvider, useFloatingAction } from './floating-action';
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
      <FloatingActionProvider>
        <Shell>{children}</Shell>
      </FloatingActionProvider>
    </NearBottomProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { t, locale } = useTranslation();
  const { isAuthenticated, isInitializing } = useAuth();
  const insets = useSafeAreaInsets();
  /* 바닥에 닿으면 목록이 다음 쪽을 잇는다 (shell/scroll 참고). */
  const onScroll = useNearBottomScroll();
  const isScrollLocked = useScrollLocked();
  /* 목록이 끌기 중에 이 스크롤을 빌려 쓴다 (shell/scroll 참고). */
  const { attach, noteOffset } = useScrollRegistration();
  const scrollRef = useRef<ScrollView>(null);

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
        {/*
          굴러가는 자리를 한 겹 더 감싼다.

          붙박이 단추가 탭 막대 **위**에 서야 하는데, 바깥 틀에 바로 붙이면 그 틀의
          아래 끝이 탭 막대 밑이라 단추가 탭을 가린다. 스크롤만 담은 상자를 두면
          그 상자의 아래 끝이 곧 탭 막대의 윗변이다.
        */}
        <View className="flex-1">
          <ScrollView
            key={locale}
            className="flex-1"
            /* 목록을 끌어 옮기는 동안은 스크롤을 멈춘다. 함께 움직이면 줄이 손끝에서 달아난다. */
            scrollEnabled={!isScrollLocked}
            contentContainerClassName="mx-auto w-full max-w-7xl px-4 pb-8 pt-4 md:pt-8"
            contentContainerStyle={{ paddingBottom: 32 + insets.bottom }}
            ref={scrollRef}
            /*
             * 스크롤 영역이 화면 어디에 있는지 함께 넘긴다. 목록이 가장자리를 잴 때 쓴다 --
             * 위로는 안전 영역만큼, 아래로는 탭 막대만큼 화면과 어긋나 있다.
             */
            onLayout={(event) => {
              const { y, height } = event.nativeEvent.layout;
              attach?.(scrollRef.current, { top: insets.top + y, height });
            }}
            onScroll={(event) => {
              noteOffset(event.nativeEvent.contentOffset.y);
              onScroll?.(event);
            }}
            /*
             * 끌기 중에는 자주 받아야 한다. 굴러간 만큼을 알아야 줄이 손끝에 붙어 있는다.
             * 평소에는 바닥 감지에만 쓰이므로 이 값이 촘촘해도 부담이 없다(값만 읽는다).
             */
            scrollEventThrottle={16}
          >
            {children}
          </ScrollView>

          {/*
            굴러가는 본문 **위에** 뜨는 단추. 이 상자는 굴러가지 않으므로 목록을
            아무리 내려도 제자리에 남는다.
          */}
          <FloatingButton />
        </View>

        <TabBar />
      </View>
    </View>
  );
}

/**
 * 화면이 등록한 단추. 오른쪽 아래에 붙박인다.
 *
 * 굴러가는 본문(ScrollView) 밖, 탭 막대 위다. 안에 두면 목록과 함께 흘러가 버리고,
 * 탭 막대 아래에 두면 탭을 가린다. 탭 막대 위에 겹치지 않을 만큼만 띄운다.
 */
function FloatingButton() {
  const action = useFloatingAction();
  if (!action) return null;

  return (
    /*
      상자 자체는 손을 받지 않는다(pointerEvents="box-none"). 화면 오른쪽 아래를 통째로
      덮는 자리라, 받으면 그 밑의 목록을 누를 수 없다.
    */
    <View pointerEvents="box-none" className="absolute bottom-0 right-0 p-4">
      <Pressable
        onPress={action.onPress}
        accessibilityRole="button"
        accessibilityLabel={action.label}
        className="h-14 w-14 items-center justify-center rounded-full bg-blue-600 shadow-lg active:bg-blue-700"
      >
        <Plus size={26} color="#ffffff" />
      </Pressable>
    </View>
  );
}
