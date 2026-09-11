/*
 * 신용카드 정산. 웹의 같은 판을 앱에 옮긴 것이다.
 *
 * 남은 대금과, 카드사와 통장 사이 자금 이동(대금 결제·환불 입금)을 적는 자리다.
 * 셈은 core 의 card-settlement 가 한다 -- 같은 카드의 "남은 대금"이 웹과 앱에서 다른
 * 부호로 보이면 안 된다.
 *
 * 주기별 사용액 그래프는 이 판이 그리지 않는다. 카드 상세가 그 위에 따로 세운다
 * (웹도 사용액 그래프가 이 박스 위에 있다).
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';

import { useMirrorVersion } from '@money/core/hooks/useMirrorVersion';
import { apiClient } from '@money/core/lib/api-client';
import { useApiError } from '@money/core/lib/api-error';
import { outstandingOf, overTransferOf } from '@money/core/lib/card-settlement';
import { nowTimeKey, todayKey } from '@money/core/lib/datetime';
import { useTranslation } from '@money/core/lib/i18n';
import { formatCurrency, toAmountString } from '@money/core/lib/money';
import type { Card, CardUsage } from '@money/core/lib/types';
import { useProjectTimeZone } from '@money/core/store/project';
import { zonedFormValueToUtc, type CardTransferDirection } from '@money/types';

import DatePickerPanel from './DatePickerPanel';
import { Chips, Field, PickerButton } from './FormFields';
import Modal from './Modal';

/** 카드사와 통장 사이 자금이 오가는 방향 */
const DIRECTIONS: CardTransferDirection[] = ['payment', 'refund'];

