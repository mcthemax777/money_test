import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';

import { useNavigation } from '../shell/navigation';

/**
 * 화면 제목 줄. 웹의 PageHeader 와 같다.
 *
 * 오른쪽 `action` 에는 그 화면의 주요 버튼을 넣는다. `showBack` 은 메뉴에 없는
 * 하위 화면(설정 > 내 정보)에서만 쓴다.
 *
 * `onBack` 은 돌아가기 전에 할 일이 있는 자리가 쓴다 (분류에서 건너온 거래 화면은
 * 떠나온 상세를 다시 펴 달라고 남기고 간다). 주면 ← 가 서고 그 일을 대신 한다.
 */
export default function PageHeader({
  title,
  action,
  showBack,
  onBack,
}: {
  /** 글자면 그대로 제목이 되고, 노드면 그 자리에 들어간다 (자산주인을 겸하는 제목 등) */
  title: ReactNode;
  action?: ReactNode;
  showBack?: boolean;
  onBack?: () => void;
}) {
  const { back } = useNavigation();

  return (
    <View className="flex-row flex-wrap items-center justify-between gap-3">
      <View className="flex-row items-center gap-3">
        {showBack || onBack ? (
          <Pressable
            onPress={onBack ?? back}
            /*
              이 모양을 화면을 덮는 상세(거래·자산)도 그대로 쓴다. 클릭해서 들어가는
              자리는 어디서나 같은 자리에 같은 단추가 있어야 한다. 글자 "←" 가 아니라
              아이콘인 것은 닫기(×)와 같은 까닭이다 (Modal 머리말).
            */
            className="h-8 w-8 items-center justify-center rounded-lg border border-gray-300 bg-white active:bg-gray-50"
          >
            <ArrowLeft size={16} color="#4b5563" />
          </Pressable>
        ) : null}
        {typeof title === 'string' ? (
          /*
            위아래 여백은 홈의 자산주인 제목(누를 수 있어 py-1 을 갖는다)과 맞춘 것이다.
            빼면 홈만 첫 줄이 조금 내려가 탭을 옮길 때마다 제목이 흔들린다.
          */
          <Text className="py-1 text-2xl font-bold text-gray-900">{title}</Text>
        ) : (
          title
        )}
      </View>
      {action ? <View className="flex-row flex-wrap gap-2">{action}</View> : null}
    </View>
  );
}
