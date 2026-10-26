/*
 * 거래 화면의 더보기 선택창. 고른 거래에 태그 붙이기 · 분류 바꾸기 · 지우기를 고른다.
 *
 * 거래 화면(TransactionsScreen)에서 떼어 냈다 (2026-10-26). 메뉴가 늘면 이 자리에 줄을 더한다.
 */
import type { ReactNode } from 'react';
import { Pressable, Text } from 'react-native';
import { Shapes, Tag, Trash2 } from 'lucide-react-native';

import { useTranslation } from '@money/core/lib/i18n';
import type { SelectPurpose } from '@money/core/hooks/useTransactions';

import Modal from './Modal';

export default function TransactionMoreModal({
  isOpen,
  onClose,
  onChoose,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** 고른 일로 거래 고르기를 시작한다. 창을 닫는 것은 부르는 쪽이 맡는다. */
  onChoose: (purpose: SelectPurpose) => void;
}) {
  const { t } = useTranslation();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('tx.more')}>
      {/*
        태그가 위, 지우기가 아래다. 되돌릴 수 있는 일을 먼저 둔다 -- 손가락이
        닿는 목록에서 지우기가 위에 있으면 잘못 누를 때의 값이 크다.
      */}
      <MoreRow
        icon={<Tag size={18} color="#2563eb" />}
        label={t('tx.tagSelect')}
        onPress={() => onChoose('tag')}
      />
      <MoreRow
        icon={<Shapes size={18} color="#2563eb" />}
        label={t('tx.categorySelect')}
        onPress={() => onChoose('category')}
      />
      <MoreRow
        icon={<Trash2 size={18} color="#dc2626" />}
        label={t('tx.select')}
        onPress={() => onChoose('delete')}
      />
    </Modal>
  );
}

/** 더보기의 한 줄. 아이콘과 이름. */
function MoreRow({
  icon,
  label,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-lg px-2 py-3 active:bg-gray-50"
    >
      {icon}
      <Text className="text-base text-gray-900">{label}</Text>
    </Pressable>
  );
}
