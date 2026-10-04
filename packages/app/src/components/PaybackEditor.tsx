/**
 * 페이백을 적고 고치는 팝업 (PAYBACK_DESIGN.md 7단계). 웹의 PaybackEditor 와 같은 칸이다.
 *
 * 거래 편집기와 따로 둔다. 페이백은 원거래의 한 줄을 되돌린 돈이라 고를 것이 적다 --
 * 금액·날짜·들어온 곳·설명, 그리고 분할된 원거래면 어느 줄인지. 분류는 그 줄의 것이라
 * 고르지 않는다. 규칙(검사·짐·저장 창구)은 core 의 `useEntryForm` 이 갖는다.
 */
import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { PAYBACK_TYPES, type EntryListItem } from '@money/types';
import { parseMethod } from '@money/core/data/entry-form';
import { useEntryForm } from '@money/core/hooks/useEntryForm';
import { useInstallmentRefund } from '@money/core/hooks/useInstallmentRefund';
import { usePaybackOrigin } from '@money/core/hooks/usePaybackOrigin';
import { formatYearMonth } from '@money/core/lib/datetime';
import { ENTRY_FORM_VIOLATION_KEY } from '@money/core/lib/entry-form-messages';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency } from '@money/core/lib/money';
import {
  useMyPersonId,
  useProject,
  useProjectDisplayCurrency,
  useProjectLedgerCurrency,
  useProjectTimeZone,
} from '@money/core/store/project';

import DatePickerPanel from './DatePickerPanel';
import { CheckRow, Chips, Field, PickerButton } from './FormFields';
import Modal from './Modal';

export interface PaybackTarget {
  /** 새로 적을 때의 원거래. */
  original?: EntryListItem;
  /** 고칠 페이백. */
  editing?: EntryListItem;
}

