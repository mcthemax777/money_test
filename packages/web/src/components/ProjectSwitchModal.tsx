'use client';

import { useCloseOnBack } from '@/hooks/useCloseOnBack';
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

  // 공용 Modal을 쓰지 않는 창이라 여기서도 뒤로가기를 받는다.
  useCloseOnBack(isOpen, onCancel);

  if (!isOpen) return null;

  return (
    /* 공용 Modal 과 같은 모양으로 선다 -- 좁은 화면에서는 아래에서 올라오고, 넓으면 가운데다. */
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center">
      <div className="dialog-enter w-full rounded-t-2xl bg-white p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-lg md:mx-4 md:max-w-sm md:rounded-lg md:pb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('projectSwitch.title')}</h2>
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
