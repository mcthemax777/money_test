'use client';

import { useTranslation } from '@/lib/i18n';

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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-lg p-6 max-w-sm w-full mx-4">
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
