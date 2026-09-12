'use client';

import { ReactNode, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from '@money/core/lib/i18n';

import { useCloseOnBack } from '@/hooks/useCloseOnBack';
import { useSheetDrag } from '@/hooks/useSheetDrag';

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
  /**
   * 머리글 오른쪽, 닫기 앞에 서는 단추.
   *
   * 팝업 전체에 걸리는 일(예: 상세의 내용 복사)을 두는 자리다. 본문에 두면 스크롤에
   * 밀려 보이지 않고, 하단 버튼 자리는 그 팝업의 본론(수정·삭제)이 쓴다.
   */
  headerAction?: ReactNode;
}

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  headerAction,
}: ModalProps) {
  const { t } = useTranslation();
  const bodyRef = useRef<HTMLDivElement>(null);

  // 휴대폰의 뒤로가기는 화면을 나가는 것이 아니라 이 팝업을 닫는다.
  useCloseOnBack(isOpen, onClose);

  /* 아래에 붙는 창은 머리글을 잡아 내려서도 닫는다. 넓은 화면에서는 아무 일도 하지 않는다. */
  const { backdropRef, sheetRef, handleRef } = useSheetDrag(isOpen, onClose);

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
    // 좁은 화면에서는 아래에 붙는다. 넓은 화면에서만 가운데로 온다.
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center"
    >
      {/*
        아래에서 올라오는 창. 좁은 화면에서는 폭을 다 쓰고 위쪽 모서리만 둥글다
        (아래는 화면 끝에 붙어 있어 둥글릴 자리가 없다).
      */}
      <div
        ref={sheetRef}
        className="dialog-enter w-full max-h-[90vh] overflow-y-auto rounded-t-2xl bg-white shadow-lg md:mx-4 md:max-w-md md:rounded-lg"
      >
        {/*
          잡아 내리는 자리. 손잡이 막대와 머리글이 한 덩어리다.

          touch-none 은 브라우저가 이 자리의 세로 손짓을 스크롤로 먼저 가져가지 못하게
          막는다. 그것이 없으면 창은 한 픽셀도 따라 내려가지 않는다.
        */}
        <div ref={handleRef} className="sticky top-0 z-10 touch-none bg-white md:touch-auto">
          {/*
            손잡이 막대.

            끌 수 있다는 것은 눌러 보기 전에는 보이지 않는다. 아래에 붙는 창마다 같은
            자리에 같은 막대를 두어, 한 번 배운 손이 다음 창에서도 통하게 한다.
          */}
          <div className="flex justify-center pb-1 pt-2 md:hidden">
            <span className="h-1 w-10 rounded-full bg-gray-300" />
          </div>
          <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-6 py-4">
            <h2 className="min-w-0 truncate text-lg font-bold text-gray-900">{title}</h2>
            <div className="flex items-center gap-3">
              {headerAction}
              {/*
                닫기. 글자 "×" 가 아니라 아이콘이다.

                글자로 두면 그 칸 안에서 글자가 어디에 놓이는지를 글꼴이 정한다. ×(곱셈
                기호)의 먹은 글자 가운데가 아니라 수학 축 언저리에 그려져, 같은 크기의
                네모에 넣어도 옆의 아이콘보다 한두 픽셀 아래에 선다. 그 한두 픽셀 때문에
                제목과 아이콘이 올라간 것처럼 읽힌다. 같은 자리에 같은 방식으로 그려지는
                아이콘으로 두면 넷이 한 축에 선다.
              */}
              <button
                onClick={onClose}
                aria-label={t('common.close')}
                title={t('common.close')}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
          </div>
        </div>
        <div
          ref={bodyRef}
          /* 아래에 붙는 창이라 마지막 줄이 홈 표시줄에 가리지 않게 그만큼 더 띄운다. */
          className="p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:pb-6"
        >
          {children}
        </div>
        {footer && (
          <div className="sticky bottom-0 z-10 border-t border-gray-200 bg-white px-6 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:pb-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
