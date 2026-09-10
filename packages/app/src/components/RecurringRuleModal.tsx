/*
 * 반복 등록을 만들고 고치는 팝업. 웹의 같은 이름 파일과 짝이다.
 *
 * 거래 추가 팝업과 닮았지만 **날짜 대신 주기를 받는다.** 거래는 "언제 썼는가"를 적고,
 * 반복은 "언제마다 적을 것인가"를 적는다.
 *
 * 저장해도 거래가 생기지 않는다. 정해진 날이 되면 보관함에 후보가 만들어지고, 사람이
 * 그것을 눌러야 전표가 된다. 그 사실을 폼 아래에 적어 둔다 -- 적어 두지 않으면
 * "자동으로 가계부에 적히는 것"으로 읽는다.
 */
import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import {
  checkRecurring,
  type EntryKind,
  type RecurringFrequency,
  type RecurringRuleDto,
} from '@money/types';

import { todayKey } from '@money/core/lib/datetime';
import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { useProjectTimeZone } from '@money/core/store/project';
import type { Account, Card, Category, Person } from '@money/core/lib/types';

import DatePickerPanel from './DatePickerPanel';
import { Chips, Field } from './FormFields';
import Modal from './Modal';

const FREQUENCIES: Array<{ id: RecurringFrequency; labelKey: MessageKey }> = [
  { id: 'none', labelKey: 'inbox.freq.none' },
  { id: 'daily', labelKey: 'inbox.freq.daily' },
  { id: 'monthly', labelKey: 'inbox.freq.monthly' },
  { id: 'yearly', labelKey: 'inbox.freq.yearly' },
];

/** "HH:mm" 인가. 앱에는 시각 입력이 없어 글자로 받고 여기서 본다. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 폼이 들고 있는 값. 전부 글자다 (입력란이 주는 그대로). */
interface FormValues {
  description: string;
  kind: EntryKind;
  amount: string;
  frequency: RecurringFrequency;
  everyDays: string;
  dayOfMonth: string;
  month: string;
  startDate: string;
  endDate: string;
  timeOfDay: string;
  personId: string;
  categoryId: string;
  /** "account:id" 또는 "card:id". 거래 폼과 같은 규칙이다. */
  method: string;
}

function emptyForm(timeZone: string): FormValues {
  const today = todayKey(timeZone);
  return {
    description: '',
    kind: 'expense',
    amount: '',
    frequency: 'monthly',
    everyDays: '1',
    // 오늘 날짜의 일(日)을 기본으로. 대개 "오늘부터 매달 이 날"이다.
    dayOfMonth: String(Number(today.slice(8, 10))),
    month: String(Number(today.slice(5, 7))),
    startDate: today,
    endDate: '',
    timeOfDay: '',
    personId: '',
    categoryId: '',
    method: '',
  };
}

function formOf(rule: RecurringRuleDto.Response, timeZone: string): FormValues {
  return {
    ...emptyForm(timeZone),
    description: rule.description,
    kind: rule.kind,
    amount: rule.amount ?? '',
    frequency: rule.frequency,
    everyDays: String(rule.everyDays ?? 1),
    dayOfMonth: String(rule.dayOfMonth ?? 1),
    month: String(rule.month ?? 1),
    startDate: rule.startDate,
    endDate: rule.endDate ?? '',
    timeOfDay: rule.timeOfDay ?? '',
    personId: rule.personId ?? '',
    categoryId: rule.categoryId ?? '',
    method: rule.cardId ? `card:${rule.cardId}` : rule.accountId ? `account:${rule.accountId}` : '',
  };
}

