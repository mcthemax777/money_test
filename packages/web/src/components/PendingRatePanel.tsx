'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { currencyDecimals, type CardDto } from '@money/types';
import { apiClient } from '@money/core/lib/api-client';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency, formatNumber, toAmountString, toNumber } from '@money/core/lib/money';
import { formatDateMarker } from '@money/core/lib/datetime';

interface Props {
  cardId: string;
  /** 확정 뒤 남은 대금과 사용액을 다시 읽도록 부모에게 알린다. */
  onSettled: () => void;
}

/**
 * 청구액이 확정되지 않은 외화 결제를 한 화면에 모아 확정한다.
 *
 * 원화 카드로 외화를 쓰면 청구액은 결제일에 카드사가 정한다(자기 환율 + 수수료).
 * 그때까지 원장에는 추정 환산액이 들어 있는데, 이것을 거래 하나씩 열어 고치면
 * 원화 거래 수십 건 사이에서 외화 건을 찾아다녀야 한다. 그래서 이 카드의
 * 미확정 건만 주기별로 모아 놓고 한 번에 저장한다.
 *
 * 입력은 **청구액**을 받는다. 명세서에서 눈으로 읽는 값이 금액이기 때문이다.
 * 환율은 서버가 청구액과 원 통화 금액의 비로 유도한다. 명세서에 적용환율만
 * 한 줄로 적혀 있는 경우를 위해 "환율로 한 번에 채우기"도 함께 둔다.
 *
 * 확정할 것이 없으면 아무것도 그리지 않는다.
 */
export default function PendingRatePanel({ cardId, onSettled }: Props) {
  const { t } = useTranslation();
  const [data, setData] = useState<CardDto.PendingRatesResponse | null>(null);
  const [billed, setBilled] = useState<Record<string, string>>({});
  const [bulkRate, setBulkRate] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      setData(await apiClient.getCardPendingRates(cardId));
    } catch (err) {
      console.error('미확정 외화 결제 조회 실패:', err);
      setData(null);
    }
  }, [cardId]);

  useEffect(() => {
    setBilled({});
    setBulkRate('');
    load();
  }, [load]);

  const items = data?.items ?? [];
  const currency = data?.currency ?? 'KRW';

  // 주기별로 묶는다. 사용자가 대조하는 단위가 명세서 한 장이기 때문이다.
  const groups = useMemo(() => {
    const byMonth = new Map<string, CardDto.PendingRateItem[]>();
    for (const item of items) {
      byMonth.set(item.closingMonth, [...(byMonth.get(item.closingMonth) ?? []), item]);
    }
    return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  /** 채워 넣은 것만 보낸다. 빈 칸은 아직 명세서를 못 본 건이다. */
  const filled = items.filter((item) => toNumber(billed[item.entryId]) > 0);

  /**
   * 환율로 청구액 칸을 채운다.
   *
   * 저장은 청구액으로 한 경로만 쓴다. 화면에 보이는 숫자와 저장되는 값이 같아야
   * 사용자가 저장 전에 확인할 수 있고, 반올림 결과도 미리 드러난다.
   */
  const applyRate = () => {
    const rate = toNumber(bulkRate);
    if (rate <= 0) return;

    // 카드 통화의 자릿수로 맞춘다. 원은 원 단위, 달러는 센트까지다.
    const decimals = currencyDecimals(currency);
    setBilled(
      Object.fromEntries(
        items.map((item) => [
          item.entryId,
          (toNumber(item.originalAmount) * rate).toFixed(decimals),
        ]),
      ),
    );
  };

  const save = async () => {
    if (filled.length === 0) return;
    try {
      setIsSaving(true);
      setError('');
      await apiClient.settleCardRates(cardId, {
        items: filled.map((item) => ({
          entryId: item.entryId,
          billedAmount: toAmountString(billed[item.entryId]),
        })),
      });
      setBilled({});
      setBulkRate('');
      await load();
      onSettled();
    } catch (err: any) {
      setError(err?.response?.data?.message || t('pending.confirmFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  if (items.length === 0) return null;

  return (
    <div className="pt-4 border-t space-y-3">
      <div>
        <h3 className="text-sm font-medium text-gray-700">{t('pending.title')}</h3>
        <p className="mt-1 text-xs text-gray-500">
          {t('pending.description', { count: items.length })}
        </p>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={bulkRate}
          onChange={(e) => setBulkRate(e.target.value)}
          placeholder={t('pending.ratePlaceholder')}
          className="flex-1 px-3 py-2 border rounded-lg text-sm"
        />
        <button
          type="button"
          onClick={applyRate}
          disabled={toNumber(bulkRate) <= 0}
          className="px-3 py-2 text-sm border rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          {t('pending.fillAll')}
        </button>
      </div>

      {groups.map(([closingMonth, group]) => (
        <div key={closingMonth} className="space-y-1">
          <div className="flex justify-between text-xs text-gray-500 px-1">
            <span>{t('pending.closingMonth', { month: closingMonth })}</span>
            <span>{t('pending.dueDate', { date: formatDateMarker(group[0].dueDate) })}</span>
          </div>

          {group.map((item) => {
            const value = billed[item.entryId] ?? '';
            const amount = toNumber(value);
            // 확정하면 실제로 적용될 환율. 저장 전에 눈으로 확인할 수 있어야 한다.
            const rate = amount > 0 ? amount / toNumber(item.originalAmount) : 0;

            return (
              <div key={item.entryId} className="px-3 py-2 bg-gray-50 rounded-lg space-y-1">
                <div className="flex justify-between items-baseline gap-2">
                  <span className="text-sm text-gray-800 truncate">
                    {item.description}
                    {item.merchant && (
                      <span className="ml-1 text-xs text-gray-500">{item.merchant}</span>
                    )}
                  </span>
                  <span className="text-sm font-medium text-gray-900 shrink-0">
                    {formatCurrency(item.originalAmount, item.originalCurrency)}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 shrink-0">
                    {formatDateMarker(item.date)} · {t('pending.estimated')}{' '}
                    {formatCurrency(item.estimatedAmount, currency)}
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={value}
                    onChange={(e) =>
                      setBilled((prev) => ({ ...prev, [item.entryId]: e.target.value }))
                    }
                    placeholder={t('pending.amountPlaceholder')}
                    className="ml-auto w-32 px-2 py-1 border rounded text-sm text-right"
                  />
                </div>

                {rate > 0 && (
                  <p className="text-xs text-gray-500 text-right">
                    {t('pending.rate', { rate: formatNumber(Math.round(rate * 100) / 100) })}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {error && <p className="text-xs text-red-600">{error}</p>}

      <button
        type="button"
        onClick={save}
        disabled={filled.length === 0 || isSaving}
        className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40"
      >
        {isSaving ? t('pending.confirming') : t('pending.confirm', { count: filled.length })}
      </button>
    </div>
  );
}
