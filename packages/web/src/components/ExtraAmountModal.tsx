'use client';

import { useEffect, useState } from 'react';

import Modal from '@/components/Modal';
import { toNumber } from '@/lib/money';

interface ExtraAmountModalProps {
  isOpen: boolean;
  /** 지출이면 "과소비", 수입이면 "추가 수입" */
  kind: 'expense' | 'income';
  /** 거래 금액. 이 값이 처음 값이자 최대값이다. */
  maxAmount: string;
  /** 지금 담긴 값. 처음 여는 경우 빈 문자열이면 거래 금액으로 채운다. */
  value: string;
  onCancel: () => void;
  onConfirm: (amount: string) => void;
}

/**
 * 과소비·추가 수입 금액을 적는 창.
 *
 * 체크만으로는 "이 거래 전체가 과소비"밖에 표현하지 못한다. 10만 원을 썼는데
 * 3만 원어치만 과했던 경우가 더 흔하다. 그래서 체크하면 금액을 묻는다.
 *
 * 처음 값은 거래 금액이다. 줄이는 쪽으로만 고치게 두어, 아무것도 손대지 않고
 * 확인만 눌러도 "전액이 과소비"라는 뜻이 된다. 0을 적으면 일반 거래와 같다.
 */
export default function ExtraAmountModal({
  isOpen,
  kind,
  maxAmount,
  value,
  onCancel,
  onConfirm,
}: ExtraAmountModalProps) {
  const label = kind === 'income' ? '추가 수입' : '과소비';
  const [text, setText] = useState('');

  // 열 때마다 지금 값으로 되돌린다. 닫고 다시 열면 고치다 만 값이 남으면 안 된다.
  useEffect(() => {
    if (!isOpen) return;
    setText(toNumber(value) > 0 ? value : maxAmount);
  }, [isOpen, value, maxAmount]);

  const max = toNumber(maxAmount);
  const amount = toNumber(text);
  const isBlank = text.trim() === '';
  const error = isBlank
    ? '금액을 입력하세요.'
    : amount < 0
      ? '0보다 작을 수 없습니다.'
      : amount > max
        ? '거래 금액보다 클 수 없습니다.'
        : '';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={`${label} 금액`}
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => onConfirm(String(amount))}
            disabled={Boolean(error)}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300"
          >
            확인
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          거래 금액 {max.toLocaleString('ko-KR')} 중 얼마를 {label}로 셀지 적습니다. 그대로 두면
          전액이 {label}입니다.
        </p>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          value={text}
          data-autofocus
          onChange={(event) => setText(event.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : (
          <p className="text-sm text-gray-500">
            0을 적으면 일반 {kind === 'income' ? '수입' : '지출'}과 같습니다.
          </p>
        )}
      </div>
    </Modal>
  );
}
