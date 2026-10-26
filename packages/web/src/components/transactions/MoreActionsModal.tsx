'use client';

/*
 * 거래 화면의 더보기 선택창. 고른 거래에 태그 붙이기 · 분류 바꾸기 · 지우기를 고른다.
 *
 * 태그가 위, 지우기가 아래다. 되돌릴 수 있는 일을 먼저 둔다 -- 잘못 누를 때의
 * 값이 다르다.
 */
import { Shapes, Tag, Trash2 } from 'lucide-react';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import Modal from '@/components/Modal';

type SelectPurpose = 'tag' | 'category' | 'delete';

const ACTIONS: Array<{ purpose: SelectPurpose; Icon: typeof Tag; iconClass: string; labelKey: MessageKey }> = [
  { purpose: 'tag', Icon: Tag, iconClass: 'h-4 w-4 text-blue-600', labelKey: 'tx.tagSelect' },
  { purpose: 'category', Icon: Shapes, iconClass: 'h-4 w-4 text-blue-600', labelKey: 'tx.categorySelect' },
  { purpose: 'delete', Icon: Trash2, iconClass: 'h-4 w-4 text-red-600', labelKey: 'tx.select' },
];

export default function MoreActionsModal({
  isOpen,
  onClose,
  onChoose,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** 고른 일. 부르는 쪽이 창을 닫고 그 목적의 고르기를 시작한다. */
  onChoose: (purpose: SelectPurpose) => void;
}) {
  const { t } = useTranslation();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('tx.more')}>
      {ACTIONS.map(({ purpose, Icon, iconClass, labelKey }) => (
        <button
          key={purpose}
          type="button"
          onClick={() => onChoose(purpose)}
          className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left hover:bg-gray-50"
        >
          <Icon className={iconClass} aria-hidden />
          <span className="text-base text-gray-900">{t(labelKey)}</span>
        </button>
      ))}
    </Modal>
  );
}
