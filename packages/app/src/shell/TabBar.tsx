import { startTransition, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTranslation } from '@money/core/lib/i18n';
import { isActiveNav, navItemsOf } from '@money/core/lib/nav';
import { useProject } from '@money/core/store/project';

import CountBadge from '../components/CountBadge';
import NavIcon from '../components/NavIcon';
import { useNavigation } from './navigation';
import { useNavBadges } from './nav-badges';

/** 칸 사이 간격과 줄의 좌우 여백(px). 알약이 칸 자리를 셀 때 쓴다 (gap-1, px-2 와 같다). */
const GAP = 4;
const SIDE_PAD = 8;

/**
 * 좁은 화면의 아래쪽 탭. 웹의 MobileTabBar 와 같다.
 *
 * 사이드바의 메뉴를 그대로 아래로 옮긴 것이다. 한 손으로 드는 화면에서는 위쪽
 * 구석보다 엄지가 닿는 아래가 누르기 쉽다.
 *
 * **누르면 곧바로 표시가 옮겨 간다** (2026-10-15 사용자 요청 -- 탭이 늦게 반응했다). 고른 칸은
 * 이 막대가 먼저 들고(`selected`), 화면을 바꾸는 일은 그 뒤로 미룬다(startTransition). 같은 그림에서
 * 화면까지 바꾸면 새 화면을 다 그릴 때까지 표시조차 바뀌지 않는다. 알약은 고른 칸으로 미끄러지고,
 * 누른 그림은 살짝 눌렸다 튄다.
 */
export default function TabBar() {
  const { t } = useTranslation();
  const { path, go } = useNavigation();
  const projects = useProject((state) => state.projects);
  const insets = useSafeAreaInsets();
  const items = navItemsOf(projects.length > 0);
  // 칸의 빨간 수. 거래는 보관함, 설정은 보내지 못한 거래와 읽지 않은 문의 답이다.
  const badges = useNavBadges();

  const activeIndex = items.findIndex((item) => isActiveNav(path, item.href));
  /** 눌러서 고른 칸. 화면이 바뀌기 전에 먼저 옮겨 간다. 주소가 바뀌면 그쪽을 따른다. */
  const [selected, setSelected] = useState(activeIndex);
  useEffect(() => setSelected(activeIndex), [activeIndex]);

  /** 칸 하나의 폭. 줄의 폭을 재어 센다 (칸은 flex-1 로 고르게 선다). */
  const [slotWidth, setSlotWidth] = useState(0);
  const measure = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setSlotWidth((width - SIDE_PAD * 2 - GAP * (items.length - 1)) / items.length);
  };

  /** 알약의 자리. 고른 칸으로 미끄러진다. 처음에는 움직이지 않고 그 자리에 선다. */
  const pillX = useRef(new Animated.Value(0)).current;
  const placed = useRef(false);
  useEffect(() => {
    if (slotWidth <= 0 || selected < 0) return;
    const to = SIDE_PAD + selected * (slotWidth + GAP);
    if (!placed.current) {
      pillX.setValue(to);
      placed.current = true;
      return;
    }
    Animated.spring(pillX, {
      toValue: to,
      useNativeDriver: true,
      damping: 20,
      stiffness: 260,
      mass: 0.8,
    }).start();
  }, [pillX, selected, slotWidth]);

  return (
    /* 아래 여백은 홈 표시줄 자리다. 그만큼 띄우지 않으면 마지막 칸이 깔려 눌리지 않는다. */
    <View
      className="border-t border-gray-200 bg-white md:hidden"
      style={{ paddingBottom: insets.bottom }}
    >
      <View className="h-14 flex-row items-stretch gap-1 px-2 py-1.5" onLayout={measure}>
        {/*
          고른 칸의 옅은 파란 알약. 사이드바 메뉴·분류 목록·예산 줄이 전부 같은 표시(bg-blue-50 +
          text-blue-600 + rounded-lg)를 쓴다. 칸마다 그리지 않고 하나를 두어 칸 사이를 미끄러진다.
        */}
        {slotWidth > 0 && selected >= 0 ? (
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 6,
              bottom: 6,
              left: 0,
              width: slotWidth,
              borderRadius: 8,
              backgroundColor: '#eff6ff',
              transform: [{ translateX: pillX }],
            }}
          />
        ) : null}
        {items.map((item, index) => (
          <TabItem
            key={item.href}
            active={index === selected}
            icon={item.icon}
            label={t(item.labelKey)}
            badge={badges[item.href] ?? 0}
            onPress={() => {
              setSelected(index);
              // 화면을 바꾸는 일은 표시가 먼저 칠해진 뒤에 한다.
              startTransition(() => go(item.href));
            }}
          />
        ))}
      </View>
    </View>
  );
}

/** 칸 하나. 누르면 그림이 살짝 줄었다가 튀어 돌아온다. */
function TabItem({
  active,
  icon,
  label,
  badge,
  onPress,
}: {
  active: boolean;
  icon: Parameters<typeof NavIcon>[0]['name'];
  label: string;
  badge: number;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const pressTo = (value: number) =>
    Animated.spring(scale, {
      toValue: value,
      useNativeDriver: true,
      damping: 12,
      stiffness: 380,
    }).start();

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => pressTo(0.86)}
      onPressOut={() => pressTo(1)}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      className="flex-1 items-center justify-center gap-1 rounded-lg"
    >
      {/* 그림은 글자 색을 따른다. 고른 칸이 한 덩이로 보여야 한다. 배지는 그림 오른쪽 위다. */}
      <Animated.View style={{ position: 'relative', transform: [{ scale }] }}>
        <NavIcon
          name={icon}
          color={active ? '#2563eb' : '#4b5563'}
          strokeWidth={active ? 2.25 : 1.75}
        />
        <CountBadge count={badge} />
      </Animated.View>
      <Text
        className={`text-[11px] leading-none ${active ? 'font-medium text-blue-600' : 'text-gray-600'}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
