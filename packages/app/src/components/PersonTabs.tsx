import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Plus } from 'lucide-react-native';

import { useTranslation } from '@money/core/lib/i18n';
import type { Person } from '@money/core/lib/types';
import { useCanEdit } from '@money/core/store/project';

/** 이만큼 누르고 있으면 끌 수 있다. `DragList` 와 같은 값이다. */
const HOLD_MS = 220;

/** 자리를 내주는 탭이 미끄러지는 시간. 끄는 손보다 느리면 따라오지 못한 것처럼 보인다. */
const SHIFT_MS = 160;

/** 탭 하나가 선 자리. 밑줄과 옮길 거리를 이 값으로 센다. */
interface Span {
  x: number;
  width: number;
}

/**
 * 자산 목록 위의 사람 탭. 웹의 `PersonTabs` 와 같다.
 *
 * 구성원이 둘만 되어도 목록이 한 화면을 넘어, 두 번째 사람의 통장을 보려면 첫 사람의
 * 카드를 통째로 지나쳐 내려가야 했다. 여기서는 늘 한 사람의 카드만 보여 주고, 다른
 * 사람은 탭으로 건너간다.
 *
 * **위의 총자산과 추이 그래프는 건드리지 않는다.** 그쪽은 제목(`PersonScopeTitle`)에서
 * 고른 자산주인 전체의 값이다. 이 탭은 보고 있는 범위를 바꾸는 것이 아니라 긴 목록에서
 * 한 사람에게 바로 가는 길이라, 둘이 같은 일을 하면 어느 것이 범위를 정하는지 흐려진다.
 *
 * 구성원 추가도 이 줄의 오른쪽 끝에 함께 선다. 목록 위에 점선 버튼을 따로 두면 탭 줄과
 * 버튼이 띠 두 개로 쌓여, 정작 사람 이름이 그만큼 아래로 밀린다.
 *
 * 탭 차례가 곧 구성원 차례다. 조금 길게 누르면 탭이 손끝을 따라오고, 지나간 자리의 탭들이
 * 밀려나며 자리를 내준다. **`DragList` 를 쓰지 않는다** -- 그쪽은 세로로 쌓인 줄의 높이를
 * 재고 끄는 동안 화면을 굴리는데, 여기는 가로로 선 줄이고 제 스크롤 안에 있다. 잡는 법
 * (길게 누르기, 220ms)과 저장하는 법(놓은 자리 하나만 보낸다)은 같게 맞췄다.
 */
