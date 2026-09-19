/*
 * 유이자 할부의 회차 수수료를 한자리에 모아 적는다. 웹의 같은 판을 옮긴 것이다.
 *
 * 원금 회차는 총액을 개월수로 나누면 나오지만, 수수료는 카드사와 남은 원금에 따라
 * 회차마다 조금씩 달라 계산으로는 명세서와 맞출 수 없다. 그래서 그 회차의 주기가
 * 마감되면 여기 떠오르고, 명세서를 보고 적으면 수수료 전표가 하나씩 생긴다.
 *
 * 전표로 남기는 까닭은 부채가 전표 합이기 때문이다. 청구액만 늘리면 갚을 대금과
 * 어긋나고, 전표로 두면 "할부로 얼마를 더 냈나"가 분류 합계에도 남는다.
 *
 * 적을 것이 없으면 아무것도 그리지 않는다.
 */
import { Pressable, Text, TextInput, View } from 'react-native';

import { pendingFeeKey, useCardPendingFees } from '@money/core/hooks/useCardPendingFees';
import { formatDateMarker } from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency } from '@money/core/lib/money';

import { Chips } from './FormFields';

export default function PendingFeePanel({
  cardId,
  projectId,
  personId,
  onOpenEntry,
  onSettled,
}: {
  cardId: string;
  projectId: string | null;
  /** 원 거래를 연다. 어떤 결제의 수수료인지 확인하는 자리다. */
  onOpenEntry?: (entryId: string) => void;
  /** 수수료 전표의 주체. 카드 결제 통장의 주인이다. */
  personId?: string | null;
  /** 적은 뒤 남은 대금과 사용액을 다시 읽도록 부모에게 알린다. */
  onSettled: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const fees = useCardPendingFees(cardId, projectId, () => void onSettled());

  if (fees.items.length === 0) return null;

  const canSave = fees.filled.length > 0 && !!fees.categoryId && !!personId && !fees.isSaving;

  return (
    <View className="gap-3 border-t border-gray-200 pt-4">
      <View>
        <Text className="text-sm font-medium text-gray-700">{t('fee.title')}</Text>
        <Text className="mt-1 text-xs text-gray-500">
          {t('fee.description', { count: fees.items.length })}
        </Text>
      </View>

      {/* 분류는 한 번만 고르면 다음부터 서버가 같은 것을 권한다. */}
      <View>
        <Text className="mb-1 text-xs text-gray-500">{t('fee.category')}</Text>
        <Chips
          options={fees.categories.map((row) => ({ value: row.id, label: row.name }))}
          selected={fees.categoryId}
          onSelect={fees.setCategoryId}
          collapse
        />
      </View>

      {/*
        **거래별로 묶는다.** 사용자가 명세서에서 찾는 단위가 그 거래다.

        묶지 않으면 밀린 회차가 결제일 순으로 섞여 서서, 어느 줄이 어느 거래의 것인지
        설명 글자를 하나하나 읽어야 알 수 있다.
      */}
      {fees.groups.map((group) => (
        <View key={group.planId} className="gap-2 rounded-lg bg-gray-50 p-3">
          <View className="flex-row items-baseline justify-between gap-2">
            <Pressable className="shrink" onPress={() => onOpenEntry?.(group.entryId)}>
              <Text className="text-sm font-medium text-gray-800" numberOfLines={1}>
                {group.title || t('entry.noTitle')}
                {group.merchant && group.title !== group.merchant ? (
                  <Text className="text-xs font-normal text-gray-500"> {group.merchant}</Text>
                ) : null}
              </Text>
            </Pressable>
            <Text className="shrink-0 text-xs text-gray-500">
              {t('fee.groupMeta', {
                months: group.months,
                date: formatDateMarker(group.purchaseDate),
              })}
            </Text>
          </View>

          {group.items.map((item) => {
            const key = pendingFeeKey(item);

            return (
              <View
                key={key}
                className="flex-row items-center gap-2 border-t border-gray-200 pt-2"
              >
                <Text className="w-16 shrink-0 text-xs font-medium text-gray-700">
                  {t('fee.sequence', { index: item.sequence, months: item.months })}
                </Text>
                <Text className="shrink text-xs text-gray-500" numberOfLines={1}>
                  {t('fee.principal', { amount: formatCurrency(item.principal, fees.currency) })} ·{' '}
                  {t('pending.dueDate', { date: formatDateMarker(item.dueDate) })}
                </Text>
                <TextInput
                  value={fees.amounts[key] ?? ''}
                  onChangeText={(next) => fees.setAmount(key, next)}
                  keyboardType="decimal-pad"
                  placeholder={t('fee.amountPlaceholder')}
                  className="ml-auto w-28 shrink-0 rounded border border-gray-300 bg-white px-2 py-1 text-right text-sm text-gray-900"
                />
              </View>
            );
          })}
        </View>
      ))}

      {fees.error ? (
        <Text className="text-xs text-red-600">
          {fees.error === 'FEE_SETTLE_FAILED' ? t('fee.saveFailed') : fees.error}
        </Text>
      ) : null}

      <Pressable
        onPress={() => personId && void fees.save(personId)}
        disabled={!canSave}
        className={`rounded-lg px-4 py-3 ${
          canSave ? 'bg-blue-600 active:bg-blue-700' : 'bg-blue-300'
        }`}
      >
        <Text className="text-center font-semibold text-white">
          {fees.isSaving ? t('fee.saving') : t('fee.save', { count: fees.filled.length })}
        </Text>
      </Pressable>
    </View>
  );
}