export default function CardSettlementPanel({
  card,
  /**
   * 결제 통장의 주인. 대금 전표에 사람을 달아야 해서 필요하다.
   *
   * 없으면 대금을 기록할 수 없다. 통장은 있는데 주인이 없는 상태라 앱에서 고칠 곳도
   * 여기가 아니므로, 버튼을 감추고 이유를 적는다.
   */
  paymentAccountOwnerId,
  reloadToken = 0,
  onChanged,
}: {
  card: Card;
  paymentAccountOwnerId?: string | null;
  /** 밖에서 남은 대금이 달라졌을 때 올린다(외화 청구액 확정). 다시 읽는다. */
  reloadToken?: number;
  /** 대금이 오간 뒤. 부모가 카드 목록·총자산을 다시 읽는다. */
  onChanged?: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const { messageOf } = useApiError();
  const timeZone = useProjectTimeZone();
  // 남이 그 카드로 결제한 것도 남은 대금에 들어와야 한다.
  const mirrorVersion = useMirrorVersion();

  const [usage, setUsage] = useState<CardUsage | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState({
    direction: 'payment' as CardTransferDirection,
    amount: '',
    /** 대금이 통장에서 빠진 날. 비워 두면 오늘이다. */
    date: '',
    /** 빠져나간 시각. 팝업을 열 때 지금 시각으로 채운다 (거래 추가 폼과 같은 규칙). */
    time: '',
  });

  const load = useCallback(async () => {
    try {
      setUsage(await apiClient.getCardUsage(card.id));
    } catch {
      setUsage(null);
    }
  }, [card.id]);

  useEffect(() => {
    load();
  }, [load, mirrorVersion, reloadToken]);

  const outstanding = outstandingOf(usage);
  const refundPending = outstanding < 0;
  /** 적은 금액이 남은 쪽 잔액을 넘는 정도. 막지는 않고 알리기만 한다. */
  const overTransfer = overTransferOf({
    amount: form.amount,
    direction: form.direction,
    outstanding,
  });

  const open = () => {
    setForm({ direction: 'payment', amount: '', date: '', time: nowTimeKey(timeZone) });
    setIsCalendarOpen(false);
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
    setForm({ direction: 'payment', amount: '', date: '', time: '' });
  };

  /** 시각을 고른다. 안드로이드가 그리는 시계 대화상자다 (거래 추가 폼과 같다). */
  const openTimePicker = () => {
    const [hour, minute] = form.time.split(':');
    const base = new Date();
    base.setHours(Number(hour) || 0, Number(minute) || 0, 0, 0);

    DateTimePickerAndroid.open({
      value: base,
      mode: 'time',
      is24Hour: true,
      onValueChange: (_event, date) => {
        const pad = (value: number) => String(value).padStart(2, '0');
        setForm((prev) => ({ ...prev, time: `${pad(date.getHours())}:${pad(date.getMinutes())}` }));
      },
    });
  };

  /**
   * 카드사와 통장 사이 자금 이동 기록.
   *
   * 금액에 상한을 두지 않는다. 카드사가 남은 대금보다 많이 가져가고 차액을 따로
   * 입금해 주는 방식이 있어서, 그 사이 남은 대금은 음수(환불 예정)로 남아야 한다.
   */
  const submit = async () => {
    if (!paymentAccountOwnerId) return;

    try {
      setIsSubmitting(true);
      await apiClient.createCardTransfer(card.id, {
        accountId: card.paymentAccountId,
        personId: paymentAccountOwnerId,
        amount: toAmountString(form.amount),
        direction: form.direction,
        // 적은 날짜·시각은 프로젝트 타임존의 벽시계다. 그 기준으로 UTC 인스턴트를 만든다.
        // 시각을 비우면 그 날의 0시가 된다 (거래 추가 폼과 같다).
        date: zonedFormValueToUtc(
          form.date || todayKey(timeZone),
          form.time || undefined,
          timeZone,
        ).toISOString(),
      });

      close();
      await load();
      await onChanged?.();
    } catch (err: any) {
      Alert.alert(messageOf(err, 'settlement.recordFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!usage) {
    return <Text className="text-sm text-gray-600">{t('settlement.loading')}</Text>;
  }

  return (
    <>
      <View className={`gap-3 rounded-lg p-4 ${refundPending ? 'bg-emerald-50' : 'bg-red-50'}`}>
        <View className="flex-row items-baseline justify-between gap-2">
          <Text
            className={`text-sm font-semibold ${
              refundPending ? 'text-emerald-700' : 'text-red-600'
            }`}
          >
            {t(refundPending ? 'settlement.refundPending' : 'settlement.remaining')}
          </Text>
          <Text
            className={`text-lg font-bold ${
              refundPending ? 'text-emerald-700' : 'text-red-600'
            }`}
          >
            {formatCurrency(Math.abs(outstanding), usage.currency)}
          </Text>
        </View>

        {refundPending ? (
          <Text className="text-xs text-emerald-700">{t('settlement.remainingHint')}</Text>
        ) : null}

        {paymentAccountOwnerId ? (
          <Pressable onPress={open} className="rounded-lg bg-blue-600 px-4 py-3 active:bg-blue-700">
            <Text className="text-center font-semibold text-white">{t('settlement.record')}</Text>
          </Pressable>
        ) : (
          <Text className="text-xs text-gray-600">{t('settlement.noOwner')}</Text>
        )}
      </View>

      {isOpen ? (
        <Modal
          isOpen
          onClose={close}
          title={t('settlement.modalTitle')}
          footer={
            <View className="flex-row gap-2">
              <Pressable
                onPress={close}
                className="flex-1 rounded-lg bg-gray-200 px-4 py-3 active:bg-gray-300"
              >
                <Text className="text-center font-semibold text-gray-700">
                  {t('common.cancel')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void submit()}
                disabled={isSubmitting}
                className={`flex-1 rounded-lg px-4 py-3 ${
                  isSubmitting ? 'bg-blue-300' : 'bg-blue-600 active:bg-blue-700'
                }`}
              >
                <Text className="text-center font-semibold text-white">
                  {t(isSubmitting ? 'settlement.submitting' : 'settlement.submit')}
                </Text>
              </Pressable>
            </View>
          }
        >
          <View className="gap-5">
            <View className="flex-row justify-between rounded-lg bg-gray-50 p-3">
              <Text className="text-sm text-gray-600">
                {t(refundPending ? 'settlement.refundPending' : 'settlement.remaining')}
              </Text>
              <Text className="font-semibold text-gray-900">
                {formatCurrency(Math.abs(outstanding), usage.currency)}
              </Text>
            </View>

            <Field label={t('settlement.direction')}>
              <Chips
                options={DIRECTIONS.map((id) => ({
                  value: id,
                  label: t(id === 'refund' ? 'settlement.refund' : 'settlement.payment'),
                }))}
                selected={form.direction}
                onSelect={(value) =>
                  setForm({ ...form, direction: value as CardTransferDirection })
                }
              />
              <Text className="mt-1 text-xs text-gray-500">
                {t(
                  form.direction === 'refund'
                    ? 'settlement.refundDirectionHint'
                    : 'settlement.paymentDirectionHint',
                )}
              </Text>
            </Field>

            {/* 날짜와 시각을 나란히 받는다. 거래 추가 폼과 같은 배치다. */}
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Field label={t('settlement.date')}>
                  <PickerButton
                    icon="date"
                    value={form.date || todayKey(timeZone)}
                    placeholder="YYYY-MM-DD"
                    isOpen={isCalendarOpen}
                    onPress={() => setIsCalendarOpen(!isCalendarOpen)}
                  />
                </Field>
              </View>
              <View className="w-32">
                <Field label={t('editor.time')}>
                  <PickerButton
                    icon="time"
                    value={form.time}
                    placeholder="HH:MM"
                    isOpen={false}
                    onPress={openTimePicker}
                  />
                </Field>
              </View>
            </View>

            {isCalendarOpen ? (
              <DatePickerPanel
                value={form.date || todayKey(timeZone)}
                onSelect={(date) => {
                  setForm({ ...form, date });
                  setIsCalendarOpen(false);
                }}
              />
            ) : null}

            <Text className="-mt-3 text-xs text-gray-500">{t('settlement.dateHint')}</Text>

            <Field label={t('settlement.amount')}>
              <TextInput
                value={form.amount}
                onChangeText={(amount) => setForm({ ...form, amount })}
                keyboardType="numeric"
                placeholder="0"
                className="rounded-lg border border-gray-300 px-3 py-3 text-base text-gray-900"
              />
              {/*
                상한을 두지 않는다. 카드사가 남은 대금보다 많이 가져가고 차액을 따로
                입금해 주는 방식이 있어서, 그 사이 남은 대금은 음수로 남아야 한다.
              */}
              {overTransfer > 0 ? (
                <Text className="mt-1 text-xs text-amber-700">
                  {t('settlement.overHint', {
                    basis: t(
                      refundPending ? 'settlement.refundPendingAmount' : 'settlement.remaining',
                    ),
                    over: formatCurrency(overTransfer, usage.currency),
                    rest: t(
                      form.direction === 'refund'
                        ? 'settlement.restPayment'
                        : 'settlement.restRefund',
                    ),
                  })}
                </Text>
              ) : null}
            </Field>
          </View>
        </Modal>
      ) : null}
    </>
  );
}
