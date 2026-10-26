'use client';

/*
 * 나누지 않은 거래의 차감·취소 칸과, 깎인 만큼 실적도 줄일지 묻는 체크.
 *
 * 폼 바로 아래에 형제로 서는 칸들이라 감싸는 상자 없이 조각(fragment)으로 돌려준다.
 */
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency, toNumber } from '@money/core/lib/money';
import type { EntryFormValues, SetEntryForm } from './editor-form';

export default function DiscountFields({
  formData,
  setFormData,
  hasSplits,
  isDiscountShown,
  onOpen,
  onClose,
  showPerformance,
}: {
  formData: EntryFormValues;
  setFormData: SetEntryForm;
  hasSplits: boolean;
  /** 차감 칸을 폈는가 (적어 둔 값이 있으면 펴 둔다). */
  isDiscountShown: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** "깎인 만큼 실적도 줄이기" 체크를 그릴지 (core 의 showDiscountPerformance). */
  showPerformance: boolean;
}) {
  const { t } = useTranslation();

  return (
    <>
      {/*
        차감·취소. 포인트 사용, 자동할인, 그리고 취소가 이 칸 하나로 들어간다.

        금액 바로 아래에 "할인·차감 추가" 단추로 접어 둔다 (2026-10-10 사용자 요청) -- 자주 쓰지
        않는 칸이다. 적어 둔 값이 있으면(고치기) 처음부터 펴 둔다.

        셋은 전표에서 같은 모양이다 -- 정가는 위 금액 칸에 그대로 두고, 여기에는
        덜 나간 몫을 적는다. 전액을 적으면 0원 거래로 남는다. 지우지 않는 것은
        있었던 일이기 때문이다.

        **나눈 거래에서는 감춘다.** 그때는 깎인 금액을 줄마다 적으므로(위의 줄
        칸) 여기 한 칸을 더 두면 어느 쪽이 저장되는지 알 수 없다.
      */}
      {formData.type === 'expense' && !hasSplits && !isDiscountShown && (
        /* 글자만 둔다 (2026-10-11 사용자 요청, 앱과 같다). */
        <button
          type="button"
          onClick={onOpen}
          className="-mt-2 rounded text-sm font-medium text-blue-600 transition-colors hover:text-blue-700"
        >
          + {t('editor.discountAdd')}
        </button>
      )}
      {formData.type === 'expense' && !hasSplits && isDiscountShown && (
        <div className="unfold">
          <div className="mb-1 flex items-center justify-between gap-2">
            <label className="block text-sm font-medium text-gray-700">{t('editor.discount')}</label>
            {/*
              잘못 눌러 편 칸을 도로 접는다 (2026-10-11 사용자 요청, 앱과 같다). 적은 값도 함께
              지운다 -- 접힌 채 값이 남으면 보이지 않는 차감이 저장된다.
            */}
            <button
              type="button"
              onClick={() => {
                setFormData({ ...formData, discountAmount: '' });
                onClose();
              }}
              className="rounded px-2 py-0.5 text-sm font-medium text-gray-500 transition hover:bg-gray-100"
            >
              {t('common.close')}
            </button>
          </div>
          <input
            type="number"
            step="any"
            value={formData.discountAmount}
            onChange={(e) => setFormData({ ...formData, discountAmount: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="0"
          />
          <p className="mt-1 text-xs text-gray-500">{t('editor.discountHint')}</p>

          {/* 실제로 빠지는 금액. 저장하고 목록에서 보고서야 알게 하지 않는다. */}
          {toNumber(formData.discountAmount) > 0 && (
            <p className="mt-2 text-xs font-medium text-gray-700">
              {t('editor.netAmount', {
                amount: formatCurrency(
                  toNumber(formData.amount) - toNumber(formData.discountAmount),
                  formData.currency,
                ),
              })}
            </p>
          )}
        </div>
      )}

      {/*
        깎인 만큼 실적도 줄일지. 기본은 줄인다 -- 다리가 이미 순액이라 그것이
        지금까지의 동작이다. 카드사가 환불을 실적에서 빼지 않는 경우가 있어,
        끄면 실적만 정가로 센다.

        **나눈 거래에서는 감춘다.** 그때는 환불액을 적는 줄마다 같은 체크가
        바로 아래에 서 있다. 값은 어느 쪽이든 하나라 함께 움직인다.

        거래 자체를 실적에서 뺐으면 뜨지 않는다. 그때는 어느 쪽이든 실적이
        움직이지 않아 물을 것이 없다.
      */}
      {!hasSplits && showPerformance && (
        <label className="flex items-start gap-2 rounded-lg border border-gray-200 p-3 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.discountCountsPerformance}
            onChange={(e) =>
              setFormData({
                ...formData,
                discountCountsPerformance: e.target.checked,
              })
            }
            className="mt-0.5 h-4 w-4"
          />
          <span className="flex-1">
            <span className="block text-sm text-gray-900">{t('editor.discountCountsPerformance')}</span>
            <span className="mt-0.5 block text-xs text-gray-500">
              {t('editor.discountCountsPerformanceHint')}
            </span>
          </span>
        </label>
      )}
    </>
  );
}
