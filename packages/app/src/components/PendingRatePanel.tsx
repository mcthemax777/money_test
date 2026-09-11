/*
 * 청구액이 확정되지 않은 외화 결제를 한자리에 모아 확정한다. 웹의 같은 판을 옮긴 것이다.
 *
 * 원화 카드로 외화를 쓰면 청구액은 결제일에 카드사가 정한다(자기 환율 + 수수료).
 * 그때까지 원장에는 추정 환산액이 들어 있는데, 이것을 거래 하나씩 열어 고치면 원화
 * 거래 수십 건 사이에서 외화 건을 찾아다녀야 한다. 그래서 이 카드의 미확정 건만
 * 주기별로 모아 놓고 한 번에 저장한다.
 *
 * 입력은 **청구액**을 받는다. 명세서에서 눈으로 읽는 값이 금액이기 때문이다. 환율은
 * 서버가 청구액과 원 통화 금액의 비로 유도한다. 명세서에 적용환율만 한 줄로 적혀
 * 있는 경우를 위해 "한 번에 채우기"도 함께 둔다.
 *
 * 확정할 것이 없으면 아무것도 그리지 않는다.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useMirrorVersion } from '@money/core/hooks/useMirrorVersion';
import { apiClient } from '@money/core/lib/api-client';
import { useApiError } from '@money/core/lib/api-error';
import { formatDateMarker } from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency, formatNumber, toAmountString, toNumber } from '@money/core/lib/money';
import {
  billedFromRate,
  derivedRate,
  filledPendingItems,
  groupPendingByMonth,
} from '@money/core/lib/pending-rates';
import type { CardDto } from '@money/types';

export default function PendingRatePanel({
  cardId,
  onSettled,
}: {
  cardId: string;
  /** 확정 뒤 남은 대금과 사용액을 다시 읽도록 부모에게 알린다. */
  onSettled: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const { messageOf } = useApiError();
  // 남이 그 카드로 결제한 외화 건도 여기 올라와야 한다.
  const mirrorVersion = useMirrorVersion();

  const [data, setData] = useState<CardDto.PendingRatesResponse | null>(null);
  /** 적어 넣은 청구액. 전표 id -> 글자 그대로의 값 */
  const [billed, setBilled] = useState<Record<string, string>>({});
  const [bulkRate, setBulkRate] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      setData(await apiClient.getCardPendingRates(cardId));
    } catch {
      setData(null);
    }
  }, [cardId]);

  useEffect(() => {
    setBilled({});
    setBulkRate('');
    load();
  }, [load, mirrorVersion]);

  const items = data?.items ?? [];
  const currency = data?.currency ?? 'KRW';

  // 묶는 법과 채우는 법은 core 가 정한다 (웹의 같은 판과 같은 규칙이다).
  const groups = groupPendingByMonth(items);
  /** 채워 넣은 것만 보낸다. 빈 칸은 아직 명세서를 못 본 건이다. */
  const filled = filledPendingItems(items, billed);
  const canFillAll = toNumber(bulkRate) > 0;

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
      await onSettled();
    } catch (err: any) {
      setError(messageOf(err, 'pending.confirmFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  if (items.length === 0) return null;

  return (
    <View className="gap-3 border-t border-gray-200 pt-4">
      <View>
        <Text className="text-sm font-medium text-gray-700">{t('pending.title')}</Text>
        <Text className="mt-1 text-xs text-gray-500">
          {t('pending.description', { count: items.length })}
        </Text>
      </View>

      {/* 명세서에 적용환율만 한 줄로 적혀 있을 때. 칸을 다 채워 놓고 눈으로 확인한다. */}
      <View className="flex-row gap-2">
        <TextInput
          value={bulkRate}
          onChangeText={setBulkRate}
          keyboardType="decimal-pad"
          placeholder={t('pending.ratePlaceholder')}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
        />
        <Pressable
          onPress={() => setBilled(billedFromRate(items, toNumber(bulkRate), currency))}
          disabled={!canFillAll}
          className={`justify-center rounded-lg border border-gray-300 px-3 ${
            canFillAll ? 'active:bg-gray-50' : 'opacity-40'
          }`}
        >
          <Text className="text-sm text-gray-700">{t('pending.fillAll')}</Text>
        </Pressable>
      </View>

      {groups.map(([closingMonth, group]) => (
        <View key={closingMonth} className="gap-1">
          <View className="flex-row justify-between px-1">
            <Text className="text-xs text-gray-500">
              {t('pending.closingMonth', { month: closingMonth })}
            </Text>
            <Text className="text-xs text-gray-500">
              {t('pending.dueDate', { date: formatDateMarker(group[0].dueDate) })}
            </Text>
          </View>

          {group.map((item) => {
            const value = billed[item.entryId] ?? '';
            // 확정하면 실제로 적용될 환율. 저장 전에 눈으로 확인할 수 있어야 한다.
            const rate = derivedRate(value, item.originalAmount);

            return (
              <View key={item.entryId} className="gap-1 rounded-lg bg-gray-50 px-3 py-2">
                <View className="flex-row items-baseline justify-between gap-2">
                  <Text className="shrink text-sm text-gray-800" numberOfLines={1}>
                    {item.description}
                    {item.merchant ? (
                      <Text className="text-xs text-gray-500"> {item.merchant}</Text>
                    ) : null}
                  </Text>
                  <Text className="shrink-0 text-sm font-medium text-gray-900">
                    {formatCurrency(item.originalAmount, item.originalCurrency)}
                  </Text>
                </View>

                <View className="flex-row items-center gap-2">
                  <Text className="shrink text-xs text-gray-500" numberOfLines={1}>
                    {formatDateMarker(item.date)} · {t('pending.estimated')}{' '}
                    {formatCurrency(item.estimatedAmount, currency)}
                  </Text>
                  <TextInput
                    value={value}
                    onChangeText={(next) =>
                      setBilled((prev) => ({ ...prev, [item.entryId]: next }))
                    }
                    keyboardType="decimal-pad"
                    placeholder={t('pending.amountPlaceholder')}
                    className="ml-auto w-32 rounded border border-gray-300 bg-white px-2 py-1 text-right text-sm text-gray-900"
                  />
                </View>

                {rate > 0 ? (
                  <Text className="text-right text-xs text-gray-500">
                    {t('pending.rate', { rate: formatNumber(rate) })}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      ))}

      {error ? <Text className="text-xs text-red-600">{error}</Text> : null}

      <Pressable
        onPress={() => void save()}
        disabled={filled.length === 0 || isSaving}
        className={`rounded-lg px-4 py-3 ${
          filled.length === 0 || isSaving ? 'bg-blue-300' : 'bg-blue-600 active:bg-blue-700'
        }`}
      >
        <Text className="text-center font-semibold text-white">
          {isSaving ? t('pending.confirming') : t('pending.confirm', { count: filled.length })}
        </Text>
      </Pressable>
    </View>
  );
}