export default function PersonTabs({
  people,
  selectedId,
  onSelect,
  onAddPerson,
  onReorder,
}: {
  people: Person[];
  /** 고른 사람. 구성원이 아직 없을 때만 null 이다. */
  selectedId: string | null;
  onSelect: (personId: string) => void;
  onAddPerson: () => void;
  /** 끌어서 놓은 자리. 옮긴 탭 하나만 보낸다 (목록의 끌기와 같은 규칙, 설계 문서의 D5). */
  onReorder: (personId: string, toIndex: number) => void;
}) {
  const { t } = useTranslation();
  /* 읽기 전용 구성원에게는 더하기 탭도, 끌기도 없다 (`AddButton` 과 같은 규칙). */
  const canEdit = useCanEdit();

  /*
   * 혼자인 가계부에는 고를 것이 없다. 건너갈 데가 없는 탭 하나를 세우면 누를 수 있는
   * 것처럼 보이기만 하므로, 그때는 더하기 탭만 남긴다.
   */
  const tabs = people.length > 1 ? people : [];

  /*
   * 끄는 동안 쓰는 차례.
   *
   * 끄는 동안은 이 배열만 바꾸고, 서버에는 손을 뗄 때 한 번 보낸다. 지나가는 자리마다
   * 보내면 왕복이 수십 번이 되고 그 사이 도착한 응답이 손끝과 어긋난다 (`DragList`).
   */
  const [order, setOrder] = useState<string[]>(() => tabs.map((person) => person.id));
  const tabsKey = tabs.map((person) => person.id).join(',');
  useEffect(() => {
    setOrder(tabsKey ? tabsKey.split(',') : []);
  }, [tabsKey]);

  const byId = new Map(tabs.map((person) => [person.id, person]));
  const ordered = [
    ...order.map((id) => byId.get(id)).filter((person): person is Person => Boolean(person)),
    // 아직 차례에 없는 새 탭은 뒤에 붙인다.
    ...tabs.filter((person) => !order.includes(person.id)),
  ];

  /** 지금 그려져 있는 차례. 제스처가 클로저 대신 이것을 본다. */
  const orderRef = useRef<string[]>([]);
  orderRef.current = ordered.map((person) => person.id);

  /*
   * 탭마다 그려진 자리. 밑줄이 어디로 갈지, 끄는 탭이 몇 번째로 가는지를 이 값으로 센다.
   *
   * 글자 길이가 이름마다 달라 미리 적어 둘 수 없다. 그려진 뒤 재고, 이름이나 차례가
   * 바뀌면 다시 온다. 끄는 동안은 자리를 transform 으로만 옮기므로 이 값이 흔들리지
   * 않는다 -- 재던 값이 움직이면 놓을 자리가 손끝을 따라 달아난다.
   */
  const [spans, setSpans] = useState<Record<string, Span>>({});
  const spansRef = useRef(spans);
  spansRef.current = spans;

  const measure = (id: string) => (event: LayoutChangeEvent) => {
    const { x, width } = event.nativeEvent.layout;

    setSpans((prev) => {
      const before = prev[id];
      // 같은 자리면 있던 표를 그대로 둔다. 새 객체를 넣으면 공연히 다시 그린다.
      if (before && before.x === x && before.width === width) return prev;
      return { ...prev, [id]: { x, width } };
    });
  };

  /*
   * 탭마다의 옮긴 거리. 끄는 탭은 손끝을, 나머지는 내준 자리를 담는다.
   *
   * 한 통에 담아 두면 끄는 탭도 이웃도 같은 값 하나로 그려진다 -- 그리는 쪽에서 "내가
   * 끄는 탭인가"를 따져 스타일을 갈아 끼우지 않아도 된다.
   */
  const offsets = useRef(new Map<string, Animated.Value>()).current;
  const offsetOf = (id: string) => {
    const before = offsets.get(id);
    if (before) return before;

    const made = new Animated.Value(0);
    offsets.set(id, made);
    return made;
  };
  /** 고른 탭이 없을 때 밑줄이 볼 값. 0 에 머문다. */
  const noOffset = useRef(new Animated.Value(0)).current;

  const [dragId, setDragId] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);
  /** 지금 손끝 자리로 정해진 차례. 손을 뗄 때 이것을 쓴다. */
  const plannedRef = useRef<string[]>([]);

  /**
   * 지금 손끝 자리로 정해지는 차례.
   *
   * 탭마다 폭이 달라 "몇 칸 갔나"로는 셀 수 없다. 끄는 탭을 뺀 나머지를 왼쪽부터 쌓아
   * 보며, 끄는 탭의 왼끝이 어느 이음매에 가장 가까운지로 자리를 고른다.
   */
  const orderFor = (dx: number): string[] => {
    const id = dragIdRef.current;
    if (!id) return orderRef.current;

    const measured = spansRef.current;
    const rest = orderRef.current.filter((key) => key !== id);
    const left = (measured[id]?.x ?? 0) + dx;

    let at = 0;
    let best = 0;
    let bestGap = Infinity;
    for (let index = 0; index <= rest.length; index += 1) {
      const gap = Math.abs(at - left);
      if (gap < bestGap) {
        bestGap = gap;
        best = index;
      }
      if (index < rest.length) at += measured[rest[index]]?.width ?? 0;
    }

    const next = [...rest];
    next.splice(best, 0, id);
    return next;
  };

  /** 그 차례대로 섰을 때 탭마다 얼마나 옮겨 앉아야 하는지. 끄는 탭은 손끝이 정한다. */
  const shiftTo = (next: string[]) => {
    const measured = spansRef.current;
    let at = 0;

    for (const key of next) {
      const span = measured[key];
      if (key !== dragIdRef.current) {
        Animated.timing(offsetOf(key), {
          toValue: at - (span?.x ?? 0),
          duration: SHIFT_MS,
          useNativeDriver: true,
        }).start();
      }
      at += span?.width ?? 0;
    }
  };

  const start = (id: string) => {
    dragIdRef.current = id;
    plannedRef.current = orderRef.current;
    offsetOf(id).setValue(0);
    setDragId(id);
  };

  const move = (dx: number) => {
    const id = dragIdRef.current;
    if (!id) return;

    offsetOf(id).setValue(dx);

    const next = orderFor(dx);
    if (next.join(',') === plannedRef.current.join(',')) return;

    plannedRef.current = next;
    shiftTo(next);
  };

  const end = () => {
    const id = dragIdRef.current;
    const next = plannedRef.current;
    dragIdRef.current = null;
    plannedRef.current = [];
    setDragId(null);

    /*
     * 옮긴 자리는 새 차례가 그린다. 옮긴 거리는 전부 0 으로 되돌린다 -- 같은 그리기에서
     * 둘이 함께 바뀌므로 탭이 제자리로 튀었다 오지 않는다.
     */
    for (const value of offsets.values()) value.setValue(0);
    if (!id || next.length === 0) return;

    const from = orderRef.current.indexOf(id);
    const to = next.indexOf(id);
    if (to < 0 || to === from) return;

    orderRef.current = next;
    setOrder(next);
    onReorder(id, to);
  };

  return (
    <View className="mb-3 border-b border-gray-200">
      {/*
        사람이 많으면 한 줄에 다 서지 못한다. 글자를 줄이는 대신 옆으로 넘겨 본다 --
        이름을 줄이면 "김…"만 남아 어느 탭인지 알 수 없다. 더하기 탭도 이 줄 안에 있어
        끝까지 밀면 따라 나온다.

        끄는 동안에는 넘기기를 멈춘다. 켜 둔 채로는 같은 손짓을 줄과 스크롤이 함께
        가져가려 해서, 탭이 손끝을 놓치거나 줄이 통째로 흘러간다.
      */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} scrollEnabled={dragId === null}>
        <View className="flex-row">
          {ordered.map((person) => (
            <Tab
              key={person.id}
              person={person}
              isActive={person.id === selectedId}
              isDragging={dragId === person.id}
              disabled={!canEdit}
              offset={offsetOf(person.id)}
              onLayout={measure(person.id)}
              onPress={() => onSelect(person.id)}
              onStart={() => start(person.id)}
              onMove={move}
              onEnd={end}
            />
          ))}

          {canEdit ? (
            <>
              {/* 고르는 탭과 더하는 탭 사이의 금. 둘이 같은 무게로 읽히지 않게 한다. */}
              {ordered.length > 0 ? <View className="my-2 w-px bg-gray-200" /> : null}

              <Pressable
                onPress={onAddPerson}
                className="flex-row items-center gap-1.5 px-4 py-2 active:opacity-70"
              >
                <Plus size={16} color="#6b7280" />
                <Text className="text-sm text-gray-500">{t('person.add')}</Text>
              </Pressable>
            </>
          ) : null}

          <Underline
            span={selectedId ? spans[selectedId] : undefined}
            offset={selectedId ? offsetOf(selectedId) : noOffset}
          />
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * 탭 하나.
 *
 * 누르는 순간에는 아무것도 가져가지 않는다(`onTouchStart` 로 시계만 잰다). 그래야 짧게
 * 누른 것이 여느 때처럼 탭 고르기로 간다. 시계가 다 돌면 그때부터 움직임을 가로챈다
 * (`onMoveShouldSetPanResponderCapture`) -- `DragList` 의 줄과 같은 짜임이다.
 */
function Tab({
  person,
  isActive,
  isDragging,
  disabled,
  offset,
  onLayout,
  onPress,
  onStart,
  onMove,
  onEnd,
}: {
  person: Person;
  isActive: boolean;
  isDragging: boolean;
  disabled: boolean;
  offset: Animated.Value;
  onLayout: (event: LayoutChangeEvent) => void;
  onPress: () => void;
  onStart: () => void;
  onMove: (dx: number) => void;
  onEnd: () => void;
}) {
  /** 길게 눌러 잡힌 상태인가. 렌더와 상관없어 ref 로 든다. */
  const armed = useRef(false);
  /** 실제로 끌었는가. 끌고 나서 손을 떼면 고르기로 치지 않는다. */
  const dragged = useRef(false);
  /**
   * 이번 누름을 고르기로 치지 않는다.
   *
   * 손을 뗄 때 `onTouchEnd` 와 Pressable 의 onPress 중 어느 것이 먼저인지는 정해져 있지
   * 않다. 잡히는 순간 표를 세워 두고 다음 누름이 시작될 때 내린다 (`DragList` 와 같다).
   */
  const blockPress = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
   * 제스처가 부를 함수들. 렌더마다 여기 갈아 끼운다.
   *
   * `PanResponder` 는 아래에서 한 번만 만든다. 그러면 그때 잡은 함수가 계속 남아 처음의
   * 값들을 보고 일한다 -- 두 번째 끌기부터 자리가 저장되지 않는 까닭이다 (`DragList`).
   */
  const handlers = useRef({ onMove, onEnd });
  handlers.current = { onMove, onEnd };

  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: () => armed.current,
      onPanResponderMove: (_event, gesture) => {
        dragged.current = true;
        handlers.current.onMove(gesture.dx);
      },
      onPanResponderRelease: () => {
        armed.current = false;
        handlers.current.onEnd();
      },
      onPanResponderTerminate: () => {
        armed.current = false;
        handlers.current.onEnd();
      },
      // 안쪽 버튼이나 스크롤이 도중에 제스처를 도로 가져가지 못하게 한다.
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;

  /** 잡힌 탭은 살짝 커져 이웃 위로 올라온다. 무엇을 들고 있는지가 보여야 한다. */
  const lift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(lift, {
      toValue: isDragging ? 1 : 0,
      duration: 120,
      useNativeDriver: true,
    }).start();
  }, [isDragging, lift]);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => clearTimer, []);

  return (
    <Animated.View
      style={{
        transform: [
          { translateX: offset },
          { scale: lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) },
        ],
        zIndex: isDragging ? 10 : 0,
      }}
      onLayout={onLayout}
      onTouchStart={() => {
        blockPress.current = false;
        if (disabled) return;

        dragged.current = false;
        clearTimer();
        timer.current = setTimeout(() => {
          armed.current = true;
          blockPress.current = true;
          onStart();
        }, HOLD_MS);
      }}
      /*
       * 잡아 두기만 하고 움직이지 않은 채 손을 뗐다. 이때는 제스처가 시작된 적이 없어
       * PanResponder 의 release 가 오지 않으므로 여기서 내려놓는다.
       */
      onTouchEnd={() => {
        clearTimer();
        if (armed.current && !dragged.current) {
          armed.current = false;
          handlers.current.onEnd();
        }
      }}
      onTouchCancel={() => {
        clearTimer();
        if (armed.current) {
          armed.current = false;
          handlers.current.onEnd();
        }
      }}
      {...responder.panHandlers}
    >
      <Pressable
        onPress={() => {
          if (blockPress.current) {
            blockPress.current = false;
            return;
          }
          onPress();
        }}
        className="px-4 py-2 active:opacity-70"
      >
        <Text className={`text-sm font-medium ${isActive ? 'text-blue-600' : 'text-gray-600'}`}>
          {person.name}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * 어느 탭을 보고 있는지 알리는 밑줄.
 *
 * 칸마다 밑줄을 켜고 끄면 순간이동해서, 이것들이 한 줄에 나란한 탭인지 서로 다른 단추인지
 * 흐려진다. 하나를 두고 옮기면 "옆으로 갔다"가 그대로 보인다 (`SegmentedTabs` 와 같다).
 *
 * 폭이 탭마다 다르므로 1픽셀짜리를 늘여 쓴다. `width` 를 직접 움직이면 자바스크립트
 * 쪽에서 프레임마다 값을 넘겨야 하지만, 늘이기와 옮기기는 UI 스레드에 맡길 수 있다.
 *
 * 끄는 동안에는 그 탭이 옮긴 거리를 함께 더한다. 밑줄만 제자리에 두면 고른 탭을 끌고 갈 때
 * 이름과 줄이 따로 논다.
 */
