'use client';

/*
 * 반복 등록을 만들고 고치는 팝업.
 *
 * 거래 추가 팝업과 닮았지만 **날짜 대신 주기를 받는다.** 거래는 "언제 썼는가"를 적고,
 * 반복은 "언제마다 적을 것인가"를 적는다.
 *
 * 저장해도 거래가 생기지 않는다. 정해진 날이 되면 보관함에 후보가 만들어지고, 사람이
 * 그것을 눌러야 전표가 된다. 그 사실을 폼 아래에 적어 둔다 -- 적어 두지 않으면
 * "자동으로 가계부에 적히는 것"으로 읽는다.
 */

import { useEffect, useState } from 'react';
import {
  checkRecurring,
  type EntryKind,
  type RecurringFrequency,
  type RecurringRuleDto,
} from '@money/types';

import { useTranslation, type MessageKey } from '@money/core/lib/i18n';
import { todayKey } from '@money/core/lib/datetime';
import { useProjectTimeZone } from '@money/core/store/project';
import type { Account, Card, Category, Person } from '@money/core/lib/types';

import Modal from '@/components/Modal';

/** 하단 고정 버튼과 본문 form 을 잇는 id (Modal 의 footer 는 form 밖이다) */
const FORM_ID = 'recurring-form';

const FREQUENCIES: Array<{ id: RecurringFrequency; labelKey: MessageKey }> = [
  { id: 'none', labelKey: 'inbox.freq.none' },
  { id: 'daily', labelKey: 'inbox.freq.daily' },
  { id: 'monthly', labelKey: 'inbox.freq.monthly' },
  { id: 'yearly', labelKey: 'inbox.freq.yearly' },
];

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

  // 열 때 채운다. 열려 있는 동안 다시 채우면 적던 값이 되돌아간다.
  useEffect(() => {
    if (!isOpen) return;
    setValues(rule ? formOf(rule, timeZone) : emptyForm(timeZone));
    setError('');
  }, [isOpen, rule, timeZone]);

  const set = <K extends keyof FormValues>(field: K, value: FormValues[K]) =>
    setValues((previous) => ({ ...previous, [field]: value }));

  /** 그 갈래의 분류만 고른다. 이체·카드대금에는 분류가 없다. */
  const categories = lists.categories.filter(
    (category) =>
      category.isActive && category.type === (values.kind === 'income' ? 'income' : 'expense'),
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

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
        <div className="flex gap-2">
          {rule ? (
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm(t('inbox.ruleDeleteConfirm'))) return;
                if (await onDelete(rule.id)) onClose();
              }}
              className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              {t('inbox.ruleDelete')}
            </button>
          ) : null}
          <button
            type="submit"
            form={FORM_ID}
            disabled={isSubmitting}
            className="flex-1 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {t(isSubmitting ? 'common.saving' : 'common.save')}
          </button>
        </div>
      }
    >
      <form id={FORM_ID} onSubmit={submit} className="space-y-4">
        <Field label={t('inbox.ruleName')}>
          <input
            value={values.description}
            onChange={(event) => set('description', event.target.value)}
            placeholder={t('inbox.ruleNamePlaceholder')}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
            data-autofocus
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('editor.kindLabel')}>
            <select
              value={values.kind}
              onChange={(event) => set('kind', event.target.value as EntryKind)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            >
              <option value="expense">{t('editor.kind.expense')}</option>
              <option value="income">{t('editor.kind.income')}</option>
            </select>
          </Field>
          <Field label={t('editor.amount')}>
            <input
              value={values.amount}
              onChange={(event) => set('amount', event.target.value)}
              inputMode="decimal"
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            />
          </Field>
        </div>

        <Field label={t('inbox.ruleFrequency')}>
          <div className="flex gap-2">
            {FREQUENCIES.map((frequency) => (
              <button
                key={frequency.id}
                type="button"
                onClick={() => set('frequency', frequency.id)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
                  values.frequency === frequency.id
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {t(frequency.labelKey)}
              </button>
            ))}
          </div>
        </Field>

        {/*
          주기마다 물어볼 것이 다르다. 뜻이 없는 칸은 아예 그리지 않는다.

          주기 없음에는 물어볼 것이 하나도 없다 -- 며칠마다·며칟날·몇 월도, 시작일도
          끝나는 날도 저절로 오는 날을 정하는 값이라 그 날이 없으면 뜻이 없다. 대신
          "만들기를 누를 때만 생긴다"는 사실을 한 줄로 적는다.
        */}
        {values.frequency === 'none' ? (
          <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
            {t('inbox.ruleNoneNote')}
          </p>
        ) : values.frequency === 'daily' ? (
          <Field label={t('inbox.everyDays')}>
            <div className="flex items-center gap-2">
              <input
                value={values.everyDays}
                onChange={(event) => set('everyDays', event.target.value)}
                inputMode="numeric"
                className="w-24 rounded-lg border border-gray-300 px-3 py-2"
              />
              <span className="text-sm text-gray-600">{t('inbox.everyDaysUnit')}</span>
            </div>
          </Field>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {values.frequency === 'yearly' ? (
              <Field label={t('inbox.monthLabel')}>
                <select
                  value={values.month}
                  onChange={(event) => set('month', event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                >
                  {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                    <option key={month} value={month}>
                      {month}
                      {t('inbox.monthUnit')}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Field label={t('inbox.dayOfMonth')}>
              <select
                value={values.dayOfMonth}
                onChange={(event) => set('dayOfMonth', event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
              >
                {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                  <option key={day} value={day}>
                    {day}
                    {t('inbox.dayOfMonthUnit')}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}

        {values.frequency !== 'none' &&
        values.frequency !== 'daily' &&
        Number(values.dayOfMonth) > 28 ? (
          <p className="text-xs text-gray-500">{t('inbox.ruleEndOfMonth')}</p>
        ) : null}

        <div className={`grid grid-cols-2 gap-3 ${values.frequency === 'none' ? 'hidden' : ''}`}>
          <Field label={t('inbox.ruleStart')}>
            <input
              type="date"
              value={values.startDate}
              onChange={(event) => set('startDate', event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            />
          </Field>
          <Field label={t('inbox.ruleEnd')}>
            <input
              type="date"
              value={values.endDate}
              onChange={(event) => set('endDate', event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            />
          </Field>
        </div>

        <Field label={t('inbox.ruleTime')}>
          <input
            type="time"
            value={values.timeOfDay}
            onChange={(event) => set('timeOfDay', event.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </Field>

        <Field label={t('editor.method')}>
          <select
            value={values.method}
            onChange={(event) => set('method', event.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          >
            <option value="">{t('inbox.ruleNotChosen')}</option>
            {lists.accounts
              .filter((account) => account.isActive)
              .map((account) => (
                <option key={account.id} value={`account:${account.id}`}>
                  {t('editor.accountOption', { name: account.name })}
                </option>
              ))}
            {lists.cards
              .filter((card) => card.isActive)
              .map((card) => (
                <option key={card.id} value={`card:${card.id}`}>
                  {t('editor.cardOption', { name: card.name })}
                </option>
              ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('entryForm.category')}>
            <select
              value={values.categoryId}
              onChange={(event) => set('categoryId', event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            >
              <option value="">{t('inbox.ruleNotChosen')}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('editor.person')}>
            <select
              value={values.personId}
              onChange={(event) => set('personId', event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            >
              <option value="">{t('inbox.ruleNotChosen')}</option>
              {lists.people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {error ? <p className="rounded bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}

        {/*
          저장해도 거래가 생기지 않는다는 사실. 적어 두지 않으면 "자동으로 가계부에
          적히는 것"으로 읽고, 그 오해는 합계가 틀렸다는 신고로 돌아온다.
        */}
        <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          {t('inbox.ruleNote')}
        </p>
      </form>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      {children}
    </div>
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
