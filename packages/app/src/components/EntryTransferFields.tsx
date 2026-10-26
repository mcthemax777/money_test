/*
 * 거래 입력의 이체 칸. 받는 계좌, 카드사와의 이체 안내, 수수료와 그 분류.
 *
 * 거래 입력(EntryEditor)에서 떼어 냈다 (2026-10-26). 갈래가 이체일 때만 선다.
 */
import { Text, TextInput, View } from 'react-native';

import { useTranslation } from '@money/core/lib/i18n';
import type { useEntryForm } from '@money/core/hooks/useEntryForm';

import { CategoryChips, Chips, Field } from './FormFields';

export default function EntryTransferFields({
  form,
  onAddCategory,
}: {
  form: ReturnType<typeof useEntryForm>;
  /** 수수료 분류 칸의 "+". 분류 만들기 창을 연다. */
  onAddCategory: () => void;
}) {
  const { t } = useTranslation();
  const { values, setField, violation } = form;

  return (
    <>
      <Field label={t('editor.toAccount')} invalid={violation?.field === 'toAccountId'}>
        <Chips
          options={form.toAccountChoices.map((account) => ({
            value: account.id,
            label: account.name,
            group: form.showAssetOwner ? account.owner : undefined,
          }))}
          selected={values.toAccountId}
          onSelect={(value) => setField('toAccountId', value)}
          collapse
        />
      </Field>

      {/*
        한쪽이 신용카드면 카드사와의 자금 이동이다. 방향이 뜻을 바꾸므로
        저장하기 전에 무엇으로 기록되는지 알려 준다 (웹의 이체 화면과 같다).
      */}
      {form.transferCardSide ? (
        <View className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <Text className="text-sm text-blue-800">
            {form.transferCardSide === 'payment'
              ? t('editor.toCardPayment')
              : t('editor.toCardRefund')}{' '}
            {t('editor.cardTransferNote')}
          </Text>
        </View>
      ) : null}

      {/* 카드사와의 이체에는 수수료를 붙일 수 없다 (조립도 거부한다). */}
      {form.transferCardSide ? null : (
        <Field label={t('editor.transferFee')} invalid={violation?.field === 'transferFee'}>
          <TextInput
            value={values.transferFee}
            onChangeText={(text) => setField('transferFee', text)}
            keyboardType="numeric"
            placeholder="0"
            className="rounded-lg border border-gray-300 px-3 py-3 text-base text-gray-900"
          />
        </Field>
      )}

      {/* 수수료를 적었을 때만 분류를 묻는다. 0원 이체에 분류를 강요하지 않는다. */}
      {values.transferFee && !form.transferCardSide ? (
        <Field
          label={t('editor.feeCategory')}
          invalid={violation?.field === 'transferFeeCategoryId'}
          onAdd={onAddCategory}
          addLabel={t('categories.add')}
        >
          <CategoryChips
            categories={form.categoryChoices}
            selected={values.transferFeeCategoryId}
            onSelect={(value) => setField('transferFeeCategoryId', value)}
          />
        </Field>
      ) : null}
    </>
  );
}
