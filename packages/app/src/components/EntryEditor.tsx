/*
 * 거래 입력.
 *
 * 웹의 편집기(EntryEditor)를 그대로 옮기지 않았다. 그쪽은 외화·분할·카드사 대금 이동과
 * 그 자리에서 계좌·카드·분류를 만드는 일까지 하고, 그만큼 크다. 앱에서 손으로 적는 것은
 * 대개 "5,000원, 식비, 신한카드, 오늘"이라 그 길을 짧게 두고 나머지는 웹에 맡긴다.
 * 다루지 않는 갈래를 만나면 감추지 않고 "웹에서 고쳐 주세요"로 말한다.
 *
 * 고르는 칸은 전부 알약(chip)이다. 앱에는 select 가 없고, 목록이 한 가정 규모라 펼쳐
 * 두는 편이 누르는 횟수가 적다.
 *
 * **저장은 창구로 나간다.** 온라인이면 서버로, 오프라인이면 기기 사본과 아웃박스로 간다.
 * 이 컴포넌트는 어느 쪽인지 모른다 (core 의 entry-write-port).
 */
import { useEffect } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { EntryListItem } from '@money/types';

import { todayKey } from '@money/core/lib/datetime';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { useEntryForm } from '@money/core/hooks/useEntryForm';
import type { EntryFormKind, EntryFormValues } from '@money/core/data/entry-form';
import { useMyPersonId, useProject, useProjectTimeZone } from '@money/core/store/project';

import Modal from './Modal';

/** 갈래 셋. 카드사 대금 이동은 카드 화면의 일이라 여기 없다. */
const KINDS: Array<{ id: EntryFormKind; labelKey: MessageKey }> = [
  { id: 'expense', labelKey: 'editor.kind.expense' },
  { id: 'income', labelKey: 'editor.kind.income' },
  { id: 'transfer', labelKey: 'editor.kind.transfer' },
];

/** 카드사가 흔히 주는 할부 개월수. 빈 값이 일시불이다. */
const INSTALLMENT_MONTHS = ['', '2', '3', '6', '12'];

/** 검증이 짚은 자리를 화면의 문구로. 코드 이름은 규칙 쪽 이름 그대로다. */
const VIOLATION_KEY: Record<string, MessageKey> = {
  PERSON_REQUIRED: 'editor.personRequired',
  DESCRIPTION_REQUIRED: 'entryForm.descriptionRequired',
  AMOUNT_INVALID: 'entryForm.amountRequired',
  DATE_INVALID: 'entryForm.dateInvalid',
  TIME_INVALID: 'entryForm.timeInvalid',
  CATEGORY_REQUIRED: 'entryForm.categoryRequired',
  METHOD_REQUIRED: 'entryForm.methodRequired',
  ACCOUNT_REQUIRED: 'entryForm.accountRequired',
  FROM_ACCOUNT_REQUIRED: 'entryForm.accountRequired',
  TO_ACCOUNT_REQUIRED: 'entryForm.toAccountRequired',
  TRANSFER_SAME_ACCOUNT: 'error.TRANSFER_SAME_ACCOUNT',
  FEE_INVALID: 'entryForm.feeInvalid',
  FEE_CATEGORY_REQUIRED: 'editor.feeCategoryRequired',
  EXTRA_INVALID: 'entryForm.extraInvalid',
  EXTRA_EXCEEDS_AMOUNT: 'error.EXTRA_EXCEEDS_AMOUNT',
};

export interface EntryEditorProps {
  isOpen: boolean;
  onClose: () => void;
  /** 고칠 거래. 없으면 새로 적는다. */
  editing?: EntryListItem | null;
  /** 저장·삭제가 끝난 뒤. 목록을 다시 읽는 자리다. */
  onSaved?: () => void;
  /** 이 화면이 다루지 않는 갈래를 열려 했을 때 */
  onNotEditable?: () => void;
}

