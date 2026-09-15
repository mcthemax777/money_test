/*
 * 태그 하나를 적는 칸들 -- 이름과 색.
 *
 * 태그를 만드는 자리가 둘이다. 설정의 태그 판과, 거래를 적다가 그 자리에서 만드는 창.
 * 두 벌로 두면 고를 수 있는 색이나 고른 표시가 한쪽에서만 바뀌어, 같은 태그를 만드는
 * 일이 화면마다 다르게 보인다 (웹의 `TagFields` 와 같은 자리다).
 */
import { Pressable, Text, TextInput, View } from 'react-native';

import type { TagFormValues } from '@money/core/hooks/useTagManager';
import { useTranslation } from '@money/core/lib/i18n';
import { TAG_COLORS } from '@money/core/lib/tag-color';

export function TagFields({
  values,
  onChange,
  /** 새로 만드는 창에서는 이름 칸에 바로 커서를 둔다. 고치러 열었을 때는 두지 않는다. */
  autoFocus = false,
}: {
  values: TagFormValues;
  onChange: (next: TagFormValues) => void;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <>
      <View>
        <Text className="mb-2 text-sm font-medium text-gray-700">{t('tags.name')}</Text>
        <TextInput
          value={values.name}
          onChangeText={(text) => onChange({ ...values, name: text })}
          autoFocus={autoFocus}
          className="rounded-lg border border-gray-300 px-3 py-3 text-base text-gray-900"
        />
      </View>

      <View>
        <Text className="mb-2 text-sm font-medium text-gray-700">{t('tags.color')}</Text>
        <View className="flex-row flex-wrap gap-2">
          {/* 색을 고르지 않는 것도 하나의 선택이다. 빈 동그라미가 그 자리다. */}
          <ColorDot
            color=""
            label={t('tags.colorNone')}
            isSelected={values.color === ''}
            onPress={() => onChange({ ...values, color: '' })}
          />
          {TAG_COLORS.map((color) => (
            <ColorDot
              key={color}
              color={color}
              label={color}
              isSelected={values.color === color}
              onPress={() => onChange({ ...values, color })}
            />
          ))}
        </View>
      </View>
    </>
  );
}

/** 색 하나. 고른 것은 테두리로 보인다 -- 색 위에 체크를 얹으면 밝은 색에서 보이지 않는다. */
function ColorDot({
  color,
  label,
  isSelected,
  onPress,
}: {
  color: string;
  label: string;
  isSelected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={`h-9 w-9 items-center justify-center rounded-full border-2 ${
        isSelected ? 'border-blue-600' : 'border-transparent'
      }`}
    >
      <View
        className={`h-6 w-6 rounded-full ${color ? '' : 'border border-gray-300'}`}
        style={color ? { backgroundColor: color } : undefined}
      />
    </Pressable>
  );
}
