import { useEffect, useRef, type ReactNode } from 'react';
import {
  Modal as RNModal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

import { useTranslation } from '@money/core/lib/i18n';

/** 뒤 막의 짙기. 끌어 내리는 동안 이 값에서 0 까지 옅어진다. */
const DIM = 0.5;

/** max-w-md 와 같은 폭(28rem). 넓은 화면에서 가운데에 뜨는 창이 쓴다. */
const WIDE_WIDTH = 448;

/** 이만큼(px) 넘게 내렸으면 손을 떼는 순간 닫는다. 그 아래면 제자리로 돌아간다. */
const DISMISS_DISTANCE = 96;

/**
 * 짧게 튕겨도 닫는 속도(px/ms).
 *
 * 거리만 보면, 빠르게 아래로 쳐 낸 손(많이 내려가기 전에 떼는 손)이 닫히지 않는다.
 * 사람이 "내려 보냈다"고 느끼는 것은 거리가 아니라 마지막 속도다.
 */
const FLICK_VELOCITY = 0.6;

/** 손가락이 이만큼 내려가기 전에는 잡지 않는다. 머리글의 단추를 누른 손이 삼켜지지 않게 한다. */
const TOUCH_SLOP = 6;

/** 손을 뗀 뒤 제자리로 돌아가거나 마저 내려가는 데 걸리는 시간(ms). */
const SETTLE_MS = 200;

/**
 * 팝업. 웹의 것과 같은 모양이다.
 *
 * 검은 막 위에 흰 상자를 띄우고, 머리글과 하단 버튼 자리는 붙박이로 두어 본문이
 * 길어도 닫기와 저장이 늘 보인다. 뒤로가기는 화면을 나가지 않고 이 팝업을 닫는다
 * (RNModal 의 onRequestClose).
 *
 * **좁은 화면에서는 아래에서 올라와 아래에 붙는다.** 손이 닿는 자리가 화면 아래쪽이라
 * 거기서 올라와 거기에 서는 창이 누르기도 닫기도 가깝다. 태블릿처럼 넓은 화면에서는
 * 폭을 다 쓸 까닭이 없으므로 가운데에 뜬다 (웹과 같은 자리에서 갈린다).
 *
 * **아래에 붙는 창은 윗부분을 잡아 내려서 닫는다.** 올라온 것은 내려서 보내는 것이
 * 손에 맞다. 닫기 단추는 머리글 오른쪽 끝, 화면 위쪽에 있어 한 손으로는 멀다. 잡는
 * 자리는 손잡이 막대와 머리글이고, 끄는 동안 창이 손끝을 따라오며 뒤 막이 옅어진다.
 * 조금만 내리고 놓으면 제자리로 돌아온다.
 *
 * 줄을 눌러 여는 거래 상세도 이 창을 쓴다. 클릭해서 여는 자리가 저마다 다른 모양으로
 * 나타나면 화면마다 닫는 길을 다시 찾아야 한다.
 */
export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  headerAction,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * 머리글 오른쪽, 닫기 앞에 서는 단추.
   *
   * 팝업 전체에 걸리는 일(예: 상세의 내용 복사)을 두는 자리다. 본문에 두면 스크롤에
   * 밀려 보이지 않고, 하단 버튼 자리는 그 팝업의 본론(저장·삭제)이 쓴다.
   */
  headerAction?: ReactNode;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  /* 768 은 웹 Tailwind 의 md 다. 두 화면이 같은 폭에서 같은 모양으로 갈리게 둔다. */
  const isWide = width >= 768;

  /** 지금 내려간 거리. 손끝을 따라가고, 손을 떼면 0 이나 창 높이로 간다. */
  const dragY = useSharedValue(0);
  /**
   * 창의 높이.
   *
   * 닫을 때 보낼 거리이자 뒤 막이 옅어지는 기준이다. 재기 전에는 화면 높이로 둔다 --
   * 첫 프레임에 손이 닿을 일은 없지만, 0 으로 두면 그 사이에 나누기가 무너진다.
   */
  const sheetHeight = useSharedValue(height);

  /*
   * 제스처가 볼 값들은 여기 갈아 끼운다.
   *
   * PanResponder 는 아래에서 한 번만 만든다. 그러면 그때 잡은 함수가 계속 남아 첫
   * 렌더의 onClose 를 부르고, 화면을 돌려 넓어져도 여전히 잡으려 든다 (DragList 와
   * 같은 까닭).
   */
  const latest = useRef({ onClose, canDrag: !isWide });
  latest.current = { onClose, canDrag: !isWide };

  const responder = useRef(
    PanResponder.create({
      /*
       * 움직이기 시작할 때만 잡는다(should**Move**Set).
       *
       * 누르는 순간 잡으면 머리글 안의 닫기·헤더 단추가 눌리지 않는다. 아래로 가는
       * 손만 받는 것도 같은 까닭이다 -- 옆으로 스치는 손까지 잡을 일이 없다.
       */
      onMoveShouldSetPanResponder: (_event, gesture) =>
        latest.current.canDrag && gesture.dy > TOUCH_SLOP && gesture.dy > Math.abs(gesture.dx),
      onPanResponderMove: (_event, gesture) => {
        // 위로는 따라가지 않는다. 올릴 자리가 없는 창이라 따라 올리면 위가 뜬다.
        dragY.value = Math.max(0, gesture.dy);
      },
      onPanResponderRelease: (_event, gesture) => {
        const close = latest.current.onClose;
        if (gesture.dy > DISMISS_DISTANCE || gesture.vy > FLICK_VELOCITY) {
          dragY.value = withTiming(
            sheetHeight.value,
            { duration: SETTLE_MS, easing: Easing.in(Easing.quad) },
            (finished) => {
              // 다 내려간 뒤에 닫는다. 먼저 닫으면 창이 사라진 자리를 애니메이션이 그린다.
              if (finished) runOnJS(close)();
            },
          );
          return;
        }
        dragY.value = withTiming(0, { duration: SETTLE_MS, easing: Easing.out(Easing.quad) });
      },
      // 다른 것이 제스처를 가져갔다(화면 회전 등). 창은 제자리로 돌려놓는다.
      onPanResponderTerminate: () => {
        dragY.value = withTiming(0, { duration: SETTLE_MS, easing: Easing.out(Easing.quad) });
      },
    }),
  ).current;

  /* 다시 열 때는 제자리에서 시작한다. 끌어 닫은 자리가 남아 있으면 창이 화면 밖에서 뜬다. */
  useEffect(() => {
    if (isOpen) dragY.value = 0;
  }, [isOpen, dragY]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
  }));

  /* 창이 내려간 만큼 뒤가 밝아진다. 내리는 손이 닫는 손이라는 것을 뒤 막도 같이 말한다. */
  const dimStyle = useAnimatedStyle(() => {
    const gone = Math.min(1, dragY.value / Math.max(1, sheetHeight.value));
    return { opacity: DIM * (1 - gone) };
  });

  const header = (
    <View className="flex-row items-center justify-between gap-3 border-b border-gray-200 px-6 py-4">
      <Text numberOfLines={1} className="flex-1 text-lg font-bold text-gray-900">
        {title}
      </Text>
      <View className="flex-row items-center gap-4">
        {headerAction}
        {/*
          닫기. 글자 "×" 가 아니라 아이콘이다.

          글자로 두면 그 칸 안에서 글자가 어디에 놓이는지를 글꼴이 정한다. ×(곱셈
          기호)의 먹은 글자 가운데가 아니라 수학 축 언저리에 그려지고, 안드로이드는
          글꼴이 시키는 위아래 여백까지 더한다. 그래서 같은 크기의 네모에 넣어도
          옆의 아이콘과 한 축에 서지 않는다. 같은 방식으로 그려지는 아이콘으로 두면
          넷이 한 줄에 선다.
        */}
        <Pressable
          onPress={onClose}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          className="h-8 w-8 items-center justify-center rounded-lg active:bg-gray-100"
        >
          <X size={20} color="#6b7280" />
        </Pressable>
      </View>
    </View>
  );

  return (
    /* 좁은 화면에서는 밀려 올라오고, 넓은 화면에서는 제자리에 떠오른다. */
    <RNModal
      visible={isOpen}
      transparent
      animationType={isWide ? 'fade' : 'slide'}
      onRequestClose={onClose}
    >
      <View className={`flex-1 ${isWide ? 'items-center justify-center px-4' : 'justify-end'}`}>
        {/* 뒤 막. 끌면 옅어져야 해서 클래스(bg-black/50)가 아니라 움직이는 값으로 칠한다. */}
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: '#000000' }, dimStyle]}
        />

        {/*
          자리와 움직임만 맡는 바깥 상자. 모양(색·모서리·그림자)은 안쪽이 낸다.
          nativewind 의 className 을 Animated.View 에 얹지 않기 위해서다.
        */}
        <Animated.View
          onLayout={(event) => {
            sheetHeight.value = event.nativeEvent.layout.height;
          }}
          style={[
            { width: '100%', maxHeight: '90%' },
            isWide ? { maxWidth: WIDE_WIDTH } : sheetStyle,
          ]}
        >
          <View
            /* shrink: 본문이 길면 90% 안으로 줄어든다. 줄어들지 않으면 ScrollView 가
               내용만큼 늘어나 하단 버튼 자리가 상자 밖으로 밀려난다. */
            className={`shrink overflow-hidden bg-white shadow-lg ${
              // 아래에 붙는 창은 위쪽 모서리만 둥글다. 아래는 화면 끝이라 둥글릴 자리가 없다.
              isWide ? 'rounded-lg' : 'rounded-t-2xl'
            }`}
          >
            {/* 잡아 내리는 자리. 손잡이 막대와 머리글이 한 덩어리다. */}
            <View {...(isWide ? {} : responder.panHandlers)}>
              {isWide ? null : (
                /*
                  손잡이 막대.

                  끌 수 있다는 것은 눌러 보기 전에는 보이지 않는다. 아래에 붙는 창마다
                  같은 자리에 같은 막대를 두어, 한 번 배운 손이 다음 창에서도 통하게 한다.
                */
                <View className="items-center pb-1 pt-2">
                  <View className="h-1 w-10 rounded-full bg-gray-300" />
                </View>
              )}
              {header}
            </View>

            <ScrollView
              contentContainerClassName="p-6"
              /* 홈 표시줄 자리. 아래에 붙는 창이라 마지막 줄이 그 밑으로 들어가지 않게 한다. */
              contentContainerStyle={isWide ? undefined : { paddingBottom: 24 + insets.bottom }}
            >
              {children}
            </ScrollView>

            {footer ? (
              <View
                className="border-t border-gray-200 px-6 py-4"
                style={isWide ? undefined : { paddingBottom: 16 + insets.bottom }}
              >
                {footer}
              </View>
            ) : null}
          </View>
        </Animated.View>
      </View>
    </RNModal>
  );
}
