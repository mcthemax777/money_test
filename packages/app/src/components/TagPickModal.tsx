/*
 * 고른 거래의 태그를 한 번에 손보는 창.
 *
 * 알약은 세 갈래로 열린다.
 *
 *   켜짐   고른 거래가 **전부** 가진 태그. 끄면 전부에서 뗀다.
 *   일부   **일부만** 가진 태그. 켜면 전부에 붙는다. 그대로 두면 아무 일도 없다.
 *   꺼짐   아무도 가지지 않았다. 켜면 전부에 붙는다.
 *
 * **처음 상태에서 달라진 것만 보낸다.** 켜진 채로 둔 것도, 꺼진 채로 둔 것도 손대지
 * 않는다. 여러 건을 한꺼번에 다루는 자리라, "보이는 것이 전부"로 받으면 화면에 없던
 * 태그가 조용히 사라진다.
 *
 * "일부"를 따로 그리는 이유가 여기 있다. 켜진 것으로 보이면 "이미 다 붙어 있다"로
 * 읽히고, 아무 표시 없이 꺼 두면 "꺼져 있으니 떼진다"로 읽힌다. 둘 다 사실이 아니다.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, Text, View } from 'react-native';
import { Check, Minus } from 'lucide-react-native';
import type { TagDto } from '@money/types';

import { useTranslation } from '@money/core/lib/i18n';
import {
  tagPickResult,
  tagPickState,
  toggleTagPick,
  type TagPickState,
} from '@money/core/lib/tag-pick';

import Modal from './Modal';

export default function TagPickModal({
  isOpen,
  onClose,
  onApply,
  tags,
  count,
  isSubmitting,
  commonTagIds,
  partialTagIds,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** 더할 것과 뗄 것. 처음 상태에서 달라진 것만 담긴다. */
  onApply: (addTagIds: string[], removeTagIds: string[]) => void;
  tags: TagDto.Response[];
  /** 손볼 거래 수. 무엇에 걸리는지 숫자로 보여 준다. */
  count: number;
  isSubmitting: boolean;
  /** 고른 거래가 모두 가진 태그. 켜진 채로 연다. */
  commonTagIds: string[];
  /** 일부만 가진 태그. "일부"로 열고, 그대로 두면 손대지 않는다. */
  partialTagIds: string[];
}) {
  const { t } = useTranslation();
  /** 사용자가 켜고 끈 것. 여기 없는 태그는 처음 상태 그대로다. */
  const [changed, setChanged] = useState<Record<string, boolean>>({});

  // 열 때마다 비운다. 지난번에 손댄 것이 남으면 엉뚱한 태그가 바뀐다.
  useEffect(() => {
    if (isOpen) setChanged({});
  }, [isOpen]);

  /* 세 갈래를 가르는 규칙과 누름의 뜻은 core 의 tag-pick 이 갖는다. 웹과 같은 것이다. */
  const stateOf = (tagId: string) => tagPickState(tagId, changed, commonTagIds, partialTagIds);

  const toggle = (tagId: string) => {
    setChanged((previous) => toggleTagPick(tagId, previous, commonTagIds, partialTagIds));
  };

  const { addTagIds, removeTagIds } = tagPickResult(
    tags.map((tag) => tag.id),
    changed,
    commonTagIds,
  );
  const hasChange = addTagIds.length > 0 || removeTagIds.length > 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('tx.tagSelected')}
      footer={
        <Pressable
          onPress={() => onApply(addTagIds, removeTagIds)}
          disabled={!hasChange || isSubmitting}
          className={`items-center rounded-lg bg-blue-600 px-4 py-3 ${
            !hasChange || isSubmitting ? 'opacity-50' : ''
          }`}
        >
          <Text className="text-base font-semibold text-white">
            {t(isSubmitting ? 'common.saving' : 'common.confirm')}
          </Text>
        </Pressable>
      }
    >
      <View className="gap-4">
        <Text className="text-sm text-gray-600">{t('tx.tagTargets', { count })}</Text>

        {tags.length === 0 ? (
          <Text className="text-sm text-gray-500">{t('tags.empty')}</Text>
        ) : (
          <ScrollView className="max-h-80 grow-0">
            <View className="flex-row flex-wrap gap-2">
              {tags.map((tag) => (
                <TagChip
                  key={tag.id}
                  tag={tag}
                  state={stateOf(tag.id)}
                  onPress={() => toggle(tag.id)}
                />
              ))}
            </View>
          </ScrollView>
        )}

        {/*
          무엇이 벌어지는지 글자로 못 박는다. 여러 건을 한꺼번에 다루는 자리라, 이미
          붙어 있던 것이 사라질지 모른다는 걱정이 실제로 생긴다.
        */}
        <Text className="text-xs leading-5 text-gray-500">{t('tx.tagHowTo')}</Text>
        {partialTagIds.length > 0 ? (
          <Text className="-mt-2 text-xs leading-5 text-gray-500">{t('tx.tagPartialHint')}</Text>
        ) : null}
      </View>
    </Modal>
  );
}

/** 태그 알약 하나. 누르면 살짝 눌렸다 돌아온다 -- 무엇이 방금 바뀌었는지 눈이 따라간다. */
function TagChip({
  tag,
  state,
  onPress,
}: {
  tag: TagDto.Response;
  state: TagPickState;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const press = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.92, duration: 80, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 220, useNativeDriver: true }),
    ]).start();
    onPress();
  };

  /*
   * 세 갈래를 테두리와 표시로 가른다.
   *
   * "일부"를 켜진 것과 같은 파랑으로 두면 둘을 구별할 수 없고, 꺼진 것과 같은 회색으로
   * 두면 아무도 가지지 않은 것과 구별할 수 없다. 그래서 색은 켜짐과 나누고(회색 테두리)
   * 표시는 꺼짐과 나눈다(빗금).
   */
  const isOn = state === 'on';
  const isPartial = state === 'partial';

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={press}
        className={`flex-row items-center gap-1.5 rounded-full border px-3 py-2 ${
          isOn ? 'border-blue-600 bg-blue-50' : isPartial ? 'border-gray-400 bg-gray-50' : 'border-gray-300 bg-white'
        }`}
      >
        {tag.color ? (
          <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
        ) : null}
        <Text
          className={`text-sm ${
            isOn ? 'font-medium text-blue-600' : isPartial ? 'text-gray-800' : 'text-gray-700'
          }`}
        >
          {tag.name}
        </Text>
        {/*
          표시 자리는 상태와 상관없이 늘 잡아 둔다. 아이콘이 들락거리면 누를 때마다
          알약의 너비가 달라져 뒤따르는 알약이 줄을 넘나든다.
        */}
        <View className="h-3.5 w-3.5 items-center justify-center">
          {isOn ? <Check size={13} color="#2563eb" strokeWidth={3} /> : null}
          {isPartial ? <Minus size={13} color="#6b7280" strokeWidth={3} /> : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}
