/*
 * 길게 눌러 끌어 옮기는 목록.
 *
 * 앱에는 순서를 바꿀 곳이 셋이다 -- 자산(구성원·계좌·카드), 분류, 태그. 예전에는 수정
 * 모달 안의 "위로/아래로" 버튼뿐이라, 목록을 보면서 옮길 수가 없었다. 여기서는 줄을
 * 조금 길게 누르면 그 줄이 손끝을 따라오고, 지나간 자리의 줄들이 밀려나며 자리를 내준다.
 *
 * **제스처 라이브러리를 쓰지 않는다.** `react-native-gesture-handler` 를 넣으면 네이티브
 * 모듈이 늘어 gradle 을 다시 돌려야 하고, 앱을 새로 깔지 않은 기기에서는 빨간 화면이 뜬다.
 * `PanResponder` 는 순수 JS 라 그 대가가 없다.
 *
 * 자리를 옮기는 규칙은 화면이 정한다. 여기가 아는 것은 "몇 번째로 놓았다"까지다
 * (`onReorder`). 저장은 옮긴 줄의 값 하나만 보내는 쪽이 맞다 -- 목록 전체를 다시 쓰면
 * 그 사이 남이 옮긴 줄이 지워진다 (설계 문서의 D5).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PanResponder, Pressable, View } from 'react-native';
import { useCanEdit } from '@money/core/store/project';
import { useScrollControl } from '../shell/scroll';
import Animated, {
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

/** 이만큼 누르고 있으면 끌 수 있다. 짧으면 목록을 훑다가 잡히고, 길면 눌러도 안 잡힌다. */
const HOLD_MS = 220;

/** 줄이 자리를 내주는 데 걸리는 시간. 끄는 손보다 느리면 따라오지 못한 것처럼 보인다. */
const SHIFT_MS = 160;

/**
 * 화면 위아래 이만큼 안에 손끝이 들어오면 화면이 따라 굴러간다.
 *
 * 좁으면 화면 끝에 손가락을 붙여야 굴러가고(그러면 줄이 손가락에 가려 보이지 않는다),
 * 넓으면 목록 가운데를 지나기만 해도 굴러간다.
 */
const EDGE = 120;

/** 가장자리 맨 끝에서의 속도(픽셀/틱). 안쪽으로 갈수록 0 에 가까워진다. */
const SCROLL_MAX = 22;

/** 굴리는 간격. 화면 갱신과 비슷하게 둔다. */
const SCROLL_TICK_MS = 16;

interface DragListProps<T> {
  items: readonly T[];
  /** 놓은 뒤의 자리. 화면이 그 자리의 순서 값을 만들어 저장한다. */
  onReorder: (id: string, toIndex: number) => void;
  renderItem: (item: T, state: { isDragging: boolean }) => ReactNode;
  onPressItem?: (item: T) => void;
  /** 줄 사이 간격(px). 자리를 셀 때 줄 높이에 더한다. */
  gap?: number;
  /** 줄 하나의 겉모습. 화면마다 다르다. */
  itemClassName?: string;
  /** 끌 수 없게 한다. 저장 중이거나 줄이 하나뿐일 때 화면이 넘긴다. */
  disabled?: boolean;
}

