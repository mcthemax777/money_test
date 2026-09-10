/**
 * 반복 등록의 일정 셈과 후보 만들기 검사.
 *
 * 실행:
 *   cd packages/core
 *   node -r ../api/node_modules/ts-node/register/transpile-only scripts/recurring-smoke.ts
 *
 * 이 셈이 틀리면 **없는 거래가 보관함에 쌓이거나, 있어야 할 것이 영영 안 만들어진다.**
 * 서버와 화면이 같은 함수를 쓰므로(`@money/types` 의 recurring) 여기서 한 번 본다.
 *
 * 뒤쪽에서 회차를 후보 모양으로 옮기는 것까지 본다(`recurringDraftItems`). 그 일이
 * 기기에 있어서, 열쇠나 시각이 어긋나면 서버의 구간 검사에 걸려 보관함이 조용히
 * 비어 있게 된다.
 */
import {
  checkRecurring,
  dueOccurrences,
  nextOccurrence,
  type RecurringRuleDto,
  type RecurringSchedule,
} from '@money/types';

import { manualDraftItem, recurringDraftItems } from '../src/lib/recurring-drafts';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

const daily = (extra: Partial<RecurringSchedule> = {}): RecurringSchedule => ({
  frequency: 'daily',
  everyDays: 1,
  startDate: '2026-09-01',
  ...extra,
});

console.log('── 매일 ──');
{
  eq('시작일부터 오늘까지', dueOccurrences(daily(), '2026-09-04').join(','), '2026-09-01,2026-09-02,2026-09-03,2026-09-04');
  eq(
    '이미 만든 다음날부터',
    dueOccurrences(daily({ lastMadeOn: '2026-09-02' }), '2026-09-04').join(','),
    '2026-09-03,2026-09-04',
  );
  eq('오늘 것을 이미 만들었으면 없다', dueOccurrences(daily({ lastMadeOn: '2026-09-04' }), '2026-09-04').length, 0);
  eq('시작일이 오면 그날부터', dueOccurrences(daily({ startDate: '2026-09-10' }), '2026-09-04').length, 0);
  eq('다음 예정일', nextOccurrence(daily({ lastMadeOn: '2026-09-04' }), '2026-09-04'), '2026-09-05');
}

console.log('\n── 며칠마다 ──');
{
  const every3 = daily({ everyDays: 3 });
  eq('사흘마다', dueOccurrences(every3, '2026-09-08').join(','), '2026-09-01,2026-09-04,2026-09-07');
  eq(
    '이어서 셀 때도 걸음이 어긋나지 않는다',
    dueOccurrences(daily({ everyDays: 3, lastMadeOn: '2026-09-04' }), '2026-09-08').join(','),
    '2026-09-07',
  );
  eq('다음 예정일', nextOccurrence(daily({ everyDays: 3, lastMadeOn: '2026-09-07' }), '2026-09-08'), '2026-09-10');
}

console.log('\n── 매월 특정일 ──');
{
  const monthly: RecurringSchedule = {
    frequency: 'monthly',
    dayOfMonth: 25,
    startDate: '2026-01-01',
    lastMadeOn: '2026-08-25',
  };
  eq('그 달의 25일', dueOccurrences(monthly, '2026-09-30').join(','), '2026-09-25');
  eq('25일 전에는 아직', dueOccurrences(monthly, '2026-09-24').length, 0);
  eq('다음 예정일', nextOccurrence(monthly, '2026-09-01'), '2026-09-25');

  /*
   * 그 달에 없는 날은 마지막 날로 당긴다.
   *
   * 매월 31일로 둔 월세가 2월에 건너뛰면 그 달만 기록이 빈다.
   */
  const endOfMonth: RecurringSchedule = {
    frequency: 'monthly',
    dayOfMonth: 31,
    startDate: '2027-01-01',
    lastMadeOn: '2027-01-31',
  };
  eq('2월은 28일', dueOccurrences(endOfMonth, '2027-03-01').join(','), '2027-02-28');

  const leap: RecurringSchedule = {
    frequency: 'monthly',
    dayOfMonth: 31,
    startDate: '2028-01-01',
    lastMadeOn: '2028-01-31',
  };
  eq('윤년 2월은 29일', dueOccurrences(leap, '2028-03-01').join(','), '2028-02-29');
}

