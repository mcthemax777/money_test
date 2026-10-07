import { Pressable, ScrollView, Text, View } from 'react-native';
import { X } from 'lucide-react-native';

import type { SearchChip } from '@money/core/hooks/useTransactions';
import { useTranslation } from '@money/core/lib/i18n';

/**
 * 걸려 있는 조건 알약 줄. 거래·분석 화면이 탭 위에 둔다 (웹의 SearchChips 와 같은 짝).
 *
 * `onRemove` 를 주면 알약을 눌러 그 조건만 뺀다. 주지 않으면 무엇으로 그렸는지 알리기만 한다
 * -- 다른 탭에서 건너온 보기(거래 탭의 분석, 분석 탭의 거래내역)는 조건을 고칠 수 없다.
 *
 * 많아지면 가로로 굴린다. 줄바꿈으로 두면 조건이 열 개 넘을 때 목록이 화면 밖으로 밀린다.
 */
export default function SearchChips({
  chips,
  onRemove,
}: {
  chips: SearchChip[];
  onRemove?: (chipId: string) => void;
}) {
  const { t } = useTranslation();
  if (chips.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      /*
       * 늘어나지 않게 못 박는다. ScrollView 는 기본 스타일에 flexGrow:1 이 있어
       * 세로로 늘어선 칸 안에서 남는 높이를 먹는다. 알약 줄은 알약 높이면 된다.
       */
      className="grow-0"
      contentContainerClassName="flex-row items-center gap-2 pr-4"
    >
      {chips.map((chip) =>
        onRemove ? (
          <Pressable
            key={chip.id}
            onPress={() => onRemove(chip.id)}
            // 손가락이 닿는 자리라 알약 자체를 누르게 한다. x 만 누르게 하면 빗나간다.
            accessibilityLabel={`${chip.label} ${t('tx.search.chipRemove')}`}
            className="flex-row items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 py-1.5 pl-3 pr-2 active:bg-blue-100"
          >
            <Text className="text-sm font-medium text-blue-700">{chip.label}</Text>
            <X size={14} color="#1d4ed8" />
          </Pressable>
        ) : (
          <View key={chip.id} className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5">
            <Text className="text-sm font-medium text-blue-700">{chip.label}</Text>
          </View>
        ),
      )}
    </ScrollView>
  );
}
