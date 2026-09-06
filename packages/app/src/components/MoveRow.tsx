/*
 * 목록에서 한 칸 옮기는 두 버튼.
 *
 * 앱에는 드래그가 없다. 손가락으로 줄을 끌면 그 아래 스크롤과 다투고, 목록이 창 안에
 * 또 들어 있는 자리(고치기 창)에서는 잡을 여백도 없다. 그래서 한 칸씩 옮긴다.
 *
 * 한 번 누를 때마다 **그 줄의 순서 값 하나만** 바뀐다 (분수 색인). 목록 전체를 다시
 * 매기지 않으므로, 그 사이 다른 기기에서 옮긴 것을 덮지 않는다 (설계 문서의 D5).
 *
 * 자산·분류·태그가 함께 쓴다. 세 화면이 각자 버튼을 그리면 같은 조작이 화면마다 다른
 * 모양이 되고, 끝에서 더 밀었을 때의 처리도 갈린다.
 */
import { ArrowDown, ArrowUp } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

import { useTranslation } from '@money/core/lib/i18n';

export default function MoveRow({
  disabled,
  onMove,
  /**
   * 좁은 자리용. 화살표만 남기고 라벨과 글자를 뺀다.
   *
   * 목록 한 줄 안에 들어갈 때 쓴다. 그 자리에는 이름이 이미 무엇을 옮기는지 말하고
   * 있어서, 버튼마다 "위로/아래로"를 또 적으면 이름이 밀려난다.
   */
  compact = false,
}: {
  disabled: boolean;
  onMove: (step: 1 | -1) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <View>
      {compact ? null : (
        <Text className="mb-1 text-sm font-medium text-gray-700">{t('assets.order')}</Text>
      )}
      <View className="flex-row gap-2">
        {([-1, 1] as const).map((step) => (
          <Pressable
            key={step}
            disabled={disabled}
            onPress={() => onMove(step)}
            hitSlop={compact ? 6 : undefined}
            accessibilityLabel={t(step === -1 ? 'assets.moveUp' : 'assets.moveDown')}
            className={`flex-row items-center justify-center gap-1.5 rounded-lg border border-gray-300 ${
              compact ? 'px-2 py-1' : 'flex-1 px-3 py-2'
            } ${disabled ? 'opacity-40' : 'active:bg-gray-50'}`}
          >
            {step === -1 ? (
              <ArrowUp size={16} color="#374151" />
            ) : (
              <ArrowDown size={16} color="#374151" />
            )}
            {compact ? null : (
              <Text className="text-sm text-gray-700">
                {t(step === -1 ? 'assets.moveUp' : 'assets.moveDown')}
              </Text>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}