console.log('\n── 매년 ──');
{
  const yearly: RecurringSchedule = {
    frequency: 'yearly',
    month: 3,
    dayOfMonth: 1,
    startDate: '2020-01-01',
    lastMadeOn: '2026-03-01',
  };
  eq('올해 것은 이미 만들었다', dueOccurrences(yearly, '2026-09-08').length, 0);
  eq('다음 예정일은 내년', nextOccurrence(yearly, '2026-09-08'), '2027-03-01');
}

console.log('\n── 끝나는 날 ──');
{
  const ending = daily({ endDate: '2026-09-03' });
  eq('끝난 뒤로는 만들지 않는다', dueOccurrences(ending, '2026-09-10').join(','), '2026-09-01,2026-09-02,2026-09-03');
  eq('다음 예정일도 없다', nextOccurrence(daily({ endDate: '2026-09-03', lastMadeOn: '2026-09-03' }), '2026-09-10'), 'null');
}

console.log('\n── 오래 밀린 반복 ──');
{
  /*
   * 2년 전에 시작한 매일 반복을 오늘 처음 돌리면 700건이 쏟아진다. 최근 것만 따라잡는다.
   */
  const old = daily({ startDate: '2024-01-01' });
  const dates = dueOccurrences(old, '2026-09-08');
  eq('한 번에 만드는 수를 제한한다', dates.length <= 31, true);
  eq('가장 오래된 것도 한 달 안', dates[0]! >= '2026-08-08', true);
  eq('오늘까지 만든다', dates[dates.length - 1], '2026-09-08');
}

console.log('\n── 저장할 수 없는 일정 ──');
{
  eq('맞는 일정', checkRecurring(daily()), 'null');
  eq('며칠마다가 0', checkRecurring(daily({ everyDays: 0 }))?.code, 'EVERY_DAYS_INVALID');
  eq(
    '매월인데 날이 없다',
    checkRecurring({ frequency: 'monthly', startDate: '2026-09-01' })?.code,
    'DAY_OF_MONTH_INVALID',
  );
  eq(
    '매년인데 달이 없다',
    checkRecurring({ frequency: 'yearly', dayOfMonth: 1, startDate: '2026-09-01' })?.code,
    'MONTH_INVALID',
  );
  eq(
    '끝나는 날이 시작보다 앞',
    checkRecurring(daily({ endDate: '2026-08-01' }))?.code,
    'END_BEFORE_START',
  );
  eq('날짜 모양이 아니다', checkRecurring(daily({ startDate: '2026-9-1' }))?.code, 'START_DATE_INVALID');
}

