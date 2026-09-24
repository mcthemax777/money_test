/*
 * 굴리는 방향을 따라 숨었다 되돌아오는 머리글. 웹의 `useTopReveal` 과 같은 규칙이다.
 *
 * **내릴 때는 비켜서고, 조금이라도 위로 올리면 되돌아온다.** 화면 위에 계속 붙여 두면
 * 긴 목록에서 자리를 빼앗고(한때 그랬다), 그냥 흘려보내면 탭 하나를 옮기려고 맨 위까지
 * 되돌아가야 한다. 올릴 때 제목·탭·걸어 둔 조건이 한 덩어리로 내려오므로, 그중 무엇이
 * 필요했든 같은 손짓으로 닿는다.
 *
 * 화면 맨 위에 늘 남는 한 줄은 이 덩어리가 아니라 그 달의 년월 줄이 맡는다
 * (`StickySection`). 그 줄이 어디에 설지는 여기서 내주는 `inset` 이 정한다 -- 비켜서
 * 있으면 0, 되돌아와 있으면 이 덩어리의 높이다.
 *
 * 앱은 화면 전체가 껍데기의 스크롤 하나라(`AppShell`) 화면이 그린 것은 무엇이든 함께
 * 굴러간다. `ScrollView` 의 `stickyHeaderIndices` 는 **직계 자식**만 붙일 수 있는데,
 * 껍데기의 자식은 화면 하나뿐이라 그 안쪽에는 걸 수 없다. 그래서 굴러간 만큼을 되받아
 * 제자리에 남게 한다 -- 제자리를 지나기 전에는 0 이고, 지난 뒤에는 지난 만큼 따라
 * 내려온다.
 *
 * 움직임은 UI 실에서 센다(worklet). 굴러간 값은 껍데기의 스크롤 사건이 날라 주므로
 * 목록을 그리느라 JS 가 붙잡히면 그 사이에는 따라오지 못한다 -- 거래 화면은 줄을
 * 나눠 그려 그 멈춤을 짧게 두고 있다(TransactionsScreen 의 예산 참고).
 */
import { useCallback, useRef, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useScrollControl, useScrollY } from './scroll';

/**
 * 붙어 있는 동안의 바탕. 페이지와 같은 회색(gray-50)이다.
 *
 * 투명하게 두면 아래를 지나가는 줄이 탭 막대의 둥근 모서리로 비쳐 보인다. 위아래
 * 여백도 같은 바탕이라 줄이 막대에 닿기 전에 회색이 먼저 온다 (웹도 같은 8px 이다).
 */
const BACKGROUND = '#f9fafb';
const PADDING = 8;

/** 방향이 바뀌었다고 보기까지 굴러야 하는 거리(px). 손떨림으로 오르내리지 않게 한다. */
const TURN = 16;

/** 숨고 되돌아오는 데 드는 시간. 웹의 transition 과 같은 값이다. */
const TIMING = { duration: 200 };

export default function RevealTop({
  inset,
  children,
}: {
  /**
   * 되돌아와 있는 높이를 적어 두는 자리. 아래의 붙박이 줄(`StickySection`)이 읽는다.
   *
   * 없이 두면 그 줄이 이 덩어리 밑에 깔린다 -- 제목이 내려오는데 년월 줄은 여전히
   * 화면 맨 위에 붙어 있어 둘이 겹친다.
   */
  inset?: SharedValue<number>;
  children: ReactNode;
}) {
  const scrollY = useScrollY();
  const { offsetOf, areaOf } = useScrollControl();
  const box = useRef<View>(null);
  /**
   * 굴리지 않았을 때 이 머리글이 서 있는 자리. 스크롤 내용 안에서의 y 다.
   *
   * 처음에는 무한대다 -- 아직 재지 못한 동안에는 어디에도 붙지 말아야 한다.
   */
  const anchor = useSharedValue(Number.POSITIVE_INFINITY);
  /** 덩어리의 높이. 제목 줄이 두 줄이 되거나 조건 알약이 붙으면 달라진다. */
  const height = useSharedValue(0);
  /** 1 이면 다 보이고 0 이면 다 비켜섰다. 그 사이는 움직이는 중이다. */
  const shown = useSharedValue(1);
  /** 지금 비켜서 있는가. 같은 곳으로 다시 움직이라고 시키지 않으려고 들고 있다. */
  const isHidden = useSharedValue(false);
  /** 같은 방향으로 이어서 구른 거리. 방향이 바뀌면 버린다. */
  const turned = useSharedValue(0);

  /*
   * 창 좌표로 재고 스크롤 내용의 좌표로 옮긴다. 화면 위쪽의 것(알림 줄 등)이 늘거나
   * 줄면 이 자리도 따라 바뀌므로 `onLayout` 이 올 때마다 다시 잰다.
   */
  const measure = useCallback(() => {
    box.current?.measureInWindow((_x, y) => {
      anchor.value = y - areaOf().top + offsetOf();
    });
  }, [anchor, areaOf, offsetOf]);

  useAnimatedReaction(
    () => scrollY.value,
    (y, previous) => {
      if (previous === null) return;
      const delta = y - previous;
      if (delta === 0) return;

      /*
       * 머리글이 아직 제자리에 서 있는 동안(맨 위 언저리)에는 비켜서지 않는다. 비켜서면
       * 제자리에 있는 것을 위로 밀어내 그 위의 것까지 가린다.
       */
      if (y <= height.value) {
        turned.value = 0;
        if (isHidden.value) {
          isHidden.value = false;
          shown.value = withTiming(1, TIMING);
        }
        return;
      }

      if ((delta > 0) !== (turned.value > 0)) turned.value = 0;
      turned.value += delta;

      if (turned.value > TURN && !isHidden.value) {
        isHidden.value = true;
        shown.value = withTiming(0, TIMING);
      } else if (turned.value < -TURN && isHidden.value) {
        isHidden.value = false;
        shown.value = withTiming(1, TIMING);
      }
    },
  );

  /* 되돌아와 있는 만큼을 밖으로 알린다. 아래의 붙박이 줄이 설 높이다. */
  useAnimatedReaction(
    () => shown.value * height.value,
    (revealed) => {
      if (inset) inset.value = revealed;
    },
  );

  const follow = useAnimatedStyle(() => {
    /** 제자리를 지나 굴러간 만큼. 이만큼 따라 내려와야 제자리에 남는다. */
    const stuck = Math.max(0, scrollY.value - anchor.value);
    /** 비켜선 만큼. 다 비켜서면 제 높이만큼 위로 올라가 화면 밖에 선다. */
    const away = (1 - shown.value) * height.value;
    return { transform: [{ translateY: Math.max(0, stuck - away) }] };
  });

  return (
    /*
     * 재는 상자와 움직이는 상자를 나눈다. 바깥은 제자리에 남아 아래 줄이 설 자리를
     * 지키고(빼면 붙는 순간 목록이 한 칸 위로 튄다), 안쪽만 따라 내려온다.
     *
     * `zIndex` 는 바깥에 준다. 형제 중에서 누가 위에 그려질지를 정하는 값이라, 움직이는
     * 안쪽에 주면 목록이 막대 위에 그려진다.
     */
    <View ref={box} onLayout={measure} style={{ zIndex: 10 }}>
      <Animated.View
        onLayout={(event) => {
          height.value = event.nativeEvent.layout.height;
        }}
        style={[{ backgroundColor: BACKGROUND, paddingVertical: PADDING }, follow]}
      >
        {children}
      </Animated.View>
    </View>
  );
}
