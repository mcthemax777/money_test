import type { ReactNode } from 'react';
import { Modal as RNModal, Pressable, ScrollView, Text, View } from 'react-native';

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
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <RNModal visible={isOpen} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/50 px-4">
        <View className="max-h-[90%] w-full max-w-md overflow-hidden rounded-lg bg-white shadow-lg">
          <View className="flex-row items-center justify-between border-b border-gray-200 px-6 py-4">
            <Text className="text-lg font-bold text-gray-900">{title}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text className="text-2xl leading-none text-gray-500">×</Text>
            </Pressable>
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
