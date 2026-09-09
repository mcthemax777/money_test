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
import { useEffect, useRef } from 'react';
import { Alert, Animated, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { EntryDraftDto, EntryListItem, TagDto } from '@money/types';

import { todayKey } from '@money/core/lib/datetime';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { useEntryForm } from '@money/core/hooks/useEntryForm';
import type { EntryFormKind, EntryFormValues } from '@money/core/data/entry-form';
import { useMyPersonId, useProject, useProjectTimeZone } from '@money/core/store/project';

import { Chips, Field } from './FormFields';
import Modal from './Modal';

/** 갈래 넷. 조정(잔액 맞추기)은 이 폼이 만드는 것이 아니라 여기 없다. */
const KINDS: Array<{ id: EntryFormKind; labelKey: MessageKey }> = [
  { id: 'expense', labelKey: 'editor.kind.expense' },
  { id: 'income', labelKey: 'editor.kind.income' },
  { id: 'transfer', labelKey: 'editor.kind.transfer' },
  { id: 'card_payment', labelKey: 'editor.kind.card_payment' },
];

/**
 * 고를 수 있는 통화. 빈 값이 장부 통화다.
 *
 * 자유 입력을 두지 않는다. 통화 코드를 손으로 적게 하면 오타 하나가 저장을 막고, 앱에는
 * 목록에서 고르는 편이 빠르다.
 */
const CURRENCIES = ['USD', 'JPY', 'EUR', 'CNY'];

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
  SPLIT_SUM_MISMATCH: 'editor.splitSumMismatch',
  SPLIT_CATEGORY_REQUIRED: 'editor.splitCategoryRequired',
  SPLIT_AMOUNT_INVALID: 'editor.splitAmountInvalid',
  RATE_INVALID: 'editor.rateInvalid',
  CARD_REQUIRED: 'editor.cardRequired',
};

export interface EntryEditorProps {
  isOpen: boolean;
  onClose: () => void;
  /** 고칠 거래. 없으면 새로 적는다. */
  editing?: EntryListItem | null;
  /**
   * 내용만 베낄 거래. 값은 다 들어오지만 저장하면 **새 거래**가 된다.
   *
   * `editing` 과 함께 주지 않는다. 둘이 다 오면 고치기가 이긴다 -- 어느 쪽이든 하나는
   * 부르는 쪽의 실수이고, 그때 거래를 하나 더 만드는 것보다 원본을 여는 편이 안전하다.
   */
  copying?: EntryListItem | null;
  /**
   * 보관함의 후보. 값이 채워진 채로 열리고, 저장하면 **새 거래**가 된다.
   *
   * `editing`·`copying` 과 함께 주지 않는다. 후보는 거래가 아니라 읽어 낸 값의
   * 묶음이라 빈 칸이 있는 것이 정상이고, 그래서 되돌리는 길도 다르다
   * (core 의 `entryFormFromDraft`).
   */
  draft?: EntryDraftDto.Response | null;
  /**
   * 저장·삭제가 끝난 뒤. 목록을 다시 읽는 자리다.
   *
   * 만든 거래의 id 를 함께 준다(core 의 `useEntryForm`). 보관함이 그 값으로 후보에
   * 등록 표시를 남긴다. 목록만 다시 읽는 화면은 인자를 받지 않으면 된다.
   */
  onSaved?: (result: { entryId: string | null }) => void;
  /** 이 화면이 다루지 않는 갈래를 열려 했을 때 */
  onNotEditable?: () => void;
}