function Underline({ span, offset }: { span?: Span; offset: Animated.Value }) {
  const shift = useRef(new Animated.Value(0)).current;
  const stretch = useRef(new Animated.Value(0)).current;
  /** 처음 잰 자리에는 곧바로 놓는다. 화면을 열 때 왼쪽 끝에서 달려오지 않게. */
  const placed = useRef(false);

  useEffect(() => {
    if (!span) return;

    // 1픽셀짜리는 제 가운데를 중심으로 늘어난다. 그 가운데를 탭의 가운데에 맞춘다.
    const toShift = span.x + span.width / 2 - 0.5;

    if (!placed.current) {
      placed.current = true;
      shift.setValue(toShift);
      stretch.setValue(span.width);
      return;
    }

    Animated.parallel([
      Animated.timing(shift, { toValue: toShift, duration: 180, useNativeDriver: true }),
      Animated.timing(stretch, { toValue: span.width, duration: 180, useNativeDriver: true }),
    ]).start();
  }, [span, shift, stretch]);

  // 아직 재지 못했다. 0 폭으로 그려 두면 첫 칸에 점 하나가 스친다.
  if (!span) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        bottom: 0,
        width: 1,
        height: 2,
        backgroundColor: '#2563eb',
        transform: [{ translateX: Animated.add(shift, offset) }, { scaleX: stretch }],
      }}
    />
  );
}
