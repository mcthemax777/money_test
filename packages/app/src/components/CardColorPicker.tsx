/*
 * 카드 앞면 색 고르기. 웹의 `CardColorPicker` 자리다.
 *
 * 색 이름을 늘어놓지 않고 실제 앞면 색을 칠한 조각을 보인다 -- 홈의 카드가 이 색으로
 * 보이므로 고르는 자리도 그 모습이어야 한다. 웹은 tailwind 그라데이션 클래스를 쓰지만
 * 앱에는 CSS 그라데이션이 없어, core 가 짝으로 들고 있는 색 정지점(`faceColors`)으로
 * 직접 그린다 (홈의 카드와 같은 방법이다).
 */
import { Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { cssInterop } from 'nativewind';

import { CARD_COLOR_OPTIONS } from '@money/core/lib/card-color';
import { useTranslation } from '@money/core/lib/i18n';

// nativewind 는 남의 컴포넌트에 className 을 그냥 넘긴다. 한 번 알려 줘야 스타일이 된다.
cssInterop(LinearGradient, { className: 'style' });

export default function CardColorPicker({
  value,
  onChange,
}: {
  /** 고른 색. 빈 문자열이면 카드 종류의 기본색을 쓴다. */
  value: string;
  onChange: (color: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <View className="flex-row flex-wrap gap-2">
      {CARD_COLOR_OPTIONS.map((option) => (
        <Pressable
          key={option.color}
          onPress={() => onChange(option.color)}
          accessibilityRole="button"
          accessibilityLabel={t(option.labelKey)}
          accessibilityState={{ selected: value === option.color }}
          /*
           * 고른 조각은 테두리를 두껍게 하고 나머지는 옅게 둔다. 하양·회색 조각은
           * 폼 바탕에 녹으므로 조각마다 옅은 테두리를 함께 둔다 (웹과 같다).
           */
          className={`overflow-hidden rounded-md border ${
            value === option.color ? 'border-2 border-gray-900' : 'border-black/10 opacity-80'
          }`}
        >
          <LinearGradient
            colors={option.faceColors as [string, string, ...string[]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            className="h-9 w-14"
          />
        </Pressable>
      ))}
      {/* 고른 것을 무르면 카드 종류의 기본색으로 돌아간다. 색은 비울 수 있어야 한다. */}
      {value ? (
        <Pressable
          onPress={() => onChange('')}
          accessibilityRole="button"
          className="h-9 justify-center rounded-md border border-gray-300 px-3"
        >
          <Text className="text-sm text-gray-700">{t('common.none')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
