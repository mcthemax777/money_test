'use client';

import { ReactNode } from 'react';

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
        <div className="p-6">
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