export default function EntryEditor({
  isOpen,
  onClose,
  editing,
  onSaved,
  onNotEditable,
}: EntryEditorProps) {
  const { t } = useTranslation();
  const timeZone = useProjectTimeZone();
  const projectId = useProject((state) => state.selectedProjectId);
  const myPersonId = useMyPersonId();

  const form = useEntryForm({
    projectId,
    timeZone,
    defaultPersonId: myPersonId ?? '',
    onSaved,
  });
  const { values, setField, violation } = form;

  /*
   * 팝업이 열릴 때 폼을 채운다.
   *
   * 열려 있는 동안 다시 채우지 않는다. 그러면 사용자가 적던 값이 되돌아간다.
   */
  useEffect(() => {
    if (!isOpen) return;

    if (editing) {
      if (!form.startEdit(editing)) {
        onNotEditable?.();
        onClose();
      }
      return;
    }
    form.startNew();
    // form 의 함수들은 매번 새로 만들어지므로 의존성에 두지 않는다. 여는 순간만 본다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editing]);

  const save = async () => {
    if (await form.save()) onClose();
  };

  /**
   * 지우기 전에 한 번 묻는다.
   *
   * 웹도 같은 자리에서 묻는다(web 의 EntryEditor). 앱에서는 더 필요하다. 손가락이
   * 닿는 버튼이고, 되돌리는 길이 없으며, 오프라인이면 툼스톤이 먼저 나가 다음 동기화
   * 에서 서버의 거래까지 지운다. 문구는 계좌·카드가 쓰는 것을 함께 쓴다.
   */
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

  const messageOf = (): string => {
    if (form.error) return form.error;
    if (!violation) return '';
    const key = VIOLATION_KEY[violation.code];
    return key ? t(key) : violation.code;
  };

  const message = messageOf();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t(form.isEditing ? 'editor.titleEdit' : 'editor.titleAdd')}
      footer={
        <View className="flex-row gap-2">
          {form.isEditing ? (
            <Pressable
              disabled={form.isSubmitting}
              onPress={remove}
              className={`rounded-lg border border-red-300 px-4 py-3 ${
                form.isSubmitting ? 'opacity-50' : ''
              }`}
            >
              <Text className="text-sm font-medium text-red-600">
                {t(form.isSubmitting ? 'entryForm.deleting' : 'entryForm.delete')}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            disabled={form.isSubmitting}
            onPress={save}
            className={`flex-1 items-center rounded-lg bg-blue-600 px-4 py-3 ${
              form.isSubmitting ? 'opacity-50' : ''
            }`}
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

        {/* 갈래. 바꾸면 그 갈래에서 뜻이 없는 칸은 훅이 비운다. */}
        <Field label={t('editor.kindLabel')}>
          <Chips
            options={KINDS.map((kind) => ({ value: kind.id, label: t(kind.labelKey) }))}
            selected={values.kind}
            onSelect={(value) => setField('kind', value as EntryFormKind)}
          />
        </Field>

        <Field label={t('editor.amount')} invalid={violation?.field === 'amount'}>
          <TextInput
            value={values.amount}
            onChangeText={(text) => setField('amount', text)}
            keyboardType="numeric"
            placeholder="0"
            className="rounded-lg border border-gray-300 px-3 py-3 text-base text-gray-900"
          />
        </Field>

        <Field label={t('editor.description')} invalid={violation?.field === 'description'}>
          <TextInput
            value={values.description}
            onChangeText={(text) => setField('description', text)}
            placeholder={t('editor.descriptionPlaceholder')}
            className="rounded-lg border border-gray-300 px-3 py-3 text-base text-gray-900"
          />
        </Field>

        <View className="flex-row gap-3">
          <View className="flex-1">
            <Field label={t('editor.date')} invalid={violation?.field === 'dateKey'}>
              <TextInput
                value={values.dateKey}
                onChangeText={(text) => setField('dateKey', text)}
                placeholder="YYYY-MM-DD"
                className="rounded-lg border border-gray-300 px-3 py-3 text-base text-gray-900"
              />
            </Field>
          </View>
          <View className="w-28">
            <Field label={t('editor.time')} invalid={violation?.field === 'timeKey'}>
              <TextInput
                value={values.timeKey}
                onChangeText={(text) => setField('timeKey', text)}
                placeholder="HH:MM"
                className="rounded-lg border border-gray-300 px-3 py-3 text-base text-gray-900"
              />
            </Field>
          </View>
        </View>

        {/* 날짜를 손으로 적게 두되 가장 잦은 값은 한 번에 넣는다. */}
        <Pressable
          onPress={() => setField('dateKey', todayKey(timeZone))}
          className="self-start rounded-lg border border-gray-300 px-3 py-2"
        >
          <Text className="text-sm text-gray-700">{t('entryForm.today')}</Text>
        </Pressable>

        <Field label={t('editor.person')} invalid={violation?.field === 'personId'}>
          <Chips
            options={form.lists.people
              .filter((person) => person.isActive)
              .map((person) => ({ value: person.id, label: person.name }))}
            selected={values.personId}
            onSelect={(value) => setField('personId', value)}
          />
        </Field>

        <Field
          label={values.kind === 'transfer' ? t('editor.fromAccount') : t('editor.method')}
          invalid={violation?.field === 'method'}
        >
          {form.methodChoices.length === 0 ? (
            <Text className="text-sm text-gray-500">{t('entryForm.noMethods')}</Text>
          ) : (
            <Chips
              options={form.methodChoices.map((choice) => ({
                value: choice.value,
                label: choice.name,
              }))}
              selected={values.method}
              onSelect={(value) => setField('method', value)}
            />
          )}
        </Field>

        {values.kind === 'transfer' ? (
          <>
            <Field label={t('editor.toAccount')} invalid={violation?.field === 'toAccountId'}>
              <Chips
                options={form.toAccountChoices.map((account) => ({
                  value: account.id,
                  label: account.name,
                }))}
                selected={values.toAccountId}
                onSelect={(value) => setField('toAccountId', value)}
              />
            </Field>

            <Field label={t('editor.transferFee')} invalid={violation?.field === 'transferFee'}>
              <TextInput
                value={values.transferFee}
                onChangeText={(text) => setField('transferFee', text)}
                keyboardType="numeric"
                placeholder="0"
                className="rounded-lg border border-gray-300 px-3 py-3 text-base text-gray-900"
              />
            </Field>

            {/* 수수료를 적었을 때만 분류를 묻는다. 0원 이체에 분류를 강요하지 않는다. */}
            {values.transferFee ? (
              <Field
                label={t('editor.feeParentCategory')}
                invalid={violation?.field === 'transferFeeCategoryId'}
              >
                <Chips
                  options={form.categoryChoices.map((category) => ({
                    value: category.id,
                    label: labelOf(category, form.categoryChoices),
                  }))}
                  selected={values.transferFeeCategoryId}
                  onSelect={(value) => setField('transferFeeCategoryId', value)}
                />
              </Field>
            ) : null}
          </>
        ) : (
          <>
            <Field label={t('entryForm.category')} invalid={violation?.field === 'categoryId'}>
              {form.categoryChoices.length === 0 ? (
                <Text className="text-sm text-gray-500">{t('entryForm.noCategories')}</Text>
              ) : (
                <Chips
                  options={form.categoryChoices.map((category) => ({
                    value: category.id,
                    label: labelOf(category, form.categoryChoices),
                  }))}
                  selected={values.categoryId}
                  onSelect={(value) => setField('categoryId', value)}
                />
              )}
            </Field>

            {/* 이 앱의 지출은 건수가 아니라 금액으로 과소비를 센다. 그래서 금액 칸이다. */}
            <Field label={t('entryForm.extraAmount')} invalid={violation?.field === 'extraAmount'}>
              <TextInput
                value={values.extraAmount}
                onChangeText={(text) => setField('extraAmount', text)}
                keyboardType="numeric"
                placeholder=""
                className="rounded-lg border border-gray-300 px-3 py-3 text-base text-gray-900"
              />
              <Text className="mt-1 text-xs text-gray-500">{t('entryForm.extraHint')}</Text>
            </Field>
          </>
        )}

        {/* 할부는 신용카드 지출에만 뜻이 있다. 그 밖에서는 칸 자체를 만들지 않는다. */}
        {values.kind === 'expense' && form.isCreditCard ? (
          <Field label={t('editor.installment')}>
            <Chips
              options={INSTALLMENT_MONTHS.map((months) => ({
                value: months,
                label: months
                  ? t('editor.installmentMonths', { months })
                  : t('editor.installmentOnce'),
              }))}
              selected={values.installmentMonths}
              onSelect={(value) => setField('installmentMonths', value)}
            />
            <Text className="mt-1 text-xs text-gray-500">{t('editor.installmentHint')}</Text>
          </Field>
        ) : null}

        <Text className="text-xs text-gray-500">{t('entryForm.offlineNote')}</Text>
      </View>
    </Modal>
  );
}

function Field({
  label,
  invalid,
  children,
}: {
  label: string;
  invalid?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View>
      <Text className={`mb-2 text-sm font-medium ${invalid ? 'text-red-600' : 'text-gray-700'}`}>
        {label}
      </Text>
      {children}
    </View>
  );
}

/**
 * 고르는 알약 줄.
 *
 * 목록이 길면 옆으로 넘긴다. 접어 두면 무엇을 고를 수 있는지 열어 봐야 알고, 세로로
 * 쌓으면 폼이 화면 몇 개 길이가 된다.
 */
function Chips({
  options,
  selected,
  onSelect,
}: {
  options: Array<{ value: string; label: string }>;
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
      {options.map((option) => {
        const isSelected = option.value === selected;

        return (
          <Pressable
            key={option.value || 'none'}
            onPress={() => onSelect(option.value)}
            /* 고른 칸 표시는 언어 설정·분류 목록과 같은 값을 쓴다. */
            className={`rounded-lg border px-3 py-2 ${
              isSelected ? 'border-blue-600 bg-blue-50' : 'border-gray-300'
            }`}
          >
            <Text
              className={`text-sm ${isSelected ? 'font-medium text-blue-600' : 'text-gray-700'}`}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * 분류 이름. 소분류는 대분류를 앞에 붙인다.
 *
 * 목록이 평평해서 "점심"만 보면 어느 대분류의 것인지 알 수 없다. 웹은 대분류와 소분류를
 * 두 칸으로 나누지만, 알약 한 줄에서는 이름을 잇는 편이 누르는 횟수가 적다.
 */
function labelOf(
  category: { id: string; name: string; parentId?: string | null },
  all: Array<{ id: string; name: string }>,
): string {
  if (!category.parentId) return category.name;

  const parent = all.find((row) => row.id === category.parentId);
  return parent ? `${parent.name} › ${category.name}` : category.name;
}

/** 폼 값의 이름을 밖에서도 쓴다 (검증이 짚은 자리를 화면이 맞춰 보는 데 쓴다). */
export type { EntryFormValues };
