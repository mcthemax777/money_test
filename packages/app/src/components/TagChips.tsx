/*
 * 거래 폼에서 태그를 고르는 알약 줄. 나누지 않은 거래의 태그 칸과 분할 줄마다의 태그 칸이 함께 쓴다.
 *
 * 거래 입력(EntryEditor)에서 떼어 냈다 (2026-10-26). 고른 거래 여럿의 태그를 손보는 창
 * (TagPickModal)의 알약은 세 갈래(켜짐·일부·꺼짐)라 따로 둔다.
 */
import { useRef } from 'react';
import { Animated, View } from 'react-native';
import type { TagDto } from '@money/types';

import { Chip } from './FormFields';

/**
 * 태그를 고르는 알약 줄. 여럿을 고를 수 있다.
 *
 * `Chips` 와 나누어 둔 것은 고름이 하나가 아니라 집합이고, 알약마다 자기 색을 갖기
 * 때문이다. 하나를 골라도 나머지가 풀리지 않는다.
 */
export default function TagChips({
  tags,
  selected,
  onToggle,
}: {
  tags: TagDto.Response[];
  selected: string[];
  onToggle: (tagId: string) => void;
}) {
  return (
    /* 옆으로 넘기지 않는다. 태그는 스물이 넘어가도 이름이 짧아 몇 줄로 다 담긴다. */
    <View className="flex-row flex-wrap items-center gap-2">
      {tags.map((tag) => (
        <TagChip
          key={tag.id}
          tag={tag}
          isSelected={selected.includes(tag.id)}
          onPress={() => onToggle(tag.id)}
        />
      ))}
    </View>
  );
}

/**
 * 태그 알약 하나.
 *
 * 누르면 살짝 눌렸다 돌아온다. 여럿을 고르는 칸이라 **무엇이 방금 바뀌었는지**가 색만으로는
 * 잘 보이지 않는다 -- 알약이 열 개 늘어선 줄에서 한 칸의 색이 바뀌는 것은 눈에 잘 띄지
 * 않지만, 움직인 칸은 눈이 따라간다.
 */
function TagChip({
  tag,
  isSelected,
  onPress,
}: {
  tag: TagDto.Response;
  isSelected: boolean;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const press = () => {
    // 눌렀다 놓는 한 번의 움직임. 위치만 바꾸므로 UI 스레드에 맡긴다.
    Animated.sequence([
      Animated.timing(scale, {
        toValue: 0.92,
        duration: 80,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        friction: 4,
        tension: 220,
        useNativeDriver: true,
      }),
    ]).start();
    onPress();
  };

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      {/* 알약은 다른 고르는 자리와 같은 것을 쓴다. 색을 정한 태그는 점으로 보인다. */}
      <Chip label={tag.name} selected={isSelected} onPress={press} color={tag.color} />
    </Animated.View>
  );
}
