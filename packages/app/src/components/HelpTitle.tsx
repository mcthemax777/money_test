/*
 * 제목 옆 물음표를 누르면 설명이 펼쳐지는 머리 (2026-10-09 사용자 요청 -- 설정 탭의 상자들).
 * 웹의 HelpTitle 과 같다.
 *
 * 설명을 늘 펼쳐 두면 상자마다 두세 줄씩 차지해 한 화면에 몇 개 들어가지 않는다. 처음 한두 번만
 * 읽으면 되는 글이라 접어 두고, 궁금할 때 연다. 다시 누르면 접힌다. 상자 전체가 누르는 자리여도
 * 물음표가 안쪽이라 그 누름은 물음표가 받는다.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { CircleHelp } from 'lucide-react-native';

import { useTranslation } from '@money/core/lib/i18n';

export default function HelpTitle({
  title,
  description,
  trailing,
  compact = false,
}: {
  title: string;
  description: string;
  /** 제목 바로 옆에 붙는 것 (읽지 않은 수 배지 따위). */
  trailing?: ReactNode;
  /** 작은 줄(설정 줄의 compact)과 같은 글자 크기. */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;

  // 펼칠 때 옅은 데서 떠오른다.
  useEffect(() => {
    if (!open) return;
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [open, opacity]);

  return (
    <View>
      <View className="flex-row items-center gap-2">
        <Text className={`${compact ? 'text-sm' : 'text-lg'} shrink font-semibold text-gray-900`}>
          {title}
        </Text>
        {trailing}
        <Pressable
          onPress={() => setOpen((value) => !value)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('common.help')}
          accessibilityState={{ expanded: open }}
        >
          <CircleHelp size={compact ? 14 : 16} color={open ? '#2563eb' : '#9ca3af'} />
        </Pressable>
      </View>
      {open ? (
        <Animated.View style={{ opacity }}>
          <Text className={`mt-1 ${compact ? 'text-xs text-gray-500' : 'text-sm text-gray-600'}`}>
            {description}
          </Text>
        </Animated.View>
      ) : null}
    </View>
  );
}
