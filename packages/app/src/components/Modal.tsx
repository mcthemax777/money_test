import type { ReactNode } from 'react';
import {
  Modal as RNModal,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

import { useTranslation } from '@money/core/lib/i18n';

/**
 * 팝업. 웹의 것과 같은 모양이다.
 *
 * 검은 막 위에 흰 상자를 띄우고, 머리글과 하단 버튼 자리는 붙박이로 두어 본문이
 * 길어도 닫기와 저장이 늘 보인다. 뒤로가기는 화면을 나가지 않고 이 팝업을 닫는다
 * (RNModal 의 onRequestClose).
 *
 * **좁은 화면에서는 아래에서 올라와 아래에 붙는다.** 손이 닿는 자리가 화면 아래쪽이라
 * 거기서 올라와 거기에 서는 창이 누르기도 닫기도 가깝다. 태블릿처럼 넓은 화면에서는
 * 폭을 다 쓸 까닭이 없으므로 가운데에 뜬다 (웹과 같은 자리에서 갈린다).
 *
 * 줄을 눌러 여는 거래 상세도 이 창을 쓴다. 클릭해서 여는 자리가 저마다 다른 모양으로
 * 나타나면 화면마다 닫는 길을 다시 찾아야 한다.
 */
export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  headerAction,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * 머리글 오른쪽, 닫기 앞에 서는 단추.
   *
   * 팝업 전체에 걸리는 일(예: 상세의 내용 복사)을 두는 자리다. 본문에 두면 스크롤에
   * 밀려 보이지 않고, 하단 버튼 자리는 그 팝업의 본론(저장·삭제)이 쓴다.
   */
  headerAction?: ReactNode;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  /* 768 은 웹 Tailwind 의 md 다. 두 화면이 같은 폭에서 같은 모양으로 갈리게 둔다. */
  const isWide = width >= 768;

  const header = (
    <View className="flex-row items-center justify-between gap-3 border-b border-gray-200 px-6 py-4">
      <Text numberOfLines={1} className="flex-1 text-lg font-bold text-gray-900">
        {title}
      </Text>
      <View className="flex-row items-center gap-4">
        {headerAction}
        {/*
          닫기. 글자 "×" 가 아니라 아이콘이다.

          글자로 두면 그 칸 안에서 글자가 어디에 놓이는지를 글꼴이 정한다. ×(곱셈
          기호)의 먹은 글자 가운데가 아니라 수학 축 언저리에 그려지고, 안드로이드는
          글꼴이 시키는 위아래 여백까지 더한다. 그래서 같은 크기의 네모에 넣어도
          옆의 아이콘과 한 축에 서지 않는다. 같은 방식으로 그려지는 아이콘으로 두면
          넷이 한 줄에 선다.
        */}
        <Pressable
          onPress={onClose}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          className="h-8 w-8 items-center justify-center rounded-lg active:bg-gray-100"
        >
          <X size={20} color="#6b7280" />
        </Pressable>
      </View>
    </View>
  );

  return (
    /* 좁은 화면에서는 밀려 올라오고, 넓은 화면에서는 제자리에 떠오른다. */
    <RNModal
      visible={isOpen}
      transparent
      animationType={isWide ? 'fade' : 'slide'}
      onRequestClose={onClose}
    >
      <View
        className={`flex-1 bg-black/50 ${
          isWide ? 'items-center justify-center px-4' : 'justify-end'
        }`}
      >
        <View
          className={`max-h-[90%] w-full overflow-hidden bg-white shadow-lg ${
            // 아래에 붙는 창은 위쪽 모서리만 둥글다. 아래는 화면 끝이라 둥글릴 자리가 없다.
            isWide ? 'max-w-md rounded-lg' : 'rounded-t-2xl'
          }`}
        >
          {header}

          <ScrollView
            contentContainerClassName="p-6"
            /* 홈 표시줄 자리. 아래에 붙는 창이라 마지막 줄이 그 밑으로 들어가지 않게 한다. */
            contentContainerStyle={isWide ? undefined : { paddingBottom: 24 + insets.bottom }}
          >
            {children}
          </ScrollView>

          {footer ? (
            <View
              className="border-t border-gray-200 px-6 py-4"
              style={isWide ? undefined : { paddingBottom: 16 + insets.bottom }}
            >
              {footer}
            </View>
          ) : null}
        </View>
      </View>
    </RNModal>
  );
}
