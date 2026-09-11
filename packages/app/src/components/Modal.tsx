import type { ReactNode } from 'react';
import { Modal as RNModal, Pressable, ScrollView, Text, View } from 'react-native';
import { X } from 'lucide-react-native';

import { useTranslation } from '@money/core/lib/i18n';

/**
 * 팝업. 웹의 것과 같은 모양이다.
 *
 * 검은 막 위에 흰 상자를 띄우고, 머리글과 하단 버튼 자리는 붙박이로 두어 본문이
 * 길어도 닫기와 저장이 늘 보인다. 뒤로가기는 화면을 나가지 않고 이 팝업을 닫는다
 * (RNModal 의 onRequestClose).
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

  return (
    <RNModal visible={isOpen} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/50 px-4">
        <View className="max-h-[90%] w-full max-w-md overflow-hidden rounded-lg bg-white shadow-lg">
          <View className="flex-row items-center justify-between border-b border-gray-200 px-6 py-4">
            <Text className="flex-1 text-lg font-bold text-gray-900">{title}</Text>
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

          <ScrollView contentContainerClassName="p-6">{children}</ScrollView>

          {footer ? (
            <View className="border-t border-gray-200 px-6 py-4">{footer}</View>
          ) : null}
        </View>
      </View>
    </RNModal>
  );
}