export default function DragList<T extends { id: string }>({
  items,
  onReorder,
  renderItem,
  onPressItem,
  gap = 8,
  itemClassName,
  disabled = false,
}: DragListProps<T>) {
  /*
   * 읽기 전용 구성원은 끌지도, 줄을 눌러 고치지도 못한다.
   *
   * 여기서 한 번 막으면 자산·분류·태그의 목록이 모두 함께 잠긴다 -- 목록은 그대로
   * 읽히고 손댈 수 있는 것만 사라진다. 화면마다 같은 검사를 두지 않는 자리다.
   */
  const canEdit = useCanEdit();
  const locked = disabled || !canEdit;
  const pressItem = canEdit ? onPressItem : undefined;
  /*
   * 화면에 그리는 차례.
   *
   * 끄는 동안은 이 배열만 바꾼다. 서버에 보내는 것은 손을 뗄 때 한 번이다 -- 지나가는
   * 자리마다 보내면 왕복이 수십 번이 되고, 그 사이 도착한 응답이 손끝과 어긋난다.
   */
  const [order, setOrder] = useState<string[]>(() => items.map((item) => item.id));
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const orderRef = useRef(order);
  orderRef.current = order;
  const draggingRef = useRef<string | null>(null);
  /** 지금까지 지나온 줄들의 높이 합. 손끝과 줄을 붙여 두는 데 쓴다. */
  const shiftRef = useRef(0);
  const heightsRef = useRef(new Map<string, number>());

  const dragY = useSharedValue(0);
  const lift = useSharedValue(0);
  /*
   * 지금 끄는 줄. 상태가 아니라 shared value 로 든다.
   *
   * 스타일을 끄는 줄에만 붙였다 떼면 **뗀 뒤에도 마지막 값이 네이티브 뷰에 남는다**
   * (Reanimated 는 붙어 있는 동안 값을 직접 써 넣는다). 실제로 놓은 줄이 계속 조금
   * 커진 채로 남았다. 그래서 모든 줄에 스타일을 붙여 두고, 안쪽에서 제 차례인지 본다.
   */
  const activeId = useSharedValue<string | null>(null);
  /* 끄는 동안 껍데기의 스크롤을 빌린다 (shell/scroll 참고). */
  const scroll = useScrollControl();
  /** 끌기 시작할 때 화면이 내려와 있던 만큼. 그 뒤로 굴러간 양을 여기서 뺀다. */
  const scrollStartRef = useRef(0);
  /** 손끝이 마지막으로 알려 준 세로 이동량. 화면만 굴러갈 때도 이 값을 다시 쓴다. */
  const lastDyRef = useRef(0);
  const scrollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  /** 지금 굴리는 속도. 시계가 이 값을 읽으므로 매 틱 새로 걸지 않아도 된다. */
  const speedRef = useRef(0);

  /*
   * 목록 자체가 바뀌면(추가·삭제·동기화) 차례를 다시 맞춘다. 배열을 그대로 의존성에
   * 넣으면 렌더마다 새 배열이라 끝나지 않는다.
   */
  const itemsKey = items.map((item) => item.id).join(',');
  useEffect(() => {
    setOrder(items.map((item) => item.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey]);

  const ordered = useMemo(() => {
    const byId = new Map(items.map((item) => [item.id, item]));
    const rows = order.map((id) => byId.get(id)).filter((item): item is T => Boolean(item));
    // 아직 차례에 없는 새 줄은 뒤에 붙인다.
    const seen = new Set(order);
    return [...rows, ...items.filter((item) => !seen.has(item.id))];
  }, [items, order]);

  /** 줄 하나가 차지하는 세로 길이. 간격까지 넣어야 자리 계산이 화면과 맞는다. */
  const spanOf = (id: string) => (heightsRef.current.get(id) ?? 0) + gap;

  const start = useCallback(
    (id: string) => {
      draggingRef.current = id;
      shiftRef.current = 0;
      scrollStartRef.current = scroll.offsetOf();
      lastDyRef.current = 0;
      activeId.value = id;
      dragY.value = 0;
      lift.value = withTiming(1, { duration: 120 });
      scroll.lock(true);
      setDraggingId(id);
    },
    [activeId, dragY, lift, scroll],
  );

  /**
   * 지금까지 간 거리로 자리를 다시 잡는다.
   *
   * 거리는 **손끝이 간 것 + 화면이 굴러간 것**이다. 화면이 굴러가면 줄도 그만큼 함께
   * 흘러가므로, 그 몫을 더해 주지 않으면 손끝만 남고 줄은 위로 달아난다.
   */
  const apply = useCallback(
    () => {
      const id = draggingRef.current;
      if (!id) return;

      const travel = lastDyRef.current + (scroll.offsetOf() - scrollStartRef.current);

      let next = orderRef.current;
      let index = next.indexOf(id);
      // 지금 서 있는 자리에서 얼마나 더 갔는가.
      let offset = travel - shiftRef.current;

      // 아래로. 다음 줄의 절반을 넘어서면 그 줄과 자리를 바꾼다.
      while (index < next.length - 1) {
        const span = spanOf(next[index + 1]);
        if (span === 0 || offset <= span / 2) break;
        next = swap(next, index, index + 1);
        shiftRef.current += span;
        offset -= span;
        index += 1;
      }

      // 위로. 같은 규칙을 거꾸로 본다.
      while (index > 0) {
        const span = spanOf(next[index - 1]);
        if (span === 0 || offset >= -span / 2) break;
        next = swap(next, index, index - 1);
        shiftRef.current -= span;
        offset += span;
        index -= 1;
      }

      if (next !== orderRef.current) {
        orderRef.current = next;
        setOrder(next);
      }

      /*
       * 자리가 바뀌면 이 줄이 서는 곳도 그만큼 옮겨간다. 지나온 높이를 빼 두어야 손끝에
       * 붙어 있는다 -- 빼지 않으면 자리를 바꿀 때마다 줄이 한 칸씩 튄다.
       */
      dragY.value = travel - shiftRef.current;
    },
    // spanOf 는 ref 만 읽는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dragY, scroll],
  );

  const stopAutoScroll = useCallback(() => {
    if (scrollTimer.current) clearInterval(scrollTimer.current);
    scrollTimer.current = null;
  }, []);

  /**
   * 손끝이 가장자리에 있으면 화면을 굴린다.
   *
   * 손가락이 멈춰 있어도 굴러가야 하므로 시계로 돈다. 굴린 뒤에는 자리를 다시 잡는다 --
   * 화면만 움직이고 줄은 가만히 있으면 손끝에서 떨어진다.
   */
  const autoScroll = useCallback(
    (screenY: number) => {
      if (!scroll.canScroll) return;

      const { top, height } = scroll.areaOf();
      const fromTop = screenY - top;
      const fromBottom = top + height - screenY;

      const speed =
        fromTop < EDGE
          ? -SCROLL_MAX * Math.min(1, (EDGE - fromTop) / EDGE)
          : fromBottom < EDGE
            ? SCROLL_MAX * Math.min(1, (EDGE - fromBottom) / EDGE)
            : 0;

      // 속도를 먼저 적는다. 시계는 이 값을 읽으므로 매 틱 새로 걸 필요가 없다.
      speedRef.current = speed;

      if (speed === 0) {
        stopAutoScroll();
        return;
      }

      if (scrollTimer.current) return;
      scrollTimer.current = setInterval(() => {
        scroll.scrollBy(speedRef.current);
        apply();
      }, SCROLL_TICK_MS);
    },
    [apply, scroll, stopAutoScroll],
  );

  const move = useCallback(
    (dy: number, screenY: number) => {
      lastDyRef.current = dy;
      apply();
      autoScroll(screenY);
    },
    [apply, autoScroll],
  );

  const end = useCallback(() => {
    const id = draggingRef.current;
    draggingRef.current = null;
    stopAutoScroll();
    setDraggingId(null);
    scroll.lock(false);
    lift.value = withTiming(0, { duration: 120 });
    dragY.value = withTiming(0, { duration: SHIFT_MS });
    activeId.value = null;
    shiftRef.current = 0;
    if (!id) return;

    const from = items.findIndex((item) => item.id === id);
    const to = orderRef.current.indexOf(id);
    if (to >= 0 && to !== from) onReorder(id, to);
  }, [activeId, dragY, items, lift, scroll, stopAutoScroll, onReorder]);

  /* 화면을 떠나는 순간에도 시계가 남지 않게 한다. */
  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  return (
    <View style={{ gap }}>
      {ordered.map((item) => (
        <DragRow
          key={item.id}
          id={item.id}
          isDragging={draggingId === item.id}
          disabled={locked || items.length < 2}
          activeId={activeId}
          dragY={dragY}
          lift={lift}
          className={itemClassName}
          onMeasure={(height) => heightsRef.current.set(item.id, height)}
          onStart={start}
          onMove={move}
          onEnd={end}
          onPress={pressItem ? () => pressItem(item) : undefined}
        >
          {renderItem(item, { isDragging: draggingId === item.id })}
        </DragRow>
      ))}
    </View>
  );
}

function swap(ids: readonly string[], from: number, to: number): string[] {
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * 줄 하나.
 *
 * 누르는 순간에는 아무것도 가져가지 않는다(`onTouchStart` 로 시계만 잰다). 그래야 짧게
 * 누른 것이 여느 때처럼 탭으로 간다. 시계가 다 돌면 그때부터 움직임을 가로챈다
 * (`onMoveShouldSetPanResponderCapture`) -- capture 쪽이라 안에 있는 버튼보다 먼저 본다.
 */
function DragRow({
  id,
  isDragging,
  disabled,
  activeId,
  dragY,
  lift,
  className,
  children,
  onMeasure,
  onStart,
  onMove,
  onEnd,
  onPress,
}: {
  id: string;
  isDragging: boolean;
  disabled: boolean;
  activeId: SharedValue<string | null>;
  dragY: SharedValue<number>;
  lift: SharedValue<number>;
  className?: string;
  children: ReactNode;
  onMeasure: (height: number) => void;
  onStart: (id: string) => void;
  onMove: (dy: number, screenY: number) => void;
  onEnd: () => void;
  onPress?: () => void;
}) {
  /** 길게 눌러 잡힌 상태인가. 렌더와 상관없어 ref 로 든다. */
  const armedRef = useRef(false);
  /** 실제로 끌었는가. 끌고 나서 손을 떼면 탭으로 치지 않는다. */
  const draggedRef = useRef(false);
  /**
   * 이번 누름을 탭으로 치지 않는다.
   *
   * 손을 뗄 때 `onTouchEnd` 와 Pressable 의 onPress 중 어느 것이 먼저인지는 정해져 있지
   * 않다. 그래서 잡히는 순간 표를 세워 두고, 다음 누름이 시작될 때 내린다.
   */
  const blockPressRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* 제 차례가 아니면 아무것도 하지 않는 스타일. 늘 붙어 있어야 값이 남지 않는다. */
  const style = useAnimatedStyle(() => {
    const isActive = activeId.value === id;

    return {
      transform: [
        { translateY: isActive ? dragY.value : 0 },
        { scale: isActive ? 1 + lift.value * 0.03 : 1 },
      ],
      // 끄는 줄이 이웃 위로 올라와야 어디 있는지 보인다.
      zIndex: isActive ? 10 : 0,
      elevation: isActive ? lift.value * 6 : 0,
      opacity: isActive ? 1 - lift.value * 0.06 : 1,
    };
  });

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: () => armedRef.current,
      onPanResponderMove: (_event, gesture) => {
        draggedRef.current = true;
        // moveY 는 화면에서의 자리다. 가장자리에 닿았는지 보는 데 쓴다.
        onMove(gesture.dy, gesture.moveY);
      },
      onPanResponderRelease: () => {
        armedRef.current = false;
        onEnd();
      },
      onPanResponderTerminate: () => {
        armedRef.current = false;
        onEnd();
      },
      // 안쪽 버튼이 도중에 제스처를 도로 가져가지 못하게 한다.
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;

  useEffect(() => clearTimer, []);

  return (
    <Animated.View
      /*
       * 끄는 줄에는 자리 애니메이션을 걸지 않는다. 손끝을 따라 매 프레임 옮기는 줄까지
       * 부드럽게 만들면 손보다 뒤처져 보인다. 자리를 내주는 이웃들만 미끄러진다.
       */
      layout={isDragging ? undefined : LinearTransition.duration(SHIFT_MS)}
      style={style}
      onLayout={(event) => onMeasure(event.nativeEvent.layout.height)}
      onTouchStart={(event) => {
        /*
         * 안쪽 목록이 이긴다.
         *
         * 자산 화면은 목록이 겹쳐 있다 -- 구성원 안에 계좌, 계좌 안에 카드. 손가락이 카드
         * 위에 있으면 카드가 움직여야 하는데, 누름은 위로 퍼져 올라가 바깥 줄의 시계까지
         * 함께 돌린다. 그러면 붙잡기는 바깥이 먼저 하고(capture 는 바깥부터 묻는다) 카드
         * 대신 구성원 카드가 통째로 끌려간다. 여기서 끊어 안쪽만 잡히게 한다.
         */
        event.stopPropagation();
        blockPressRef.current = false;
        if (disabled) return;
        draggedRef.current = false;
        clearTimer();
        timerRef.current = setTimeout(() => {
          armedRef.current = true;
          blockPressRef.current = true;
          onStart(id);
        }, HOLD_MS);
      }}
      /*
       * 잡아 두기만 하고 움직이지 않은 채 손을 뗐다. 이때는 제스처가 시작된 적이 없어
       * PanResponder 의 release 가 오지 않으므로 여기서 내려놓는다.
       */
      onTouchEnd={() => {
        clearTimer();
        if (armedRef.current && !draggedRef.current) {
          armedRef.current = false;
          onEnd();
        }
      }}
      onTouchCancel={() => {
        clearTimer();
        if (armedRef.current) {
          armedRef.current = false;
          onEnd();
        }
      }}
      {...responder.panHandlers}
    >
      <Pressable
        className={className}
        onPress={() => {
          /*
           * 끌고 나서 손을 뗀 것은 탭이 아니다. 길게 누르기만 하고 움직이지 않은 것도
           * 마찬가지다 -- 옮기려다 만 것이지 열어 보려던 것이 아니다.
           */
          if (blockPressRef.current) return;
          onPress?.();
        }}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
