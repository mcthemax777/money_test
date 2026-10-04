/**
 * 거래 폼의 페이백 칸 (PAYBACK_DESIGN.md 7단계 보강). 웹의 PaybackFormSection 과 같은 칸이다.
 *
 *   - **받은 페이백**: 고치는 중인 지출에 이미 걸린 것. 누르면 페이백 편집기가 열린다.
 *   - **함께 저장할 페이백**: 여기서 적는 줄. 지출을 저장한 직후 그 지출에 걸려 저장된다
 *     (core 의 `usePaybackDrafts`). 새 지출에도 적을 수 있다.
 */
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Plus, X } from 'lucide-react-native';
import { PAYBACK_TYPES, type EntryListItem, type PaybackType } from '@money/types';
import type { PaymentChoice } from '@money/core/hooks/useEntryForm';
import { usePaybackDrafts } from '@money/core/hooks/usePaybackDrafts';
import { usePaybacks } from '@money/core/hooks/usePaybacks';
import { formatDate } from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency } from '@money/core/lib/money';
import { useProject, useProjectDisplayCurrency, useProjectTimeZone } from '@money/core/store/project';

import DatePickerPanel from './DatePickerPanel';
import { Chips, Field, PickerButton } from './FormFields';

export default function PaybackFormSection({
  original,
  drafts,
  lines,
  methodChoices,
  showAssetOwner,
  defaultMethod,
  reloadToken = 0,
  onOpenPayback,
}: {
  /** 고치는 중인 지출. 새로 적는 중이면 null 이다 -- 받은 페이백이 아직 없다. */
  original: EntryListItem | null;
  drafts: ReturnType<typeof usePaybackDrafts>;
  /** 지금 폼의 분류 줄. 분할이면 여럿이고, 페이백마다 어느 줄인지 고른다. */
  lines: Array<{ lineKey: string; categoryId: string; label: string }>;
  /** 들어온 곳으로 고를 것. 거래 폼의 결제수단 목록 그대로다. */
  methodChoices: PaymentChoice[];
  showAssetOwner: boolean;
  /** 새 줄의 들어온 곳. 지금 폼에서 고른 결제수단이다. */
  defaultMethod: string;
  reloadToken?: number;
  onOpenPayback: (payback: EntryListItem) => void;
}) {
  const { t } = useTranslation();
  const projectId = useProject((state) => state.selectedProjectId);
  const timeZone = useProjectTimeZone();
  const currency = useProjectDisplayCurrency();
  const received = usePaybacks(original, projectId, reloadToken);
  /** 달력을 펼친 줄. 한 번에 하나만 펼친다. */
  const [calendarKey, setCalendarKey] = useState<string | null>(null);

  return (
    <Field
      label={t('payback.title')}
      onAdd={() =>
        drafts.add({ method: defaultMethod, lineKey: lines.length === 1 ? lines[0].lineKey : '' })
      }
      addLabel={t('payback.add')}
    >
      {original && (received.items.length > 0 || received.failed) ? (
        <View className="mb-2 rounded-lg bg-gray-50 px-3 py-2">
          <Text className="mb-1 text-xs text-gray-500">{t('payback.received')}</Text>
          {received.failed ? (
            <Text className="text-sm text-red-700">{t('payback.loadFailed')}</Text>
          ) : (
            received.items.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => onOpenPayback(item)}
                className="flex-row items-center justify-between gap-3 py-1 active:opacity-60"
              >
                <Text className="text-sm text-gray-700">
                  {formatDate(item.date, timeZone)} · {t(`payback.type.${item.paybackType ?? 'payback'}`)} ·{' '}
                  {item.categoryName ?? ''}
                </Text>
                <Text className="text-sm text-green-600">+{formatCurrency(item.amount, currency)}</Text>
              </Pressable>
            ))
          )}
          {received.isOver ? <Text className="mt-1 text-sm text-amber-700">{t('payback.over')}</Text> : null}
        </View>
      ) : null}

      {drafts.drafts.length > 0 ? <Text className="mb-1 text-xs text-gray-500">{t('payback.toAdd')}</Text> : null}
      {drafts.drafts.map((draft) => {
        const invalid = drafts.violation?.key === draft.key;
        return (
          <View
            key={draft.key}
            className={`mb-2 gap-2 rounded-lg border p-2 ${invalid ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
          >
            <View className="flex-row items-center gap-2">
              <TextInput
                value={draft.amount}
                onChangeText={(text) => drafts.update(draft.key, { amount: text })}
                keyboardType="numeric"
                placeholder={t('editor.amount')}
                accessibilityLabel={t('editor.amount')}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900"
              />
              <View className="flex-1">
                <PickerButton
                  icon="date"
                  value={draft.dateKey}
                  placeholder="YYYY-MM-DD"
                  isOpen={calendarKey === draft.key}
                  onPress={() => setCalendarKey(calendarKey === draft.key ? null : draft.key)}
                />
              </View>
              <Pressable
                onPress={() => drafts.remove(draft.key)}
                accessibilityRole="button"
                accessibilityLabel={t('payback.remove')}
                hitSlop={8}
                className="rounded-lg p-1 active:bg-gray-100"
              >
                <X size={18} color="#6b7280" />
              </Pressable>
            </View>
            {calendarKey === draft.key ? (
              <DatePickerPanel
                value={draft.dateKey}
                onSelect={(dateKey) => {
                  drafts.update(draft.key, { dateKey });
                  setCalendarKey(null);
                }}
              />
            ) : null}
            <Chips
              options={PAYBACK_TYPES.map((type) => ({ value: type, label: t(`payback.type.${type}`) }))}
              selected={draft.paybackType}
              onSelect={(value) => drafts.update(draft.key, { paybackType: value as PaybackType })}
            />
            <Chips
              options={methodChoices.map((choice) => ({
                value: choice.value,
                label: choice.name,
                group: showAssetOwner ? choice.owner : undefined,
              }))}
              selected={draft.method}
              onSelect={(value) => drafts.update(draft.key, { method: value })}
              collapse
            />
            {lines.length > 1 ? (
              <Chips
                options={lines.map((line) => ({ value: line.lineKey, label: line.label }))}
                selected={draft.lineKey}
                onSelect={(value) => drafts.update(draft.key, { lineKey: value })}
              />
            ) : null}
          </View>
        );
      })}
      {drafts.drafts.length === 0 && !(original && received.items.length > 0) ? (
        <View className="flex-row items-center gap-1">
          <Plus size={14} color="#9ca3af" />
          <Text className="text-sm text-gray-400">{t('payback.none')}</Text>
        </View>
      ) : null}
    </Field>
  );
}
