'use client';

import { type CardDto } from '@money/types';
import { useCardPendingFees, pendingFeeKey } from '@money/core/hooks/useCardPendingFees';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency } from '@money/core/lib/money';
import { formatDateMarker } from '@money/core/lib/datetime';
import CustomSelect from '@/components/CustomSelect';

interface Props {
  cardId: string;
  projectId: string | null;
  /** 원 거래를 연다. 어떤 결제의 수수료인지 확인하는 자리다. */
  onOpenEntry?: (entryId: string) => void;
  /** 수수료 전표의 주체. 카드 결제 통장의 주인이다. */
  personId?: string;
  /** 적고 난 뒤 남은 대금과 사용액을 다시 읽도록 부모에게 알린다. */
  onSettled: () => void;
}

/**
 * 유이자 할부의 회차 수수료를 한 화면에 모아 적는다.
 *
 * 원금 회차는 총액을 개월수로 나누면 나오지만, 수수료는 카드사와 남은 원금에 따라
 * 회차마다 조금씩 달라 계산으로는 명세서와 맞출 수 없다. 그래서 그 회차의 주기가
 * 마감되면 여기 떠오르고, 명세서를 보고 적으면 수수료 전표가 하나씩 생긴다.
 *
 * 전표로 남기는 까닭은 부채가 전표 합이기 때문이다. 청구액만 늘리면 갚을 대금과
 * 어긋나고, 전표로 두면 "할부로 얼마를 더 냈나"가 분류 합계에도 남는다.
 *
 * 적을 것이 없으면 아무것도 그리지 않는다. 외화 청구액 확정(`PendingRatePanel`)과
 * 같은 자리, 같은 손짓이다.
 */
export default function PendingFeePanel({
  cardId,
  projectId,
  personId,
  onOpenEntry,
  onSettled,
}: Props) {
  const { t } = useTranslation();
  const fees = useCardPendingFees(cardId, projectId, onSettled);

  if (fees.items.length === 0) return null;

  const canSave = fees.filled.length > 0 && !!fees.categoryId && !!personId && !fees.isSaving;

  return (
    <div className="pt-4 border-t space-y-3">
      <div>
        <h3 className="text-sm font-medium text-gray-700">{t('fee.title')}</h3>
        <p className="mt-1 text-xs text-gray-500">
          {t('fee.description', { count: fees.items.length })}
        </p>
      </div>

      {/* 분류는 한 번만 고르면 다음부터 서버가 같은 것을 권한다. */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">{t('fee.category')}</label>
        <CustomSelect
          options={fees.categories.map((row) => ({ id: row.id, name: row.name }))}
          value={fees.categoryId}
          onChange={fees.setCategoryId}
          placeholder={t('fee.categoryPlaceholder')}
        />
      </div>

      {/*
        **거래별로 묶는다.** 사용자가 명세서에서 찾는 단위가 그 거래다.

        묶지 않으면 밀린 회차가 결제일 순으로 섞여 선다. 할부가 둘만 되어도 "냉장고
        2회차, 자동차 5회차, 냉장고 3회차"처럼 늘어서, 어느 줄이 어느 거래의 것인지
        설명 글자를 하나하나 읽어야 알 수 있다.
      */}
      {fees.groups.map((group) => (
        <div key={group.planId} className="rounded-lg bg-gray-50 p-3 space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <button
              type="button"
              onClick={() => onOpenEntry?.(group.entryId)}
              className="truncate text-sm font-medium text-gray-800 hover:underline"
            >
              {group.title || t('entry.noTitle')}
              {group.merchant && group.title !== group.merchant && (
                <span className="ml-1 text-xs font-normal text-gray-500">{group.merchant}</span>
              )}
            </button>
            <span className="shrink-0 text-xs text-gray-500">
              {t('fee.groupMeta', {
                months: group.months,
                date: formatDateMarker(group.purchaseDate),
              })}
            </span>
          </div>

          {group.items.map((item: CardDto.PendingFeeItem) => {
            const key = pendingFeeKey(item);

            return (
              <div key={key} className="flex items-center gap-2 border-t border-gray-200 pt-2">
                <span className="w-20 shrink-0 text-xs font-medium text-gray-700">
                  {t('fee.sequence', { index: item.sequence, months: item.months })}
                </span>
                <span className="shrink text-xs text-gray-500 truncate">
                  {t('fee.principal', { amount: formatCurrency(item.principal, fees.currency) })} ·{' '}
                  {t('pending.dueDate', { date: formatDateMarker(item.dueDate) })}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={fees.amounts[key] ?? ''}
                  onChange={(e) => fees.setAmount(key, e.target.value)}
                  placeholder={t('fee.amountPlaceholder')}
                  className="ml-auto w-28 shrink-0 px-2 py-1 border rounded text-sm text-right"
                />
              </div>
            );
          })}
        </div>
      ))}

      {fees.error && (
        <p className="text-xs text-red-600">
          {fees.error === 'FEE_SETTLE_FAILED' ? t('fee.saveFailed') : fees.error}
        </p>
      )}

      <button
        type="button"
        onClick={() => personId && fees.save(personId)}
        disabled={!canSave}
        className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40"
      >
        {fees.isSaving ? t('fee.saving') : t('fee.save', { count: fees.filled.length })}
      </button>
    </div>
  );
}
