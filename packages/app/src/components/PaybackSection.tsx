/**
 * 거래 상세의 페이백 칸 (PAYBACK_DESIGN.md 7단계). 웹의 PaybackSection 과 같은 칸이다.
 *
 *   - **지출**: 결제할 때 깎인 차감과 받은 환불·페이백을 줄별로, 그 합과 "페이백 추가". 합이 원거래보다
 *     많으면 알린다.
 *   - **페이백**: 무엇의 페이백인가 -- 원거래의 설명·날짜·금액·분류. 누르면 원거래를 연다.
 *
 * 받은 페이백은 사본에서 읽는다 (사본의 `entry.paybackOfEntryId`). 끊겨 있어도 보인다.
 */
import { Pressable, Text, View } from 'react-native';
import { Plus } from 'lucide-react-native';
import { originalEntry, type EntryLine, type EntryListItem } from '@money/types';
import { usePaybackOrigin } from '@money/core/hooks/usePaybackOrigin';
import { paybackGroupSummary, usePaybacks } from '@money/core/hooks/usePaybacks';
import { formatDate } from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency } from '@money/core/lib/money';
import { useProject, useProjectDisplayCurrency, useProjectTimeZone } from '@money/core/store/project';

export default function PaybackSection({
  entry,
  onAdd,
  onOpen,
}: {
  entry: EntryListItem;
  /** "페이백 추가". 없으면 단추를 그리지 않는다 (읽기 전용 구성원). */
  onAdd?: (original: EntryListItem) => void;
  /** 받은 페이백 한 줄이나 페이백의 원거래를 눌렀을 때. 없으면 누를 수 없다. */
  onOpen?: (entry: EntryListItem) => void;
}) {
  const { t } = useTranslation();
  const projectId = useProject((state) => state.selectedProjectId);
  const timeZone = useProjectTimeZone();
  const currency = useProjectDisplayCurrency();
  const paybacks = usePaybacks(entry, projectId);
  const origin = usePaybackOrigin(entry, projectId);

  if (entry.kind === 'payback') {
    /*
     * 무엇의 페이백인가. 원거래의 설명·날짜·금액과 받은 줄의 분류를 적고, 누르면 그 원거래를
     * 연다 (웹의 같은 칸과 같다). 지워진 원거래와 읽지 못한 원거래를 가른다.
     */
    return (
      <View className="flex-row items-start justify-between gap-4 border-b border-gray-100 py-2.5">
        <Text className="text-sm text-gray-500">{t('payback.origin')}</Text>
        {!entry.paybackOfEntryId ? (
          <Text className="flex-1 text-right text-sm text-gray-500">{t('payback.unlinked')}</Text>
        ) : origin.failed ? (
          <Text className="flex-1 text-right text-sm text-red-700">{t('payback.originLoadFailed')}</Text>
        ) : origin.original ? (
          <Pressable
            disabled={!onOpen}
            onPress={() => onOpen?.(origin.original!)}
            accessibilityRole="button"
            className="flex-1 items-end active:opacity-60"
          >
            <Text className="text-right text-[15px] text-gray-900">
              {origin.original.description || origin.line?.categoryName || t('entry.noTitle')}
            </Text>
            <Text className="text-right text-xs text-gray-500">
              {formatDate(origin.original.date, timeZone)} · -{formatCurrency(origin.original.amount, currency)}
              {origin.line ? ` · ${origin.line.categoryName}` : ''}
            </Text>
          </Pressable>
        ) : (
          <Text className="flex-1 text-right text-sm text-gray-500">
            {entry.paybackOfDate ? formatDate(entry.paybackOfDate, timeZone) : '-'}
          </Text>
        )}
      </View>
    );
  }

  if (entry.kind !== 'expense') return null;

  const renderItem = (item: EntryListItem) => (
    <Pressable
      key={item.id}
      disabled={!onOpen}
      onPress={() => onOpen?.(item)}
      className="flex-row items-center justify-between gap-3 rounded px-1 py-1 active:bg-gray-50"
    >
      <Text className="text-sm text-gray-700">
        {formatDate(item.date, timeZone)} · {t(`payback.type.${item.paybackType ?? 'payback'}`)} ·{' '}
        {item.cardName ?? item.accountName ?? t('editor.noMethod')}
      </Text>
      <Text className="text-sm text-green-600">+{formatCurrency(item.amount, currency)}</Text>
    </Pressable>
  );

  const whole = originalEntry(entry);
  const isSplit = whole.lines.length > 1;
  const money = (amount: number, code?: string) => formatCurrency(amount, code ?? currency);
  const isEmpty = paybacks.items.length === 0 && paybacks.byLine.length === 0;

  return (
    <View className="border-b border-gray-100 py-2.5">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm text-gray-500">
          {t(paybacks.hasDiscount ? 'payback.titleWithDiscount' : 'payback.title')}
        </Text>
        {onAdd ? (
          <Pressable
            onPress={() => onAdd(whole)}
            accessibilityRole="button"
            className="flex-row items-center gap-1 rounded-lg px-2 py-1 active:bg-blue-50"
          >
            <Plus size={16} color="#2563eb" />
            <Text className="text-sm text-blue-600">{t('payback.add')}</Text>
          </Pressable>
        ) : null}
      </View>
      {paybacks.failed ? <Text className="mt-1 text-sm text-red-700">{t('payback.loadFailed')}</Text> : null}
      {isEmpty ? (
        paybacks.failed ? null : <Text className="mt-1 text-sm text-gray-500">{t('payback.none')}</Text>
      ) : (
        <View className="mt-1 gap-1">
          {paybacks.byLine.length > 0
            ? paybacks.byLine.map((group) => (
                // 줄별로 묶는다. 차감과 돌려받은 것, 끝에 "정가 · 차감 · 돌려받음 · 남음" (웹과 같다).
                <View key={group.line?.lineKey ?? 'stray'} className="gap-1">
                  {isSplit || !group.line ? (
                    <View className="flex-row items-baseline justify-between gap-3 px-1">
                      <Text className="flex-1 text-sm font-medium text-gray-900" numberOfLines={1}>
                        {group.line ? lineLabel(group.line) : t('payback.lineUnknown')}
                      </Text>
                      {group.line ? (
                        <Text className="text-sm text-gray-500">{formatCurrency(group.line.amount, currency)}</Text>
                      ) : null}
                    </View>
                  ) : null}
                  {group.discount !== null ? (
                    <View className="flex-row items-center justify-between gap-3 px-1 py-1">
                      <Text className="text-sm text-gray-700">{t('payback.discountRow')}</Text>
                      <Text className="text-sm text-gray-700">
                        {money(group.discount, group.discountCurrency ?? undefined)}
                      </Text>
                    </View>
                  ) : null}
                  {group.items.map(renderItem)}
                  {group.remaining !== null ? (
                    <Text className="px-1 text-right text-xs text-gray-500">{paybackGroupSummary(group, t, money)}</Text>
                  ) : null}
                </View>
              ))
            : paybacks.items.map(renderItem)}
          {paybacks.items.length > 0 ? (
            <Text className="text-right text-sm text-gray-700">
              {t('payback.total', { amount: formatCurrency(paybacks.total, currency) })}
            </Text>
          ) : null}
        </View>
      )}
      {paybacks.isOver ? <Text className="mt-1 text-sm text-amber-700">{t('payback.over')}</Text> : null}
    </View>
  );
}

function lineLabel(line: EntryLine): string {
  return line.parentCategoryName ? `${line.parentCategoryName} · ${line.categoryName}` : line.categoryName || '-';
}