export default function RecurringRuleModal({
  isOpen,
  rule,
  lists,
  onClose,
  onSave,
  onDelete,
}: {
  isOpen: boolean;
  /** 고칠 반복. null 이면 새로 만든다. */
  rule: RecurringRuleDto.Response | null;
  lists: { accounts: Account[]; cards: Card[]; categories: Category[]; people: Person[] };
  onClose: () => void;
  onSave: (body: RecurringRuleDto.Body) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const timeZone = useProjectTimeZone();
  const [values, setValues] = useState<FormValues>(() => emptyForm(timeZone));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  /** 지금 달력이 열려 있는 칸. 없으면 닫혀 있다. */
  const [openDate, setOpenDate] = useState<'start' | 'end' | null>(null);

  // 열 때 채운다. 열려 있는 동안 다시 채우면 적던 값이 되돌아간다.
  useEffect(() => {
    if (!isOpen) return;
    setValues(rule ? formOf(rule, timeZone) : emptyForm(timeZone));
    setError('');
    setOpenDate(null);
  }, [isOpen, rule, timeZone]);

  /** 주기 없는 반복인가. 일정 칸을 감추는 데 쓴다. */
  const isManual = values.frequency === 'none';

  const set = <K extends keyof FormValues>(field: K, value: FormValues[K]) =>
    setValues((previous) => ({ ...previous, [field]: value }));

  /** 그 갈래의 분류만 고른다. 이체·카드대금에는 분류가 없다. */
  const categories = lists.categories.filter(
    (category) =>
      category.isActive && category.type === (values.kind === 'income' ? 'income' : 'expense'),
  );

  const methodOptions = [
    { value: '', label: t('inbox.ruleNotChosen') },
    ...lists.accounts
      .filter((account) => account.isActive)
      .map((account) => ({ value: `account:${account.id}`, label: account.name })),
    ...lists.cards
      .filter((card) => card.isActive)
      .map((card) => ({ value: `card:${card.id}`, label: card.name })),
  ];

  const submit = async () => {
    /*
     * 시각은 글자로 받으므로 여기서 본다.
     *
     * 웹은 시각 입력이 있어 "25:99" 가 들어올 수 없지만 앱은 무엇이든 적을 수 있다.
     * 그냥 버리면 사람은 적어 둔 시각이 왜 사라졌는지 알 수 없다.
     */
    if (values.timeOfDay && !TIME_PATTERN.test(values.timeOfDay)) {
      setError(t('inbox.ruleTimeInvalid'));
      return;
    }

    const body = toBody(values);
    /*
     * 저장 전에 화면에서 먼저 본다. 서버와 **같은 함수**다(`checkRecurring`).
     *
     * 서버만 보면 사용자는 무엇이 틀렸는지 모른 채 오류 문장만 받는다.
     */
    const violation = checkRecurring({
      frequency: body.frequency,
      everyDays: body.everyDays,
      dayOfMonth: body.dayOfMonth,
      month: body.month,
      startDate: body.startDate,
      endDate: body.endDate,
    });
    if (violation) {
      setError(t('error.RECURRING_INVALID'));
      return;
    }
    if (!body.description.trim()) {
      setError(t('error.RECURRING_DESCRIPTION_REQUIRED'));
      return;
    }

    setIsSubmitting(true);
    const ok = await onSave(body);
    setIsSubmitting(false);
    if (ok) onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={rule ? t('inbox.ruleEdit') : t('inbox.ruleAdd')}
      footer={
        <View className="flex-row gap-2">
          {rule ? (
            <Pressable
              /* 지우기는 되돌릴 수 없으므로 한 번 묻는다. 이미 만들어진 후보는 남는다. */
              onPress={() =>
                Alert.alert(t('inbox.ruleDeleteConfirm'), '', [
                  { text: t('common.cancel'), style: 'cancel' },
                  {
                    text: t('inbox.ruleDelete'),
                    style: 'destructive',
                    onPress: () => {
                      void onDelete(rule.id).then((done) => {
                        if (done) onClose();
                      });
                    },
                  },
                ])
              }
              className="rounded-lg border border-red-300 px-4 py-3 active:bg-red-50"
            >
              <Text className="text-sm font-medium text-red-600">{t('inbox.ruleDelete')}</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => void submit()}
            disabled={isSubmitting}
            className={`flex-1 items-center rounded-lg bg-blue-600 px-4 py-3 ${
              isSubmitting ? 'opacity-50' : 'active:bg-blue-700'
            }`}
          >
            <Text className="text-base font-semibold text-white">
              {t(isSubmitting ? 'common.saving' : 'common.save')}
            </Text>
          </Pressable>
        </View>
      }
    >
      <View className="gap-4">
        <Field label={t('inbox.ruleName')}>
          <TextInput
            value={values.description}
            onChangeText={(text) => set('description', text)}
            placeholder={t('inbox.ruleNamePlaceholder')}
            className="rounded-lg border border-gray-300 px-3 py-3 text-base"
          />
        </Field>

        <Field label={t('editor.kindLabel')}>
          <Chips
            options={[
              { value: 'expense', label: t('editor.kind.expense') },
              { value: 'income', label: t('editor.kind.income') },
            ]}
            selected={values.kind}
            onSelect={(value) => set('kind', value as EntryKind)}
          />
        </Field>

        <Field label={t('editor.amount')}>
          <TextInput
            value={values.amount}
            onChangeText={(text) => set('amount', text)}
            keyboardType="numeric"
            className="rounded-lg border border-gray-300 px-3 py-3 text-base"
          />
        </Field>

        <Field label={t('inbox.ruleFrequency')}>
          <Chips
            options={FREQUENCIES.map((frequency) => ({
              value: frequency.id,
              label: t(frequency.labelKey),
            }))}
            selected={values.frequency}
            onSelect={(value) => set('frequency', value as RecurringFrequency)}
          />
        </Field>

        {/*
          주기마다 물어볼 것이 다르다. 뜻이 없는 칸은 아예 그리지 않는다.

          주기 없음에는 물어볼 것이 하나도 없다 -- 며칠마다·며칟날·몇 월도, 시작일도
          끝나는 날도 저절로 오는 날을 정하는 값이라 그 날이 없으면 뜻이 없다. 대신
          "만들기를 누를 때만 생긴다"는 사실을 한 줄로 적는다.
        */}
        {values.frequency === 'none' ? (
          <View className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <Text className="text-xs text-gray-600">{t('inbox.ruleNoneNote')}</Text>
          </View>
        ) : values.frequency === 'daily' ? (
          <Field label={t('inbox.everyDays')}>
            <View className="flex-row items-center gap-2">
              <TextInput
                value={values.everyDays}
                onChangeText={(text) => set('everyDays', text)}
                keyboardType="numeric"
                className="w-24 rounded-lg border border-gray-300 px-3 py-3 text-base"
              />
              <Text className="text-sm text-gray-600">{t('inbox.everyDaysUnit')}</Text>
            </View>
          </Field>
        ) : (
          <>
            {values.frequency === 'yearly' ? (
              <Field label={t('inbox.monthLabel')}>
                <Chips
                  options={Array.from({ length: 12 }, (_, index) => ({
                    value: String(index + 1),
                    label: `${index + 1}${t('inbox.monthUnit')}`,
                  }))}
                  selected={values.month}
                  onSelect={(value) => set('month', value)}
                />
              </Field>
            ) : null}
            <Field label={t('inbox.dayOfMonth')}>
              <Chips
                options={Array.from({ length: 31 }, (_, index) => ({
                  value: String(index + 1),
                  label: `${index + 1}${t('inbox.dayOfMonthUnit')}`,
                }))}
                selected={values.dayOfMonth}
                onSelect={(value) => set('dayOfMonth', value)}
              />
            </Field>
            {Number(values.dayOfMonth) > 28 ? (
              <Text className="text-xs text-gray-500">{t('inbox.ruleEndOfMonth')}</Text>
            ) : null}
          </>
        )}

        {/*
          시작일과 끝나는 날. 웹의 날짜 입력 자리를 달력 판이 대신한다.

          달력은 두 칸 아래에 펼친다 -- 칸 하나는 화면 절반이라 그 안에 일곱 열을 그리면
          날짜가 서로 붙는다 (거래 검색 팝업과 같은 짜임이다).
        */}
        <View className="flex-row gap-2" style={{ display: isManual ? 'none' : 'flex' }}>
          <DateButton
            label={t('inbox.ruleStart')}
            value={values.startDate}
            placeholder={t('inbox.ruleNotChosen')}
            isOpen={openDate === 'start'}
            onPress={() => setOpenDate((previous) => (previous === 'start' ? null : 'start'))}
          />
          <DateButton
            label={t('inbox.ruleEnd')}
            value={values.endDate}
            placeholder={t('inbox.ruleNextNone')}
            isOpen={openDate === 'end'}
            onPress={() => setOpenDate((previous) => (previous === 'end' ? null : 'end'))}
          />
        </View>
        {openDate && !isManual ? (
          <View className="gap-2">
            {/* 칸을 옮기면 달력을 새로 그린다(key). 그 칸의 날짜가 있는 달에서 시작한다. */}
            <DatePickerPanel
              key={openDate}
              value={openDate === 'start' ? values.startDate : values.endDate}
              fallbackDate={openDate === 'start' ? values.endDate : values.startDate}
              onSelect={(dateKey) => {
                set(openDate === 'start' ? 'startDate' : 'endDate', dateKey);
                setOpenDate(null);
              }}
            />
            {openDate === 'end' && values.endDate ? (
              <Pressable
                onPress={() => {
                  set('endDate', '');
                  setOpenDate(null);
                }}
                className="self-start rounded-lg border border-gray-300 px-3 py-2"
              >
                <Text className="text-sm text-gray-700">{t('inbox.ruleEndClear')}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <Field label={t('inbox.ruleTime')}>
          <TextInput
            value={values.timeOfDay}
            onChangeText={(text) => set('timeOfDay', text)}
            placeholder="09:00"
            keyboardType="numbers-and-punctuation"
            maxLength={5}
            className="w-28 rounded-lg border border-gray-300 px-3 py-3 text-base"
          />
        </Field>

        <Field label={t('editor.method')}>
          <Chips
            options={methodOptions}
            selected={values.method}
            onSelect={(value) => set('method', value)}
          />
        </Field>

        <Field label={t('entryForm.category')}>
          <Chips
            options={[
              { value: '', label: t('inbox.ruleNotChosen') },
              ...categories.map((category) => ({ value: category.id, label: category.name })),
            ]}
            selected={values.categoryId}
            onSelect={(value) => set('categoryId', value)}
          />
        </Field>

        <Field label={t('editor.person')}>
          <Chips
            options={[
              { value: '', label: t('inbox.ruleNotChosen') },
              ...lists.people
                .filter((person) => person.isActive)
                .map((person) => ({ value: person.id, label: person.name })),
            ]}
            selected={values.personId}
            onSelect={(value) => set('personId', value)}
          />
        </Field>

        {error ? (
          <View className="rounded-lg bg-red-50 p-3">
            <Text className="text-sm text-red-800">{error}</Text>
          </View>
        ) : null}

        {/*
          저장해도 거래가 생기지 않는다는 사실. 적어 두지 않으면 "자동으로 가계부에
          적히는 것"으로 읽고, 그 오해는 합계가 틀렸다는 신고로 돌아온다.
        */}
        <View className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <Text className="text-xs text-gray-600">{t('inbox.ruleNote')}</Text>
        </View>
      </View>
    </Modal>
  );
}

/** 누르면 달력이 열리는 날짜 칸. 웹의 `<input type="date">` 자리다. */
function DateButton({
  label,
  value,
  placeholder,
  isOpen,
  onPress,
}: {
  label: string;
  value: string;
  placeholder: string;
  isOpen: boolean;
  onPress: () => void;
}) {
  return (
    <View className="flex-1">
      <Text className="mb-2 text-sm font-medium text-gray-700">{label}</Text>
      <Pressable
        onPress={onPress}
        className={`rounded-lg border px-3 py-3 ${
          isOpen ? 'border-blue-600 bg-blue-50' : 'border-gray-300'
        }`}
      >
        <Text className={`text-base ${value ? 'text-gray-900' : 'text-gray-400'}`}>
          {value || placeholder}
        </Text>
      </Pressable>
    </View>
  );
}

/** 폼 값을 창구가 받는 모양으로. 결제수단은 종류와 id 로 나눈다. */
function toBody(values: FormValues): RecurringRuleDto.Body {
  const [methodKind, methodId] = values.method.split(':');

  const scheduled = values.frequency !== 'none';

  return {
    frequency: values.frequency,
    everyDays: values.frequency === 'daily' ? Number(values.everyDays) || 1 : null,
    // 주기가 없으면 셋 다 비운다. 저절로 오는 날이 없어 정할 것이 없다.
    dayOfMonth: scheduled && values.frequency !== 'daily' ? Number(values.dayOfMonth) || 1 : null,
    month: values.frequency === 'yearly' ? Number(values.month) || 1 : null,
    startDate: values.startDate,
    // 끝나는 날도 저절로 오는 날에 걸리는 값이다. 주기가 없으면 가지고 있지 않는다.
    endDate: scheduled ? values.endDate || null : null,
    timeOfDay: values.timeOfDay || null,
    kind: values.kind,
    amount: values.amount.trim() || null,
    description: values.description.trim(),
    // 가맹점은 따로 받지 않는다. 반복은 대개 이름이 곧 가맹점이다(월세, 넷플릭스).
    merchant: values.description.trim() || null,
    personId: values.personId || null,
    categoryId: values.categoryId || null,
    accountId: methodKind === 'account' ? methodId : null,
    cardId: methodKind === 'card' ? methodId : null,
  };
}