export default function PaybackEditor({
  target,
  onClose,
  onSaved,
}: {
  /** null 이면 닫힌 상태다. */
  target: PaybackTarget | null;
  onClose: () => void;
  /** 저장·삭제가 끝난 뒤. 목록을 다시 읽는 자리다. */
  onSaved?: () => void;
}) {
  const { t } = useTranslation();
  const timeZone = useProjectTimeZone();
  const projectId = useProject((state) => state.selectedProjectId);
  const myPersonId = useMyPersonId();
  const displayCurrency = useProjectDisplayCurrency();
  const ledgerCurrency = useProjectLedgerCurrency();
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  const form = useEntryForm({
    projectId,
    timeZone,
    defaultPersonId: myPersonId ?? '',
    onSaved: () => onSaved?.(),
  });
  const { values, setField, violation } = form;

  /*
   * 열 때 한 번 채운다. 열 수 없는 것(지출이 아닌 원거래)은 닫는다 -- 빈 폼이 저장되는
   * 것보다 닫히는 편이 낫다 (웹과 같다).
   */
  useEffect(() => {
    if (!target) return;
    setIsCalendarOpen(false);
    const opened = target.editing
      ? form.startEdit(target.editing)
      : target.original
        ? form.startPayback(target.original)
        : false;
    if (!opened) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const original = target?.original ?? null;
  // 분할된 원거래면 어느 줄인지 고른다. 고칠 때는 줄을 바꾸지 않는다.
  const lines = original && original.lines.length > 1 ? original.lines : [];
  const labelOf = (row: { categoryName: string | null; parentCategoryName: string | null }) =>
    row.parentCategoryName ? `${row.parentCategoryName} > ${row.categoryName}` : row.categoryName;
  const categoryLabel = target?.editing
    ? labelOf(target.editing)
    : original?.lines.length === 1
      ? labelOf(original.lines[0])
      : null;

  /*
   * 할부 원거래면 "할부 처리" 상자 (PAYBACK_DESIGN.md 7-9, 웹과 같다). 고칠 때는 원거래를
   * 읽어 온다 -- 목록 한 줄은 페이백 자신이라 원거래의 회차를 들고 있지 않다.
   */
  const origin = usePaybackOrigin(target?.editing ?? null, projectId);
  const installment = useInstallmentRefund({
    original: original ?? origin.original,
    editingId: target?.editing?.id ?? null,
    values,
    setField,
    timeZone,
    sameCurrency: displayCurrency === ledgerCurrency,
  });
  const money = (amount: string) => formatCurrency(amount, displayCurrency);
  const monthLabel = (yearMonth: string) => {
    const [year, month] = yearMonth.split('-').map(Number);
    return year && month ? formatYearMonth(year, month) : yearMonth;
  };

  const violationKey = violation ? ENTRY_FORM_VIOLATION_KEY[violation.code] : undefined;
  const message =
    form.error || (violation ? (violationKey ? t(violationKey) : violation.code) : '');

  const openTimePicker = () => {
    const [hour, minute] = values.timeKey.split(':');
    const base = new Date();
    base.setHours(Number(hour) || 0, Number(minute) || 0, 0, 0);
    DateTimePickerAndroid.open({
      value: base,
      mode: 'time',
      is24Hour: true,
      onValueChange: (_event, date) => {
        const pad = (value: number) => String(value).padStart(2, '0');
        setField('timeKey', `${pad(date.getHours())}:${pad(date.getMinutes())}`);
      },
    });
  };

  const save = async () => {
    if (await form.save()) onClose();
  };

  // 지우기 전에 한 번 묻는다. 거래 편집기와 같은 문구다.
  const remove = () => {
    Alert.alert(t('account.deleteConfirm'), '', [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('entryForm.delete'),
        style: 'destructive',
        onPress: () => {
          void form.remove().then((done) => {
            if (done) onClose();
          });
        },
      },
    ]);
  };

  return (
    <Modal
      isOpen={target !== null}
      onClose={onClose}
      title={t(target?.editing ? 'payback.editTitle' : 'payback.newTitle')}
      footer={
        <View className="flex-row gap-2">
          {form.isEditing ? (
            <Pressable
              disabled={form.isSubmitting}
              onPress={remove}
              className={`rounded-lg border border-red-300 px-4 py-3 ${form.isSubmitting ? 'opacity-50' : ''}`}
            >
              <Text className="text-sm font-medium text-red-600">
                {t(form.isSubmitting ? 'entryForm.deleting' : 'entryForm.delete')}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            disabled={form.isSubmitting}
            onPress={save}
            className={`flex-1 items-center rounded-lg bg-blue-600 px-4 py-3 ${form.isSubmitting ? 'opacity-50' : ''}`}
          >
            <Text className="text-base font-semibold text-white">
              {t(form.isSubmitting ? 'common.saving' : 'common.save')}
            </Text>
          </Pressable>
        </View>
      }
    >
      <View className="gap-5">
        {message ? (
          <View className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
            <Text className="text-sm text-red-600">{message}</Text>
          </View>
        ) : null}

        <Text className="text-xs text-gray-500">{t('payback.hint')}</Text>

        {/* 환불인가 페이백인가. 바꾸면 아래 실적 칸이 그 종류의 기본값으로 돌아간다. */}
        <Field label={t('payback.type')}>
          <Chips
            options={PAYBACK_TYPES.map((type) => ({ value: type, label: t(`payback.type.${type}`) }))}
            selected={values.paybackType}
            onSelect={(value) => setField('paybackType', value as (typeof PAYBACK_TYPES)[number])}
          />
        </Field>

        {lines.length > 0 ? (
          <Field label={t('payback.line')} invalid={violation?.field === 'paybackOfLineKey'}>
            <Chips
              options={lines.map((line) => ({
                value: line.lineKey,
                label: `${line.categoryName} · ${formatCurrency(line.amount, displayCurrency)}`,
              }))}
              selected={values.paybackOfLineKey}
              onSelect={(value) => {
                const line = lines.find((row) => row.lineKey === value);
                if (line) form.choosePaybackLine(line);
              }}
            />
          </Field>
        ) : categoryLabel ? (
          <Field label={t('tx.detail.category')}>
            <Text className="rounded-lg bg-gray-50 px-3 py-3 text-base text-gray-900">{categoryLabel}</Text>
          </Field>
        ) : null}

        <Field label={t('editor.amount')} invalid={violation?.field === 'amount'}>
          <TextInput
            value={values.amount}
            onChangeText={(text) => setField('amount', text)}
            keyboardType="numeric"
            autoFocus
            placeholder="0"
            className="rounded-lg border border-gray-300 px-3 py-3 text-base text-gray-900"
          />
        </Field>

        <View className="flex-row gap-3">
          <View className="flex-1">
            <Field label={t('editor.date')} invalid={violation?.field === 'dateKey'}>
              <PickerButton
                icon="date"
                value={values.dateKey}
                placeholder="YYYY-MM-DD"
                isOpen={isCalendarOpen}
                onPress={() => setIsCalendarOpen(!isCalendarOpen)}
              />
            </Field>
          </View>
          <View className="w-32">
            <Field label={t('editor.time')} invalid={violation?.field === 'timeKey'}>
              <PickerButton
                icon="time"
                value={values.timeKey}
                placeholder="HH:MM"
                isOpen={false}
                onPress={openTimePicker}
              />
            </Field>
          </View>
        </View>

        {isCalendarOpen ? (
          <DatePickerPanel
            value={values.dateKey}
            onSelect={(dateKey) => {
              setField('dateKey', dateKey);
              setIsCalendarOpen(false);
            }}
          />
        ) : null}

        <Field label={t('payback.method')} invalid={violation?.field === 'method'}>
          {form.methodChoices.length === 0 ? (
            <Text className="text-sm text-gray-500">{t('entryForm.noMethods')}</Text>
          ) : (
            <Chips
              options={form.methodChoices.map((choice) => ({
                value: choice.value,
                label: choice.name,
                group: form.showAssetOwner ? choice.owner : undefined,
              }))}
              selected={values.method}
              onSelect={(value) => setField('method', value)}
              collapse
            />
          )}
        </Field>

        {/*
          할부 처리 (7-9, 웹과 같다). 환불한 다음 달 회차부터 남은 할부를 줄이고, 다 못 줄인 몫은
          환불한 달에 한꺼번에 돌아온 돈이 된다. 줄일 수 없으면 까닭만 적는다.
        */}
        {installment.isInstallment ? (
          <View className="gap-2 rounded-lg border border-gray-200 p-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-sm font-medium text-gray-700">{t('payback.installment.title')}</Text>
              {installment.applies ? (
                <Pressable
                  onPress={installment.cancelAll}
                  accessibilityRole="button"
                  className="rounded-lg px-2 py-1 active:bg-blue-50"
                >
                  <Text className="text-sm text-blue-600">{t('payback.installment.cancelAll')}</Text>
                </Pressable>
              ) : null}
            </View>
            {installment.applies ? (
              <>
                {installment.rows.map((row) => (
                  <View key={row.index} className="flex-row items-center gap-2">
                    <View className="flex-1">
                      <Text className={`text-sm ${row.past ? 'text-gray-400' : 'text-gray-900'}`}>
                        {t('payback.installment.round', { index: row.index })} · {money(row.before)}
                      </Text>
                      <Text className="text-xs text-gray-400">
                        {monthLabel(row.yearMonth)}
                        {row.past ? ` · ${t('payback.installment.past')}` : ''}
                      </Text>
                    </View>
                    <TextInput
                      value={row.after}
                      onChangeText={(text) => installment.setAfter(row.index, text)}
                      keyboardType="numeric"
                      accessibilityLabel={`${t('payback.installment.round', { index: row.index })} ${t('payback.installment.after')}`}
                      className={`w-32 rounded-lg border px-3 py-2 text-right text-base text-gray-900 ${
                        Number(row.after) < 0 ? 'border-red-300 bg-red-50' : 'border-gray-300'
                      }`}
                    />
                  </View>
                ))}
                <View className="border-t border-gray-100 pt-2">
                  <Text className="text-sm text-gray-900">
                    {t('payback.installment.lump', {
                      month: monthLabel(installment.refundYearMonth),
                      amount: money(installment.lump),
                    })}
                  </Text>
                  <Text className="text-sm text-gray-600">
                    {installment.remaining.length > 0
                      ? t('payback.installment.remaining', {
                          count: installment.remaining.length,
                          amount: money(
                            String(installment.remaining.reduce((sum, row) => sum + Number(row.after), 0)),
                          ),
                        })
                      : t('payback.installment.none')}
                  </Text>
                </View>
                {installment.overAmount ? (
                  <Text className="text-xs text-red-600">{t('payback.installment.overAmount')}</Text>
                ) : null}
                {installment.overShare ? (
                  <Text className="text-xs text-red-600">{t('payback.installment.overShare')}</Text>
                ) : null}
                <Text className="text-xs text-gray-500">{t('payback.installment.hint')}</Text>
              </>
            ) : (
              <Text className="text-xs text-gray-500">
                {t(
                  installment.blockedBy === 'not-refund'
                    ? 'payback.installment.cashback'
                    : installment.blockedBy === 'currency'
                      ? 'payback.installment.currency'
                      : 'payback.installment.otherMethod',
                )}
              </Text>
            )}
          </View>
        ) : null}

        {/* 카드 실적에서도 뺄지. 카드로 받았을 때만 뜬다 (웹과 같다). */}
        {parseMethod(values.method).cardId ? (
          <CheckRow
            checked={values.countsPerformance}
            onToggle={() => setField('countsPerformance', !values.countsPerformance)}
            label={t('payback.countsPerformance')}
            hint={t('payback.countsPerformanceHint')}
          />
        ) : null}

        <Field label={t('editor.description')}>
          <TextInput
            value={values.description}
            onChangeText={(text) => setField('description', text)}
            className="rounded-lg border border-gray-300 px-3 py-3 text-base text-gray-900"
          />
        </Field>
      </View>
    </Modal>
  );
}
