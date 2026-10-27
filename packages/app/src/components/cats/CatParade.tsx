import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useVisibleParade } from '@money/core/hooks/useCats';
import {
  CAT_PARADE_HEIGHT,
  CAT_SPRITE_WIDTH,
  catNameKey,
  catStartX,
  nextCatAction,
  type CatPose,
} from '@money/core/lib/cats';
import { useTranslation } from '@money/core/lib/i18n';
import { useProject } from '@money/core/store/project';

import CatArt from './CatArt';

/** 누르면 이름 말풍선이 떠 있는 시간. */
const BUBBLE_MS = 2200;

/**
 * 화면 아래를 걷는 고양이들. 웹의 `components/cats/CatParade` 와 같은 짝이다.
 *
 * 껍데기(AppShell)가 굴러가는 본문 상자의 아래 끝에 붙인다. 좁은 화면에서는 그 끝이 광고 배너·탭 막대의 윗변이고,
 * 넓은 화면(사이드바)에서는 화면 맨 아래다. 광고가 있는 가계부에서는 세우지 않는다(`useVisibleParade`).
 *
 * 줄은 손을 받지 않는다(box-none). 본문 위에 겹쳐 있어서, 받으면 그 밑의 마지막 줄을 누를 수 없다.
 */
export default function CatParade() {
  const projectId = useProject((state) => state.selectedProjectId);
  const parade = useVisibleParade(projectId);
  const [width, setWidth] = useState(0);
  /*
   * 넓은 화면(md 이상)에는 탭 막대가 없어 줄이 화면 맨 아래에 닿는다. 그 자리의 홈 표시줄 몫은 탭 막대 대신 여기서
   * 비운다. 좁은 화면은 탭 막대가 이미 비워 두었다.
   */
  const insets = useSafeAreaInsets();
  const isWide = useWindowDimensions().width >= 768;

  if (parade.length === 0) return null;
  const range = Math.max(0, width - CAT_SPRITE_WIDTH);

  return (
    <View
      pointerEvents="box-none"
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: isWide ? insets.bottom : 0,
        height: CAT_PARADE_HEIGHT,
      }}
    >
      {width > 0
        ? parade.map((breedId, index) => (
            <Walker key={breedId} breedId={breedId} startX={catStartX(index, parade.length, range)} range={range} />
          ))
        : null}
    </View>
  );
}

/**
 * 고양이 한 마리. 할 일(`nextCatAction`)을 하나 끝내면 다음 일을 고른다.
 *
 * 자리 옮김은 UI 실의 타이밍이 한다(`withTiming`). JS 는 할 일을 바꿀 때만 한 번 깬다. 움직임을 줄이는 설정이면
 * 걷지 않고 서거나 잠들기만 한다.
 */
function Walker({ breedId, startX, range }: { breedId: string; startX: number; range: number }) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const [pose, setPose] = useState<CatPose>('stand');
  const [facingRight, setFacingRight] = useState(true);
  const [bubble, setBubble] = useState(false);
  const x = useSharedValue(startX);
  const xRef = useRef(startX);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const reduceRef = useRef(reduceMotion);
  reduceRef.current = reduceMotion;

  const step = useRef<() => void>(() => {});
  step.current = () => {
    const width = rangeRef.current;
    const from = Math.min(xRef.current, width);
    const action = nextCatAction(from, width);
    if (action.kind === 'walk' && !reduceRef.current) {
      setFacingRight(action.toX >= from);
      setPose('walk');
      xRef.current = action.toX;
      x.value = withTiming(action.toX, { duration: action.ms, easing: Easing.linear });
      timer.current = setTimeout(() => step.current(), action.ms);
      return;
    }
    setPose(action.kind === 'sleep' ? 'sleep' : 'stand');
    timer.current = setTimeout(() => step.current(), action.kind === 'walk' ? 3000 : action.ms);
  };

  useEffect(() => {
    // 처음에는 잠깐 서 있다 움직인다. 여럿이 한꺼번에 출발하지 않게 조금씩 어긋난다.
    timer.current = setTimeout(() => step.current(), 600 + Math.random() * 1500);
    return () => {
      clearTimeout(timer.current);
      clearTimeout(bubbleTimer.current);
      cancelAnimation(x);
    };
  }, [x]);

  /* 화면 폭이 줄어(돌리기·창 나누기) 줄 밖에 서게 되면 안으로 들인다. */
  useEffect(() => {
    if (xRef.current > range) {
      xRef.current = range;
      cancelAnimation(x);
      x.value = range;
    }
  }, [range, x]);

  const moveStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  const onPress = () => {
    clearTimeout(bubbleTimer.current);
    setBubble(true);
    bubbleTimer.current = setTimeout(() => setBubble(false), BUBBLE_MS);
    // 잠든 고양이는 깨어 선다.
    if (pose === 'sleep') {
      clearTimeout(timer.current);
      setPose('stand');
      timer.current = setTimeout(() => step.current(), 2500);
    }
  };

  return (
    <Animated.View
      pointerEvents="box-none"
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(150)}
      style={[{ position: 'absolute', bottom: 0, left: 0, width: CAT_SPRITE_WIDTH }, moveStyle]}
    >
      {bubble ? (
        <Animated.View
          entering={FadeIn.duration(150)}
          exiting={FadeOut.duration(150)}
          pointerEvents="none"
          style={{ position: 'absolute', bottom: '100%', left: -40, right: -40, alignItems: 'center' }}
        >
          <Text numberOfLines={1} className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-gray-700 shadow">
            {t(catNameKey(breedId))}
          </Text>
        </Animated.View>
      ) : null}
      {pose === 'sleep' ? <Zzz /> : null}
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={t(catNameKey(breedId))}
        hitSlop={4}
        style={{ transform: [{ scaleX: facingRight ? 1 : -1 }] }}
      >
        <CatArt breedId={breedId} pose={pose} width={CAT_SPRITE_WIDTH} />
      </Pressable>
    </Animated.View>
  );
}

/** 잠든 고양이 위로 떠오르는 z. */
function Zzz() {
  const reduceMotion = useReducedMotion();
  const lift = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    lift.value = 0;
    lift.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }), -1, false);
    return () => cancelAnimation(lift);
  }, [lift, reduceMotion]);
  const style = useAnimatedStyle(() => ({
    opacity: lift.value < 0.3 ? lift.value / 0.3 : 1 - (lift.value - 0.3) / 0.7,
    transform: [{ translateX: lift.value * 6 }, { translateY: -lift.value * 14 }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: -4, right: 4 }, reduceMotion ? null : style]}>
      <Text className="text-[10px] font-bold text-blue-400">z</Text>
    </Animated.View>
  );
}
