'use client';

import { ReactNode, useEffect, useRef } from 'react';

import { useCloseOnBack } from '@/hooks/useCloseOnBack';

/**
 * 팝업이 열릴 때 포커스를 줄 후보.
 *
 * `[data-autofocus]`가 있으면 그것을 먼저 쓴다. 첫 입력란이 실제로 먼저 채우는
 * 칸이 아닌 화면(예: 거래 추가는 금액부터 입력한다)에서 쓰기 위한 장치다.
 */
/* 잠긴 입력란에는 포커스가 가지 않는다. 그때는 아래 첫 입력란 규칙으로 넘어간다. */
const AUTOFOCUS_SELECTOR = '[data-autofocus]:not([disabled]):not([readonly])';
const FIRST_FIELD_SELECTOR = [
  'input:not([type="hidden"]):not([disabled]):not([readonly])',
  'textarea:not([disabled]):not([readonly])',
  'select:not([disabled])',
].join(', ');

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /**
   * 스크롤해도 항상 보이는 하단 버튼 영역.
   *
   * 본문이 길면 제출 버튼이 화면 밖으로 밀려나 스크롤하지 않으면 보이지 않았다.
   * 헤더의 닫기 버튼처럼 여기도 고정해 둔다.
   *
   * 주의: 이 영역은 children 안의 `<form>` **밖**이다. 제출 버튼을 여기에 두려면
   * `<form id="x">` 와 `<button type="submit" form="x">` 로 묶어야 한다.
   */
  footer?: ReactNode;
}

export default function Modal({ isOpen, onClose, title, children, footer }: ModalProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  // 휴대폰의 뒤로가기는 화면을 나가는 것이 아니라 이 팝업을 닫는다.
  useCloseOnBack(isOpen, onClose);

  /**
   * 열릴 때 첫 입력란에 포커스를 준다.
   *
   * 본문(`bodyRef`)만 훑는다. 헤더의 닫기 버튼이나 하단 버튼이 잡히면
   * 곧바로 타이핑을 시작할 수 없다. 입력란이 하나도 없는 팝업(선택형 팝업 등)은
   * 아무것도 포커스하지 않는다.
   */
  useEffect(() => {
    if (!isOpen) return;

    // 렌더 직후에는 자식이 아직 붙지 않은 경우가 있어 다음 프레임에 찾는다.
    const frame = requestAnimationFrame(() => {
      const body = bodyRef.current;
      if (!body) return;

      const target =
        body.querySelector<HTMLElement>(AUTOFOCUS_SELECTOR) ??
        body.querySelector<HTMLElement>(FIRST_FIELD_SELECTOR);
      target?.focus();
    });

    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
          >
            ×
          </button>
        </div>
        <div ref={bodyRef} className="p-6">
          {children}
        </div>
        {footer && (
          <div className="sticky bottom-0 z-10 bg-white border-t border-gray-200 px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
