/*
 * 거래 화면에서 고르는 중에 머리글 자리를 통째로 차지하는 줄.
 * 뒤로가기 · (태그·분류 단추) · 몇 개를 골랐는지 · 삭제. 제목과 검색은 그때 쓸 것이 아니다.
 *
 * 거래 화면(TransactionsScreen)에서 떼어 냈다 (2026-10-26).
 */
import { Pressable, Text, View } from 'react-native';
import { ArrowLeft, Shapes, Tag, Trash2 } from 'lucide-react-native';

import { useTranslation } from '@money/core/lib/i18n';
import type { SelectPurpose } from '@money/core/hooks/useTransactions';

export default function TransactionSelectionHeader({
  purpose,
  selectedCount,
  isTagging,
  isRecategorizing,
  isDeleting,
  onBack,
  onTag,
  onCategory,
  onDelete,
}: {
  /** 무엇을 하러 골랐는가. 그 일의 단추 하나만 선다. */
  purpose: SelectPurpose | null;
  selectedCount: number;
  isTagging: boolean;
  isRecategorizing: boolean;
  isDeleting: boolean;
  /** 고르기를 그만둔다. */
  onBack: () => void;
  onTag: () => void;
  onCategory: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();

  return (
    <View className="flex-row items-center gap-3">
      <Pressable
        onPress={onBack}
        accessibilityLabel={t('common.back')}
        className="h-9 w-9 items-center justify-center rounded-lg border border-gray-300 bg-white active:bg-gray-50"
      >
        <ArrowLeft size={18} color="#4b5563" />
      </Pressable>

      {/*
        태그를 붙이러 왔으면 그 버튼이 왼쪽, 뒤로가기 옆에 선다.
        지우기는 오른쪽 끝이다 -- 되돌릴 수 없는 일이라 뒤로가기에서 멀어야 한다.
      */}
      {purpose === 'tag' ? (
        <Pressable
          onPress={onTag}
          disabled={isTagging}
          accessibilityLabel={t('tx.tagSelected')}
          className={`h-9 w-9 items-center justify-center rounded-lg border border-blue-300 bg-white active:bg-blue-50 ${
            isTagging ? 'opacity-50' : ''
          }`}
        >
          <Tag size={18} color="#2563eb" />
        </Pressable>
      ) : null}
      {/* 분류를 바꾸러 왔으면 태그 단추 자리에 분류 단추가 선다. */}
      {purpose === 'category' ? (
        <Pressable
          onPress={onCategory}
          disabled={isRecategorizing}
          accessibilityLabel={t('tx.categorySelected')}
          className={`h-9 w-9 items-center justify-center rounded-lg border border-blue-300 bg-white active:bg-blue-50 ${
            isRecategorizing ? 'opacity-50' : ''
          }`}
        >
          <Shapes size={18} color="#2563eb" />
        </Pressable>
      ) : null}

      <Text className="flex-1 text-base font-semibold text-gray-900">
        {t('tx.selected', { count: selectedCount })}
      </Text>

      {purpose === 'delete' ? (
        <Pressable
          onPress={onDelete}
          disabled={isDeleting}
          accessibilityLabel={t('tx.deleteSelected')}
          className={`h-9 w-9 items-center justify-center rounded-lg border border-red-300 bg-white active:bg-red-50 ${
            isDeleting ? 'opacity-50' : ''
          }`}
        >
          <Trash2 size={18} color="#dc2626" />
        </Pressable>
      ) : null}
    </View>
  );
}
