/*
 * 제 구역을 지나는 동안 화면 위에 남는 머리글. 웹의 `position: sticky` 를 앱에서 만든다.
 *
 * 거래 목록의 년월 줄이 이것으로 선다. 9월을 훑는 동안 "9월"이 위에 붙어 있고, 8월이
 * 올라와 제 줄이 그 자리에 닿으면 9월을 밀어내고 8월이 선다 -- 미는 일은 따로 시키지
 * 않는다. 머리글은 **제 구역 안에서만** 따라 내려오므로, 구역이 끝나는 곳이 곧 그
 * 머리글이 갈 수 있는 끝이다.
 *
 * 앱은 화면 전체가 껍데기의 스크롤 하나라(`AppShell`) `stickyHeaderIndices` 를 걸 수
 * 없다 -- 그 값은 스크롤의 **직계 자식**만 붙일 수 있는데, 껍데기의 자식은 화면 하나다.
 * 그래서 굴러간 만큼을 되받아 제자리에 남게 한다 (`RevealTop` 과 같은 수법이다).
 *
 * 자리를 재는 방법이 `RevealTop` 과 다르다. 구역은 여럿이라 하나하나 창 좌표로 재면
 * 한 달을 펼칠 때마다 아래 모든 구역이 다시 재는 일을 벌인다. 여기서는 **담은 상자만**
 * 창 좌표로 한 번 재고, 구역은 그 상자 안에서의 제 자리(onLayout 의 y)를 쓴다.
 */
import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { useScrollControl, useScrollY } from './scroll';

/**
 * 붙어 있는 동안의 바탕. 페이지와 같은 회색(gray-50)이다.
 *
 * 투명하게 두면 아래를 지나가는 흰 거래줄이 달 이름과 겹쳐 읽힌다.
 */
const BACKGROUND = '#f9fafb';

interface Sections {
  /** 구역들을 담은 상자가 스크롤 내용 안에서 서 있는 자리. */
  offset: SharedValue<number>;
  /** 화면 위에 이미 서 있는 것의 높이. 머리글은 0 이 아니라 그 아래에 선다. */
  inset?: SharedValue<number>;
}

const SectionsContext = createContext<Sections | null>(null);

/** 구역들을 담는 상자. 스크롤 안에서의 제 자리를 재어 안의 구역들에 물려 준다. */
export function StickySections({
  inset,
  className,
  children,
}: {
  /** 굴러가지 않는 머리글이 위에 있으면 그 높이 (`RevealTop` 이 적어 준다). */
  inset?: SharedValue<number>;
  className?: string;
  children: ReactNode;
}) {
  const { offsetOf, areaOf } = useScrollControl();
  const box = useRef<View>(null);
  /** 처음에는 무한대다 -- 아직 재지 못한 동안에는 어느 머리글도 붙지 말아야 한다. */
  const offset = useSharedValue(Number.POSITIVE_INFINITY);

  /*
   * 창 좌표로 재고 스크롤 내용의 좌표로 옮긴다. 위쪽의 것(알림 줄·조건 알약)이 늘거나
   * 줄면 이 자리도 따라 바뀌므로 `onLayout` 이 올 때마다 다시 잰다.
   */
  const measure = useCallback(() => {
    box.current?.measureInWindow((_x, y) => {
      offset.value = y - areaOf().top + offsetOf();
    });
  }, [offset, areaOf, offsetOf]);

  const value = useMemo(() => ({ offset, inset }), [offset, inset]);

  return (
    <SectionsContext.Provider value={value}>
      <View ref={box} onLayout={measure} className={className}>
        {children}
      </View>
    </SectionsContext.Provider>
  );
}

/** 한 구역. 머리글은 이 구역이 화면을 지나는 동안 위에 남는다. */
export function StickySection({
  header,
  className,
  children,
}: {
  header: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const sections = useContext(SectionsContext);
  const scrollY = useScrollY();
  /** 담은 상자 안에서 이 구역이 서 있는 자리와, 구역과 머리글의 높이. */
  const top = useSharedValue(0);
  const height = useSharedValue(0);
  const headerHeight = useSharedValue(0);

  const follow = useAnimatedStyle(() => {
    if (!sections) return { transform: [{ translateY: 0 }] };

    /** 이 구역이 스크롤 내용 안에서 서 있는 자리. */
    const anchor = sections.offset.value + top.value;
    /** 머리글이 서야 할 자리. 위에 되돌아온 머리글이 있으면 그 아래다. */
    const line = scrollY.value + (sections.inset?.value ?? 0);
    /**
     * 따라 내려갈 수 있는 끝. 구역의 아래 끝에 머리글의 아래 끝이 닿는 자리다.
     *
     * 여기서 멈추므로 다음 구역의 머리글이 밀어 올리는 것으로 보인다 -- 둘이 겹치지
     * 않고 맞닿은 채로 지나간다.
     */
    const room = Math.max(0, height.value - headerHeight.value);

    return { transform: [{ translateY: Math.min(Math.max(0, line - anchor), room) }] };
  });

  return (
    <View
      className={className}
      onLayout={(event) => {
        const layout = event.nativeEvent.layout;
        top.value = layout.y;
        height.value = layout.height;
      }}
    >
      {/*
        `zIndex` 로 구역의 내용보다 위에 그린다. 빼면 따라 내려온 머리글이 제 구역의
        줄들 밑으로 들어가 글자가 겹쳐 보인다.
      */}
      <Animated.View
        onLayout={(event) => {
          headerHeight.value = event.nativeEvent.layout.height;
        }}
        style={[{ backgroundColor: BACKGROUND, zIndex: 1 }, follow]}
      >
        {header}
      </Animated.View>
      {children}
    </View>
  );
}