console.log('\n── 후보로 옮기기 ──');
{
  const rule = (extra: Partial<RecurringRuleDto.Response> = {}): RecurringRuleDto.Response => ({
    id: 'rule1',
    projectId: 'p1',
    isActive: true,
    frequency: 'daily',
    everyDays: 1,
    dayOfMonth: null,
    month: null,
    startDate: '2026-09-03',
    endDate: null,
    timeOfDay: null,
    kind: 'expense',
    amount: '4500',
    currency: null,
    description: '점심 도시락',
    merchant: '점심 도시락',
    personId: null,
    categoryId: null,
    accountId: null,
    cardId: null,
    installmentMonths: null,
    createdAt: '2026-09-03T00:00:00.000Z',
    updatedAt: '2026-09-03T00:00:00.000Z',
    nextRunOn: null,
    lastMadeOn: null,
    ...extra,
  });

  const items = recurringDraftItems([rule()], '2026-09-05', 'Asia/Seoul');
  eq('밀린 회차만큼', items.length, 3);
  eq('열쇠', items[0].dedupeKey, 'r:rule1:2026-09-03');
  eq('원문에 날짜가 있다', items[0].rawText, '점심 도시락 · 2026-09-03');
  eq('반복을 가리킨다', items[0].recurringRuleId, 'rule1');
  eq('사람이 적은 값이라 확신 100', items[0].confidence, 100);
  // 시각을 안 정했으면 정오다. 서울 정오는 UTC 03:00 이라 어느 시간대에서도 그 날이다.
  eq('정오로 담는다', items[0].occurredAt, '2026-09-03T03:00:00.000Z');
  eq('금액을 그대로', items[0].amount, '4500');

  eq(
    '정해 둔 시각으로',
    recurringDraftItems([rule({ timeOfDay: '07:30' })], '2026-09-03', 'Asia/Seoul')[0].occurredAt,
    '2026-09-02T22:30:00.000Z',
  );

  eq(
    '만든 날 다음부터',
    recurringDraftItems([rule({ lastMadeOn: '2026-09-04' })], '2026-09-05', 'Asia/Seoul')
      .map((item) => item.dedupeKey)
      .join(','),
    'r:rule1:2026-09-05',
  );
  eq(
    '오늘 것까지 만들었으면 없다',
    recurringDraftItems([rule({ lastMadeOn: '2026-09-05' })], '2026-09-05', 'Asia/Seoul').length,
    0,
  );
  eq(
    '꺼 둔 반복은 건너뛴다',
    recurringDraftItems([rule({ isActive: false })], '2026-09-05', 'Asia/Seoul').length,
    0,
  );
  eq(
    '끝난 반복은 없다',
    recurringDraftItems([rule({ endDate: '2026-09-04' })], '2026-09-10', 'Asia/Seoul')
      .map((item) => item.dedupeKey)
      .join(','),
    'r:rule1:2026-09-03,r:rule1:2026-09-04',
  );
  eq(
    '오래 밀려도 상한까지만',
    recurringDraftItems([rule({ startDate: '2024-01-01' })], '2026-09-05', 'Asia/Seoul').length,
    31,
  );
  eq('둘을 함께', recurringDraftItems([rule(), rule({ id: 'rule2' })], '2026-09-03', 'Asia/Seoul').length, 2);
}

/*
 * 주기 없는 반복.
 *
 * 저절로 오는 날이 하나도 없어야 한다 -- 하루라도 돌려주면 보관함을 열 때마다 후보가
 * 저절로 쌓인다. 만들기를 누른 것만 생기고, 두 번 누르면 두 건이어야 한다(날짜가
 * 같아도 열쇠가 달라야 한다).
 */
console.log('\n── 주기 없음 ──');
{
  const schedule: RecurringSchedule = { frequency: 'none', startDate: '2026-09-01' };
  eq('저절로 오는 날이 없다', dueOccurrences(schedule, '2026-09-30').length, 0);
  eq('다음 예정일도 없다', nextOccurrence(schedule, '2026-09-05'), null);
  eq('저장할 수 있는 일정이다', checkRecurring(schedule), null);
  eq(
    '시작일이 지나도 없다',
    dueOccurrences({ ...schedule, startDate: '2024-01-01' }, '2026-09-05').length,
    0,
  );

  const manual = (): RecurringRuleDto.Response =>
    ({
      id: 'rule9',
      isActive: true,
      frequency: 'none',
      everyDays: null,
      dayOfMonth: null,
      month: null,
      startDate: '2026-09-01',
      endDate: null,
      timeOfDay: null,
      kind: 'expense',
      amount: '4500',
      currency: 'KRW',
      description: '아침 커피',
      merchant: '아침 커피',
      personId: null,
      categoryId: 'cat1',
      accountId: null,
      cardId: 'card1',
      installmentMonths: null,
      lastMadeOn: null,
      nextRunOn: null,
    }) as RecurringRuleDto.Response;

  eq('목록을 읽어도 만들지 않는다', recurringDraftItems([manual()], '2026-09-05', 'Asia/Seoul').length, 0);

  const one = manualDraftItem(manual(), '2026-09-05', 'Asia/Seoul');
  eq('누르면 그 날짜로 하나', one.occurredAt, '2026-09-05T03:00:00.000Z');
  eq('반복을 가리킨다', one.recurringRuleId, 'rule9');
  eq('값을 그대로 담는다', one.amount, '4500');
  eq('열쇠가 그 날짜로 시작한다', one.dedupeKey?.startsWith('r:rule9:2026-09-05:'), true);

  const other = manualDraftItem(manual(), '2026-09-05', 'Asia/Seoul');
  eq('두 번 누르면 열쇠가 다르다', one.dedupeKey !== other.dedupeKey, true);
}

console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
