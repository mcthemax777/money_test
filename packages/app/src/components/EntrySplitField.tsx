/*
 * 거래 입력의 분할 칸. 줄마다 분류와 금액(지출이면 깎인 금액·태그까지)을 따로 적는다.
 *
 * 거래 입력(EntryEditor)에서 떼어 냈다 (2026-10-26). 나눈 줄이 하나라도 있을 때만 선다 --
 * 줄이 있는 동안에는 위의 분류 칸을 감춘다. 둘이 함께 보이면 어느 쪽이 저장되는지 알 수
 * 없고, 실제로 저장되는 것은 줄들뿐이다.
 */
import { Pressable, Text, TextInput, View } from 'react-native';

import { useTranslation } from '@money/core/lib/i18n';
import type { useEntryForm } from '@money/core/hooks/useEntryForm';
import { showDiscountPerformance } from '@money/core/data/entry-form';
import { formatNumber } from '@money/core/lib/money';

import { CategoryChips, CheckRow, Field } from './FormFields';
import TagChips from './TagChips';

export default function EntrySplitField({
  form,
  isLineDiscountShown,
  onOpenLineDiscount,
  onCloseLineDiscount,
}: {
  form: ReturnType<typeof useEntryForm>;
  /** 그 줄의 차감 칸이 펴져 있는가. 적어 둔 값이 있으면 편 것으로 본다. */
  isLineDiscountShown: (split: { lineKey: string; discountAmount: string }) => boolean;
  onOpenLineDiscount: (lineKey: string) => void;
  onCloseLineDiscount: (lineKey: string) => void;
}) {
  const { t } = useTranslation();
  const { values, setField, violation } = form;

  return (
    <Field label={t('editor.split')} invalid={violation?.field === 'splits'}>
      <View className="gap-3">
        {values.splits.map((split, index) => (
          /* 줄 키로 든다. 차례 번호면 가운데 줄을 지울 때 입력 칸의 상태가 옆 줄로 옮겨 간다. */
          <View key={split.lineKey} className="gap-2 rounded-lg border border-gray-200 p-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-xs font-medium text-gray-500">
                {t('editor.splitRow', { index: index + 1 })}
              </Text>
              <Pressable
                onPress={() => form.removeSplit(index)}
                hitSlop={8}
                accessibilityLabel={t('editor.splitRemove')}
              >
                <Text className="text-sm text-gray-400">×</Text>
              </Pressable>
            </View>

            <TextInput
              value={split.amount}
              onChangeText={(text) => form.setSplit(index, 'amount', text)}
              keyboardType="numeric"
              placeholder="0"
              className="rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900"
            />

            {/*
              이 줄에서 깎인 금액.

              줄마다 따로 받는다. 여행경비만 환불받았는데 비율로 나누면 식비
              줄까지 함께 깎여, 분류별 분석이 사실과 어긋난다.

              나누지 않은 거래와 같이 그 줄 금액 바로 아래에 "할인·차감 추가" 글자로 접어
              두고, 펴면 "닫기"로 도로 접는다 (2026-10-11 사용자 요청, 웹과 같다).
            */}
            {values.kind === 'expense' && !isLineDiscountShown(split) ? (
              <Pressable
                onPress={() => onOpenLineDiscount(split.lineKey)}
                accessibilityRole="button"
                hitSlop={8}
                className="self-start active:opacity-60"
              >
                <Text className="text-sm font-medium text-blue-600">
                  + {t('editor.discountAdd')}
                </Text>
              </Pressable>
            ) : null}
            {values.kind === 'expense' && isLineDiscountShown(split) ? (
              <>
                <View className="flex-row items-center justify-between gap-2">
                  <Text className="text-xs font-medium text-gray-500">
                    {t('editor.discount')}
                  </Text>
                  <Pressable
                    onPress={() => {
                      form.setSplit(index, 'discountAmount', '');
                      onCloseLineDiscount(split.lineKey);
                    }}
                    hitSlop={8}
                    accessibilityRole="button"
                    className="rounded px-2 py-0.5 active:bg-gray-100"
                  >
                    <Text className="text-xs font-medium text-gray-500">{t('common.close')}</Text>
                  </Pressable>
                </View>
                <TextInput
                  value={split.discountAmount}
                  onChangeText={(text) => form.setSplit(index, 'discountAmount', text)}
                  keyboardType="numeric"
                  placeholder="0"
                  className="rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900"
                />

                {/*
                  깎인 만큼 실적도 줄일지. 환불액을 적은 줄 바로 아래에 둔다.

                  **값은 거래에 하나뿐이다.** 깎인 금액은 줄마다 다르지만 그것을
                  실적에서 뺄지는 카드사의 방침 하나라, 어느 줄의 체크를 건드려도
                  나머지 줄의 체크가 같이 움직인다.
                */}
                {showDiscountPerformance({
                  kind: values.kind,
                  discountAmount: split.discountAmount,
                  countsPerformance: values.countsPerformance,
                  isCard: Boolean(form.selectedCard),
                  isLedgerCurrency: !values.currency,
                }) ? (
                  <CheckRow
                    checked={values.discountCountsPerformance}
                    onToggle={() =>
                      setField(
                        'discountCountsPerformance',
                        !values.discountCountsPerformance,
                      )
                    }
                    label={t('editor.discountCountsPerformance')}
                    hint={t('editor.discountCountsPerformanceHint')}
                  />
                ) : null}
              </>
            ) : null}

            {form.categoryChoices.length === 0 ? (
              <Text className="text-sm text-gray-500">{t('entryForm.noCategories')}</Text>
            ) : (
              <CategoryChips
                categories={form.categoryChoices}
                selected={split.categoryId}
                onSelect={(value) => form.setSplit(index, 'categoryId', value)}
              />
            )}

            {/*
              이 줄의 태그.

              태그가 줄에 붙으므로 여기서 고른다. 나눈 두 줄이 서로 다른 태그를
              갖는 것이 이 바꿈의 요점이다.
            */}
            {form.lists.tags.length > 0 ? (
              <>
                <Text className="text-xs font-medium text-gray-500">{t('editor.tagsOptional')}</Text>
                <TagChips
                  tags={form.lists.tags}
                  selected={split.tagIds}
                  onToggle={(tagId) =>
                    form.setSplit(
                      index,
                      'tagIds',
                      split.tagIds.includes(tagId)
                        ? split.tagIds.filter((id) => id !== tagId)
                        : [...split.tagIds, tagId],
                    )
                  }
                />
              </>
            ) : null}
          </View>
        ))}

        <Pressable
          onPress={form.addSplit}
          className="items-center rounded-lg border border-gray-300 px-3 py-2"
        >
          <Text className="text-sm text-gray-700">{t('editor.splitAdd')}</Text>
        </Pressable>

        {/*
        남은 금액을 보여 준다. 합이 맞아야 저장되므로, 저장을 눌러 보고서야
        알게 하지 않는다.
      */}
        <Text className="text-xs text-gray-500">
          {t('editor.splitLeft', { amount: formatNumber(form.splitLeft) })}
        </Text>
        <Text className="text-xs text-gray-500">{t('editor.splitHint')}</Text>
      </View>
    </Field>
  );
}
