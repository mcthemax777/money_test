'use client';

import Modal from '@/components/Modal';

/** 무엇을 추가할지 고르는 큰 버튼 하나 */
export interface Choice {
  key: string;
  /** 이모지 하나. 없으면 라벨만 보인다 */
  icon?: string;
  label: string;
  description?: string;
  tone?: 'blue' | 'green' | 'purple';
  onSelect: () => void;
}

const TONE_CLASS: Record<NonNullable<Choice['tone']>, string> = {
  blue: 'bg-blue-50 border-blue-200 hover:bg-blue-100',
  green: 'bg-green-50 border-green-200 hover:bg-green-100',
  purple: 'bg-purple-50 border-purple-200 hover:bg-purple-100',
};

interface ChoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  choices: Choice[];
}

/**
 * "무엇을 추가할까요" 선택 팝업.
 *
 * 자산 화면의 추가 버튼과 거래 입력 폼의 결제수단 추가 버튼이 같은 팝업을 쓴다.
 * 결제수단 드롭다운은 계좌와 카드를 한 목록에 합쳤기 때문에 추가 버튼도 하나뿐이고,
 * 무엇을 만들지는 여기서 고른다.
 */
export default function ChoiceModal({ isOpen, onClose, title, choices }: ChoiceModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div className="space-y-3">
        {choices.map((choice) => (
          <button
            key={choice.key}
            onClick={choice.onSelect}
            className={`w-full px-4 py-3 text-left border rounded-lg transition ${
              TONE_CLASS[choice.tone ?? 'blue']
            }`}
          >
            <p className="font-semibold text-gray-900">
              {choice.icon ? `${choice.icon} ` : ''}
              {choice.label}
            </p>
            {choice.description && (
              <p className="text-xs text-gray-600 mt-1">{choice.description}</p>
            )}
          </button>
        ))}
      </div>
    </Modal>
  );
}
