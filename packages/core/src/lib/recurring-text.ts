/**
 * 반복 규칙의 주기를 사람 말로. 웹과 앱의 목록·폼이 함께 쓴다.
 *
 * 규칙이 들고 있는 숫자를 그대로 보이면(everyDays=3, dayOfMonth=25) 무슨 뜻인지 읽는
 * 사람이 다시 옮겨야 한다.
 */
import type { RecurringFrequency, RecurringHolidayRule, RecurringRuleDto } from '@money/types';

import type { MessageKey } from './i18n';
import { missingFields } from './draft-collect';
import { weekdayNames } from './datetime';

type Translate = (key: MessageKey) => string;

/**
 * 저장하려는 반복에서 비어 있는 칸의 이름. "금액, 결제수단". 다 채웠으면 null.
 *
 * 비워 둔 칸은 회차 후보마다 보관함에서 채워야 한다. 달마다 금액이 바뀌는 관리비처럼
 * 일부러 비우는 일이 있어 막지는 않고, 저장 전에 한 번 묻는 데 쓴다.
 */
export function recurringMissingText(body: RecurringRuleDto.Body, t: Translate): string | null {
  const labels: Record<ReturnType<typeof missingFields>[number], MessageKey> = {
    amount: 'editor.amount',
    // 이체에서 결제수단 칸은 보내는 통장이다. 폼의 칸 이름과 같게 적는다.
    method: body.kind === 'transfer' ? 'editor.fromAccount' : 'editor.method',
    toAccount: 'editor.toAccount',
    category: 'entryForm.category',
  };
  const missing = missingFields(body);
  return missing.length > 0 ? missing.map((field) => t(labels[field])).join(', ') : null;
}

/** 주기마다 고를 수 있는 휴일 처리의 이름. 고르는 칸과 목록의 꼬리말이 같은 말을 쓴다. */
export const HOLIDAY_RULE_LABEL: Record<
  RecurringFrequency,
  Partial<Record<RecurringHolidayRule, MessageKey>>
> = {
  none: {},
  daily: { none: 'inbox.holiday.daily.none', skip: 'inbox.holiday.daily.skip' },
  weekly: { none: 'inbox.holiday.weekly.none', skip: 'inbox.holiday.weekly.skip' },
  monthly: {
    none: 'inbox.holiday.move.none',
    before: 'inbox.holiday.move.before',
    after: 'inbox.holiday.move.after',
  },
  yearly: {
    none: 'inbox.holiday.move.none',
    before: 'inbox.holiday.move.before',
    after: 'inbox.holiday.move.after',
  },
};

/**
 * 고른 요일들을 시작 요일부터 차례로. "월·수·금".
 *
 * @param weekStart 주의 시작 요일 (0 일요일). 폼의 알약 차례와 같게 늘어놓는다.
 */
export function weekdaysText(weekdays: number[], weekStart: number): string {
  const names = weekdayNames(0);
  return [...weekdays]
    .sort((a, b) => ((a - weekStart + 7) % 7) - ((b - weekStart + 7) % 7))
    .map((day) => names[day])
    .join('·');
}

/**
 * 주기를 한 줄로. "매월 25일", "3일마다", "매주 월·금 · 공휴일 제외".
 *
 * 휴일 처리가 그대로(`none`)면 꼬리말을 붙이지 않는다 -- 지금까지의 반복과 같은 모양이다.
 */
export function recurringScheduleText(
  rule: Pick<
    RecurringRuleDto.Response,
    'frequency' | 'everyDays' | 'weekdays' | 'holidayRule' | 'dayOfMonth' | 'month'
  >,
  t: Translate,
  weekStart = 0,
): string {
  if (rule.frequency === 'none') return t('inbox.freq.none');

  let text: string;
  if (rule.frequency === 'daily') {
    const days = rule.everyDays ?? 1;
    text = days <= 1 ? t('inbox.freq.daily') : `${days}${t('inbox.everyDaysUnit')}`;
  } else if (rule.frequency === 'weekly') {
    text = `${t('inbox.freq.weekly')} ${weekdaysText(rule.weekdays ?? [], weekStart)}`;
  } else {
    const day = `${rule.dayOfMonth ?? 1}${t('inbox.dayOfMonthUnit')}`;
    text =
      rule.frequency === 'yearly'
        ? `${t('inbox.freq.yearly')} ${rule.month ?? 1}${t('inbox.monthUnit')} ${day}`
        : `${t('inbox.freq.monthly')} ${day}`;
  }

  // 옛 서버는 이 칸을 싣지 않는다. 없으면 그대로다.
  const holidayRule = rule.holidayRule ?? 'none';
  const label = holidayRule === 'none' ? null : HOLIDAY_RULE_LABEL[rule.frequency][holidayRule];
  return label ? `${text} · ${t(label)}` : text;
}
