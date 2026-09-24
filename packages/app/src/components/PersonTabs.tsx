import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, Text, View, type LayoutChangeEvent } from 'react-native';
import { Plus } from 'lucide-react-native';

import { useTranslation } from '@money/core/lib/i18n';
import type { Person } from '@money/core/lib/types';
import { useCanEdit } from '@money/core/store/project';

/** 탭 하나가 선 자리. 밑줄을 이 자리와 폭에 맞춰 옮긴다. */
interface Span {
  x: number;
  width: number;
}

/** "전체"는 id 가 없다. 잰 자리를 담는 표의 열쇠로 빈 글자를 쓴다. */
const keyOf = (id: string | null) => id ?? '';

/**
 * 자산 목록 위의 사람 탭. 웹의 `PersonTabs` 와 같다.
 *
 * 구성원이 둘만 되어도 목록이 한 화면을 넘어, 두 번째 사람의 통장을 보려면 첫 사람의
 * 카드를 통째로 지나쳐 내려가야 했다. 여기서 하나를 고르면 그 사람의 카드만 남는다.
 *
 * **위의 총자산과 추이 그래프는 건드리지 않는다.** 그쪽은 제목(`PersonScopeTitle`)에서
 * 고른 자산주인 전체의 값이다. 이 탭은 보고 있는 범위를 바꾸는 것이 아니라 긴 목록에서
 * 한 사람에게 바로 가는 길이라, 둘이 같은 일을 하면 어느 것이 범위를 정하는지 흐려진다.
 *
 * 구성원 추가도 이 줄의 오른쪽 끝에 함께 선다. 목록 위에 점선 버튼을 따로 두면 탭 줄과
 * 버튼이 띠 두 개로 쌓여, 정작 사람 이름이 그만큼 아래로 밀린다.
 */
export default function PersonTabs({
  people,
  selectedId,
  onSelect,
  onAddPerson,
}: {
  people: Person[];
  /** 고른 사람. null 이면 전부 늘어놓는다. */
  selectedId: string | null;
  onSelect: (personId: string | null) => void;
  onAddPerson: () => void;
}) {
  const { t } = useTranslation();
  /* 읽기 전용 구성원에게는 더하기 탭을 그리지 않는다 (`AddButton` 과 같은 규칙). */
  const canEdit = useCanEdit();

  /*
   * 혼자인 가계부에는 고를 것이 없다. "전체"와 그 사람이 같은 것을 가리켜, 둘 중
   * 무엇을 눌러도 아무 일이 없는 탭 두 개가 남는다. 그때는 더하기 탭만 세운다.
   */
  const tabs: Array<{ id: string | null; label: string }> =
    people.length > 1
      ? [
          { id: null, label: t('assets.personTab.all') },
          ...people.map((person) => ({ id: person.id, label: person.name })),
        ]
      : [];

  /*
   * 탭마다 그려진 자리. 밑줄이 어디로 미끄러질지 이 값으로 센다.
   *
   * 글자 길이가 이름마다 달라 미리 적어 둘 수 없다. 그려진 뒤 재고, 이름이 바뀌거나
   * 화면을 돌리면 다시 온다.
   */
  const [spans, setSpans] = useState<Record<string, Span>>({});
  const measure = (id: string | null) => (event: LayoutChangeEvent) => {
    const { x, width } = event.nativeEvent.layout;

    setSpans((prev) => {
      const before = prev[keyOf(id)];
      // 같은 자리면 있던 표를 그대로 둔다. 새 객체를 넣으면 공연히 다시 그린다.
      if (before && before.x === x && before.width === width) return prev;
      return { ...prev, [keyOf(id)]: { x, width } };
    });
  };

  return (
    <View className="mb-3 border-b border-gray-200">
      {/*
        사람이 많으면 한 줄에 다 서지 못한다. 글자를 줄이는 대신 옆으로 넘겨 본다 --
        이름을 줄이면 "김…"만 남아 어느 탭인지 알 수 없다. 더하기 탭도 이 줄 안에 있어
        끝까지 밀면 따라 나온다.
      */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="flex-row">
          {tabs.map((tab) => (
            <Pressable
              key={tab.id ?? 'all'}
              onLayout={measure(tab.id)}
              onPress={() => onSelect(tab.id)}
              className="px-4 py-2 active:opacity-70"
            >
              <Text
                className={`text-sm font-medium ${
                  tab.id === selectedId ? 'text-blue-600' : 'text-gray-600'
                }`}
              >
                {tab.label}
              </Text>
            </Pressable>
          ))}

          {canEdit ? (
            <>
              {/* 고르는 탭과 더하는 탭 사이의 금. 둘이 같은 무게로 읽히지 않게 한다. */}
              {tabs.length > 0 ? <View className="my-2 w-px bg-gray-200" /> : null}

              <Pressable
                onPress={onAddPerson}
                className="flex-row items-center gap-1.5 px-4 py-2 active:opacity-70"
              >
                <Plus size={16} color="#6b7280" />
                <Text className="text-sm text-gray-500">{t('person.add')}</Text>
              </Pressable>
            </>
          ) : null}

          <Underline span={spans[keyOf(selectedId)]} />
        </View>
      </ScrollView>
    </View>
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
 */
function Underline({ span }: { span?: Span }) {
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
        transform: [{ translateX: shift }, { scaleX: stretch }],
      }}
    />
  );
}