export default function EntryEditor({
  isOpen,
  onClose,
  editing,
  copying,
  draft,
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
    /*
     * 베끼기. 값을 채우는 것 말고는 새로 적는 것과 같다.
     *
     * 못 다루는 거래는 고치기와 마찬가지로 열지 않는다 -- 열어 두면 폼이 담지 못한
     * 것(분할 줄, 잔액 조정)이 빠진 채로 새 거래가 되어, 베낀 것과 다른 거래가 남는다.
     */
    if (copying) {
      if (!form.startCopy(copying)) {
        onNotEditable?.();
        onClose();
      }
      return;
    }
    /*
     * 보관함의 후보. 읽은 것만 덮고 나머지는 빈 폼의 기본값이다.
     *
     * 못 다루는 갈래를 걸러 내지 않는다. 후보의 갈래는 문구에서 짐작한 값이고 사람이
     * 폼에서 바꿀 수 있어서, 열지 않으면 담아 둔 것을 쓸 방법이 아예 없어진다.
     */
    if (draft) {
      form.startDraft(draft);
      return;
    }
    form.startNew();
    // form 의 함수들은 매번 새로 만들어지므로 의존성에 두지 않는다. 여는 순간만 본다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editing, copying, draft]);

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

        {/*
          통화와 환율.

          기준통화로 적으면 환산할 것이 없으므로 환율 칸을 아예 만들지 않는다. 통화를
          고르면 어림값이 채워지고, 사용자가 실제 환율로 고친다. **그 값을 명령에 실어
          보내는 것이 요점이다** -- 비워 두면 며칠 뒤 재생할 때 그날 환율로 값이 다시
          매겨져, 기기가 보여 준 금액과 서버에 남는 금액이 갈린다 (설계 문서의 D7).
        */}
        <Field label={t('editor.currency')}>
          <Chips
            options={[
              { value: '', label: form.ledgerCurrency },
              ...CURRENCIES.filter((code) => code !== form.ledgerCurrency).map((code) => ({
                value: code,
                label: code,
              })),
            ]}
            selected={values.currency}
            onSelect={(value) => setField('currency', value)}
          />
        </Field>

        {values.currency ? (
          <Field label={t('editor.rate')} invalid={violation?.field === 'exchangeRate'}>
            <TextInput
              value={values.exchangeRate}
              onChangeText={(text) => setField('exchangeRate', text)}
              keyboardType="numeric"
              placeholder="0"
              className="rounded-lg border border-gray-300 px-3 py-3 text-base text-gray-900"
            />
            <Text className="mt-1 text-xs text-gray-500">
              {t('editor.rateHint', { currency: values.currency, ledger: form.ledgerCurrency })}
            </Text>
          </Field>
        ) : null}

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
          label={
            values.kind === 'transfer' || values.kind === 'card_payment'
              ? t('editor.fromAccount')
              : t('editor.method')
          }
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

        {values.kind === 'card_payment' ? (
          <>
            {/*
              갚을 카드. 신용카드만 고를 수 있다 -- 체크카드는 결제하는 자리에서 통장에서
              빠지므로 나중에 갚을 대금이 없다.
            */}
            <Field label={t('editor.card')} invalid={violation?.field === 'cardId'}>
              {form.cardChoices.length === 0 ? (
                <Text className="text-sm text-gray-500">{t('editor.noCreditCards')}</Text>
              ) : (
                <Chips
                  options={form.cardChoices.map((card) => ({ value: card.id, label: card.name }))}
                  selected={values.cardId}
                  onSelect={(value) => setField('cardId', value)}
                />
              )}
            </Field>

            {/* 부채가 줄면 대금 결제, 늘면 환불 입금이다. */}
            <Field label={t('editor.cardDirection')}>
              <Chips
                options={[
                  { value: 'payment', label: t('editor.directionPayment') },
                  { value: 'refund', label: t('editor.directionRefund') },
                ]}
                selected={values.cardDirection}
                onSelect={(value) => setField('cardDirection', value as 'payment' | 'refund')}
              />
            </Field>
          </>
        ) : values.kind === 'transfer' ? (
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
        ) : values.splits.length > 0 ? (
          /*
            분할. 줄마다 분류와 금액을 따로 적는다.

            줄이 있는 동안에는 위의 분류 칸을 감춘다. 둘이 함께 보이면 어느 쪽이
            저장되는지 알 수 없고, 실제로 저장되는 것은 줄들뿐이다.
          */
          <Field label={t('editor.split')} invalid={violation?.field === 'splits'}>
            <View className="gap-3">
              {values.splits.map((split, index) => (
                <View key={index} className="gap-2 rounded-lg border border-gray-200 p-3">
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

                  {form.categoryChoices.length === 0 ? (
                    <Text className="text-sm text-gray-500">{t('entryForm.noCategories')}</Text>
                  ) : (
                    <Chips
                      options={form.categoryChoices.map((category) => ({
                        value: category.id,
                        label: labelOf(category, form.categoryChoices),
                      }))}
                      selected={split.categoryId}
                      onSelect={(value) => form.setSplit(index, 'categoryId', value)}
                    />
                  )}
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
                {t('editor.splitLeft', {
                  amount: String((Number(values.amount) || 0) - form.splitTotal),
                })}
              </Text>
              <Text className="text-xs text-gray-500">{t('editor.splitHint')}</Text>
            </View>
          </Field>
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

            {/* 분류를 나누는 자리. 누르면 지금 적은 금액과 분류가 첫 줄로 옮겨 간다. */}
            <Pressable
              onPress={form.addSplit}
              className="items-center rounded-lg border border-gray-300 px-3 py-2"
            >
              <Text className="text-sm text-gray-700">{t('editor.splitAdd')}</Text>
            </Pressable>
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

        {/*
          태그. 갈래를 가리지 않으므로 이체에도 뜬다.

          카테고리와 달리 **여럿을 고른다.** 그래서 같은 알약 줄을 쓰되 고름 표시가
          누적되고, 누르면 붙었다 떨어진다.
        */}
        <Field label={t('tags.pick')}>
          {form.lists.tags.length === 0 ? (
            <Text className="text-sm text-gray-500">{t('tags.empty')}</Text>
          ) : (
            <>
              <TagChips
                tags={form.lists.tags}
                selected={values.tagIds}
                onToggle={form.toggleTag}
              />
              <Text className="mt-1 text-xs text-gray-500">{t('tags.pickHint')}</Text>
            </>
          )}
        </Field>

        <Text className="text-xs text-gray-500">{t('entryForm.offlineNote')}</Text>
      </View>
    </Modal>
  );
}

/**
 * 태그를 고르는 알약 줄. 여럿을 고를 수 있다.
 *
 * `Chips` 와 나누어 둔 것은 고름이 하나가 아니라 집합이고, 알약마다 자기 색을 갖기
 * 때문이다. 하나를 골라도 나머지가 풀리지 않는다.
 */
function TagChips({
  tags,
  selected,
  onToggle,
}: {
  tags: TagDto.Response[];
  selected: string[];
  onToggle: (tagId: string) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
      {tags.map((tag) => (
        <TagChip
          key={tag.id}
          tag={tag}
          isSelected={selected.includes(tag.id)}
          onPress={() => onToggle(tag.id)}
        />
      ))}
    </ScrollView>
  );
}

/**
 * 태그 알약 하나.
 *
 * 누르면 살짝 눌렸다 돌아온다. 여럿을 고르는 칸이라 **무엇이 방금 바뀌었는지**가 색만으로는
 * 잘 보이지 않는다 -- 알약이 열 개 늘어선 줄에서 한 칸의 색이 바뀌는 것은 눈에 잘 띄지
 * 않지만, 움직인 칸은 눈이 따라간다.
 */
function TagChip({
  tag,
  isSelected,
  onPress,
}: {
  tag: TagDto.Response;
  isSelected: boolean;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const press = () => {
    // 눌렀다 놓는 한 번의 움직임. 위치만 바꾸므로 UI 스레드에 맡긴다.
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.92, duration: 80, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 220, useNativeDriver: true }),
    ]).start();
    onPress();
  };

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={press}
        className={`flex-row items-center gap-1.5 rounded-full border px-3 py-2 ${
          isSelected ? 'border-blue-600 bg-blue-50' : 'border-gray-300'
        }`}
      >
        {/* 색을 정한 태그는 점으로 보인다. 이름만으로는 목록에서 찾기 어렵다. */}
        {tag.color ? (
          <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
        ) : null}
        <Text
          className={`text-sm ${isSelected ? 'font-medium text-blue-600' : 'text-gray-700'}`}
        >
          {tag.name}
        </Text>
      </Pressable>
    </Animated.View>
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
