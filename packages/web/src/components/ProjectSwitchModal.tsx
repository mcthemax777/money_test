'use client';

import { useCloseOnBack } from '@/hooks/useCloseOnBack';
import { useSheetDrag } from '@/hooks/useSheetDrag';
import { useTranslation } from '@money/core/lib/i18n';

/** 프로젝트를 바꾸기 전에 한 번 묻는 창. useProjectSwitch가 여는 상태를 들고 있다. */
export default function ProjectSwitchModal({
  isOpen,
  isChanging,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  isChanging: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  // 공용 Modal을 쓰지 않는 창이라 뒤로가기와 끌어 내리기를 여기서 받는다.
  useCloseOnBack(isOpen, onCancel);
  /* 바꾸는 중에는 끌어도 닫히지 않는다. 단추도 그동안 잠겨 있다. */
  const { backdropRef, sheetRef, handleRef } = useSheetDrag(isOpen && !isChanging, onCancel);

  if (!isOpen) return null;

  return (
    /* 공용 Modal 과 같은 모양으로 선다 -- 좁은 화면에서는 아래에서 올라오고, 넓으면 가운데다. */
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center"
    >
      <div
        ref={sheetRef}
        className="dialog-enter w-full rounded-t-2xl bg-white p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-lg md:mx-4 md:max-w-sm md:rounded-lg md:pb-6"
      >
        {/* 잡아 내리는 자리. 공용 Modal 의 머리글과 같은 노릇을 제목 줄이 한다. */}
        <div ref={handleRef} className="touch-none md:touch-auto">
          <div className="-mt-3 mb-2 flex justify-center md:hidden">
            <span className="h-1 w-10 rounded-full bg-gray-300" />
          </div>
          <h2 className="mb-4 text-lg font-semibold text-gray-900">{t('projectSwitch.title')}</h2>
        </div>
        <p className="text-gray-600 mb-6">{t('projectSwitch.body')}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={isChanging}
            className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={isChanging}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 flex items-center justify-center"
          >
            {isChanging ? (
              <>
                <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2" />
                {t('common.changing')}
              </>
            ) : (
              t('common.change')
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
