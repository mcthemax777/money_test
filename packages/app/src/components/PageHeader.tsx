import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useNavigation } from '../shell/navigation';

/**
 * 화면 제목 줄. 웹의 PageHeader 와 같다.
 *
 * 오른쪽 `action` 에는 그 화면의 주요 버튼을 넣는다. `showBack` 은 메뉴에 없는
 * 하위 화면(설정 > 내 정보)에서만 쓴다.
 */
export default function PageHeader({
  title,
  action,
  showBack,
}: {
  /** 글자면 그대로 제목이 되고, 노드면 그 자리에 들어간다 (자산주인을 겸하는 제목 등) */
  title: ReactNode;
  action?: ReactNode;
  showBack?: boolean;
}) {
  const { back } = useNavigation();

  return (
    <View className="flex-row flex-wrap items-center justify-between gap-3">
      <View className="flex-row items-center gap-3">
        {showBack ? (
          <Pressable
            onPress={back}
            className="h-8 w-8 items-center justify-center rounded-lg border border-gray-300 bg-white active:bg-gray-50"
          >
            <Text className="text-gray-600">←</Text>
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
