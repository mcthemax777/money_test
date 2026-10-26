/*
 * 거래 입력의 할부 칸. 개월수, 무이자·유이자, 회차 금액, 이자까지 여기서 적는다.
 *
 * 거래 입력(EntryEditor)에서 떼어 냈다 (2026-10-26). 할부는 신용카드 지출에만 뜻이 있어
 * 부르는 쪽이 그때만 세운다.
 */
import { Pressable, Text, TextInput, View } from 'react-native';

import { useTranslation } from '@money/core/lib/i18n';
import type { useEntryForm } from '@money/core/hooks/useEntryForm';
import {
  installmentInterestInputs,
  installmentShareInputs,
  installmentShareTotal,
} from '@money/core/lib/period-ledger';
import {
  installmentBaseAmount,
  totalDiscountOf,
  type EntryFormValues,
} from '@money/core/data/entry-form';

import { Chips, Field } from './FormFields';

export default function EntryInstallmentField({
  form,
}: {
  form: ReturnType<typeof useEntryForm>;
}) {
  const { t } = useTranslation();
  const { values, setField, violation } = form;

  /*
   * 회차 금액 칸에 보일 값. 적어 둔 것이 없으면 개월수로 나눈 기본값이다.
   *
   * 빈 칸으로 두지 않는 까닭은 고칠 자리가 한두 회차뿐이기 때문이다 -- 기본값을 보여
   * 주고 다른 회차만 고치게 한다.
   */
  /*
   * 할부가 나누는 금액 = 금액 − 차감 (core `installmentBaseAmount`, 웹과 같다). 카드에 청구되는
   * 것이 차감 뒤 금액이라 서버도 그 값을 나눈다.
   */
  const installmentBase = installmentBaseAmount(values.amount, totalDiscountOf(values));
  const shareInputs = installmentShareInputs(
    installmentBase,
    Number(values.installmentMonths),
    values.installmentShares,
    form.ledgerCurrency,
  );

  /*
   * 회차 이자 칸에 보일 값. 고른 방식으로 계산한 기본값이고, 고치면 그 값이 남는다.
   *
   * 방식을 고르지 않았으면 빈 칸이다 -- 0 으로 채우면 "이자 없음"과 구별되지 않는다.
   */
  const interestInputs = installmentInterestInputs({
    total: installmentBase,
    months: Number(values.installmentMonths),
    principals: shareInputs,
    mode: values.installmentInterestMode,
    monthlyPayment: values.installmentMonthlyPayment,
    annualRate: values.installmentAnnualRate,
    saved: values.installmentInterestShares,
    currency: form.ledgerCurrency,
  });

  return (
    <Field label={t('editor.installment')} invalid={violation?.field === 'installmentMonths'}>
      {/*
        개월수는 직접 적는다 -- 2개월부터 50개월까지 (2026-10-10 사용자 요청, 웹과 같다). 비우면
        일시불이다. 범위는 core checkEntryForm 이 본다.
      */}
      <TextInput
        value={values.installmentMonths}
        keyboardType="number-pad"
        maxLength={2}
        placeholder={t('editor.installmentMonthsInput')}
        className="rounded-lg border border-gray-300 px-3 py-3 text-base text-gray-900"
        onChangeText={(text) => {
          const value = text.replace(/[^0-9]/g, '');
          setField('installmentMonths', value);
          // 개월수가 바뀌면 적어 둔 회차 금액은 어느 회차의 것인지 알 수 없다.
          setField('installmentShares', []);
          setField('installmentInterestShares', []);
          /*
           * 월 납입액도 비운다. **개월수와 한 쌍인 값**이다 -- "10,000원을
           * 3개월, 매달 4,000원"의 4,000원은 3개월일 때의 사실이라, 개월수를
           * 바꾸면 그 값으로는 표가 풀리지 않고 저장도 막힌다.
           * 연이율은 개월수와 무관해 그대로 둔다.
           */
          setField('installmentMonthlyPayment', '');
        }}
      />
      <Text className="mt-1 text-xs text-gray-500">{t('editor.installmentHint')}</Text>

      {/*
        수수료가 붙는 할부인가. 개월수를 고른 뒤에만 묻는다.

        기본값을 두지 않는다. 무이자로 두면 유이자 할부가 조용히 수수료 없이
        지나가고, 유이자로 두면 무이자 결제마다 "수수료 미입력"이 쌓인다.
      */}
      {Number(values.installmentMonths) >= 2 ? (
        <View className="mt-2">
          <Chips
            options={[
              { value: 'free', label: t('editor.installmentFree') },
              { value: 'interest', label: t('editor.installmentInterest') },
            ]}
            selected={values.installmentInterest}
            onSelect={(value) => {
              setField('installmentInterest', value as EntryFormValues['installmentInterest']);
              /*
               * 무이자로 되돌리면 이자 쪽을 통째로 비운다. 남겨 두면 수수료가
               * 없는 할부에 이자가 붙어 보이고, 회차 기준으로 볼 때 그 달
               * 지출이 실제보다 커진다.
               */
              if (value !== 'interest') {
                setField('installmentInterestMode', '');
                setField('installmentMonthlyPayment', '');
                setField('installmentAnnualRate', '');
                setField('installmentInterestShares', []);
              }
            }}
          />
          <Text className="mt-1 text-xs text-gray-500">
            {values.installmentInterest === 'interest'
              ? t('editor.installmentInterestHint')
              : t('editor.installmentFreeHint')}
          </Text>

          {/*
            회차 금액. 기본값을 채워 두고 다른 자리만 고치게 한다.

            끝수를 어느 회차에 붙이는지가 카드사마다 다르다 -- 1,000원 3개월이
            334/333/333 일 수도 334/334/332 일 수도 있어, 계산만으로는 명세서와
            맞출 수 없다.
          */}
          <View className="mt-3 gap-1">
            <View className="flex-row items-baseline justify-between">
              <Text className="text-xs font-medium text-gray-700">
                {t('editor.installmentShares')}
              </Text>
              {values.installmentShares.length > 0 ? (
                <Pressable onPress={() => setField('installmentShares', [])}>
                  <Text className="text-xs text-blue-600">
                    {t('editor.installmentSharesReset')}
                  </Text>
                </Pressable>
              ) : null}
            </View>

            {shareInputs.map((share, index) => (
              <View key={index} className="flex-row items-center gap-2">
                <Text className="w-16 text-xs text-gray-500">
                  {t('editor.installmentShareRow', { index: index + 1 })}
                </Text>
                <TextInput
                  value={share}
                  onChangeText={(next) =>
                    setField(
                      'installmentShares',
                      shareInputs.map((old, at) => (at === index ? next : old)),
                    )
                  }
                  keyboardType="decimal-pad"
                  className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-right text-sm text-gray-900"
                />
              </View>
            ))}

            <Text
              className={`text-right text-xs ${
                violation?.field === 'installmentShares' ? 'text-red-600' : 'text-gray-500'
              }`}
            >
              {t('editor.installmentSharesSum', {
                total: installmentShareTotal(shareInputs),
                amount: installmentBase || '0',
              })}
            </Text>
          </View>

          {/*
            이자. 유이자 할부에만 묻는다.

            카드사가 정하는 방식이 둘이다. 매달 같은 금액을 내는 할부는 낸 돈에서
            이자를 먼저 떼어 앞 회차일수록 이자가 크고, 연이율만 정해진 할부는
            남은 원금에 매달 이자가 붙어 뒤로 갈수록 가벼워진다. 어느 쪽도 아니면
            빈 칸으로 두고 명세서를 보고 적는다.
          */}
          {values.installmentInterest === 'interest' ? (
            <View className="mt-3 gap-1">
              <Text className="text-xs font-medium text-gray-700">
                {t('editor.installmentInterestMode')}
              </Text>
              <Chips
                options={[
                  { value: 'fixed', label: t('editor.installmentModeFixed') },
                  { value: 'rate', label: t('editor.installmentModeRate') },
                  { value: '', label: t('editor.installmentModeManual') },
                ]}
                selected={values.installmentInterestMode}
                onSelect={(value) => {
                  setField(
                    'installmentInterestMode',
                    value as EntryFormValues['installmentInterestMode'],
                  );
                  // 방식을 바꾸면 계산이 다시 채운다. 고쳐 둔 값은 그 방식의 것이다.
                  setField('installmentInterestShares', []);
                }}
              />

              {values.installmentInterestMode === 'fixed' ? (
                <>
                  <TextInput
                    value={values.installmentMonthlyPayment}
                    onChangeText={(next) => {
                      setField('installmentMonthlyPayment', next);
                      setField('installmentInterestShares', []);
                    }}
                    keyboardType="decimal-pad"
                    placeholder={t('editor.installmentMonthlyPayment')}
                    className="rounded border border-gray-300 bg-white px-2 py-1 text-right text-sm text-gray-900"
                  />
                  <Text className="text-xs text-gray-500">
                    {t('editor.installmentMonthlyPaymentHint')}
                  </Text>
                </>
              ) : null}

              {values.installmentInterestMode === 'rate' ? (
                <>
                  <TextInput
                    value={values.installmentAnnualRate}
                    onChangeText={(next) => {
                      setField('installmentAnnualRate', next);
                      setField('installmentInterestShares', []);
                    }}
                    keyboardType="decimal-pad"
                    placeholder={t('editor.installmentAnnualRate')}
                    className="rounded border border-gray-300 bg-white px-2 py-1 text-right text-sm text-gray-900"
                  />
                  <Text className="text-xs text-gray-500">
                    {t('editor.installmentAnnualRateHint')}
                  </Text>
                </>
              ) : null}

              <View className="mt-2 flex-row items-baseline justify-between">
                <Text className="text-xs font-medium text-gray-700">
                  {t('editor.installmentInterestShares')}
                </Text>
                {values.installmentInterestShares.length > 0 ? (
                  <Pressable onPress={() => setField('installmentInterestShares', [])}>
                    <Text className="text-xs text-blue-600">
                      {t('editor.installmentInterestReset')}
                    </Text>
                  </Pressable>
                ) : null}
              </View>

              {interestInputs.map((interest, index) => (
                <View key={index} className="flex-row items-center gap-2">
                  <Text className="w-20 text-xs text-gray-500">
                    {t('editor.installmentInterestRow', { index: index + 1 })}
                  </Text>
                  <TextInput
                    value={interest}
                    onChangeText={(next) =>
                      setField(
                        'installmentInterestShares',
                        interestInputs.map((old, at) => (at === index ? next : old)),
                      )
                    }
                    keyboardType="decimal-pad"
                    className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-right text-sm text-gray-900"
                  />
                </View>
              ))}

              <Text
                className={`text-right text-xs ${
                  violation?.field === 'installmentInterestShares' ||
                  violation?.field === 'installmentMonthlyPayment' ||
                  violation?.field === 'installmentAnnualRate'
                    ? 'text-red-600'
                    : 'text-gray-500'
                }`}
              >
                {t('editor.installmentInterestTotal', {
                  total: installmentShareTotal(interestInputs),
                })}
              </Text>
              {/*
                카드에 갚을 돈. 이자가 금액에 더해져 거래에 적힌다.

                금액 칸은 산 값 그대로 두고 여기서만 밝힌다 -- 사용자가 적은
                숫자를 화면이 말없이 올리면 무엇을 저장하는지 알 수 없다.
              */}
              <Text className="text-right text-xs font-medium text-gray-700">
                {t('editor.installmentTotalDue', {
                  total: installmentShareTotal([
                    installmentBase || '0',
                    installmentShareTotal(interestInputs),
                  ]),
                  amount: installmentBase || '0',
                })}
              </Text>
              <Text className="text-xs text-gray-500">
                {t('editor.installmentInterestSharesHint')}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </Field>
  );
}
