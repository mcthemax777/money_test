/**
 * 반복 규칙 → 보관함에 담을 후보.
 *
 * **회차를 만드는 자리다.** 정해 둔 날이 지났는데 아직 후보가 없는 날을 찾아
 * (`dueOccurrences`) 서버가 받는 모양으로 옮긴다. 웹과 앱이 같은 함수를 쓴다.
 *
 * 서버가 아니라 기기가 만드는 까닭은 알림·캡처 후보와 같다 -- 후보를 만드는 길이
 * 하나여야 한다(`POST /entry-drafts`, 겹침은 `dedupeKey` 가 막는다). 서버가 따로
 * 만들면 같은 일을 두 곳에서 하게 되고, 그 두 곳이 어긋나면 어느 쪽이 맞는지 판정할
 * 근거가 없다.
 *
 * 몇 번을 불러도 같은 결과다. 열쇠가 `r:<규칙>:<날짜>` 라 같은 회차는 서버에서 한 번만
 * 담긴다. 그래서 여러 기기가 같은 반복을 동시에 올려도 후보가 늘지 않는다.
 */

import {
  dueOccurrences,
  zonedDateKey,
  zonedFormValueToUtc,
  type EntryDraftDto,
  type RecurringRuleDto,
  type RecurringSchedule,
} from '@money/types';

/**
 * 이 반복의 후보에 붙는 중복 열쇠.
 *
 * 서버도 같은 모양을 기대한다(구간 검사). 여기서 만들고 저기서 가르는 그 한 줄이라
 * 함수로 둔다.
 */
export function recurringDedupeKey(ruleId: string, dateKey: string): string {
  return `r:${ruleId}:${dateKey}`;
}

/**
 * 사람이 눌러 만드는 회차의 열쇠. 날짜 뒤에 표를 하나 더 붙인다.
 *
 * 주기가 없는 반복(`frequency: 'none'`)은 정해진 날이 없고 사람이 누를 때마다 하나가
 * 생긴다. 날짜까지만 열쇠로 두면 **하루에 한 번밖에 못 만든다** -- 같은 카페를 아침에
 * 한 번, 저녁에 한 번 갔을 때 두 번째 누름이 조용히 삼켜진다. 그래서 뒤에 그 누름을
 * 가리키는 표를 붙여 날짜가 같아도 다른 열쇠가 되게 한다.
 *
 * 시각과 난수를 섞는다. 시각만으로는 두 기기가 같은 밀리초에 누를 자리가 남고,
 * 난수만으로는 열쇠가 시간순으로 서지 않는다.
 *
 * 열쇠는 **한 번만 만든다.** 올리다 실패해 다시 올릴 때는 같은 열쇠여야 하고(그때
 * 겹침을 유일 제약이 막는다), 누를 때마다 새로 만들면 실패한 누름이 두 건이 된다.
 */
export function manualDedupeKey(ruleId: string, dateKey: string): string {
  const stamp = Date.now().toString(36);
  const salt = Math.floor(Math.random() * 46_656)
    .toString(36)
    .padStart(3, '0');
  return `${recurringDedupeKey(ruleId, dateKey)}:${stamp}${salt}`;
}

/**
 * 아직 만들지 않은 회차를 후보 모양으로.
 *
 * @param rules 서버에서 읽은 반복 목록. **꺼 둔 것은 건너뛴다.**
 * @param todayKey 프로젝트 타임존의 오늘 ("YYYY-MM-DD")
 * @param timeZone 프로젝트 타임존. 후보의 거래 시각을 만드는 데 쓴다
 */
export function recurringDraftItems(
  rules: RecurringRuleDto.Response[],
  todayKey: string,
  timeZone: string,
): EntryDraftDto.CreateItem[] {
  const items: EntryDraftDto.CreateItem[] = [];

  for (const rule of rules) {
    if (!rule.isActive) continue;

    /*
     * 어디부터 셀지는 `lastMadeOn` 이 정한다.
     *
     * 서버가 후보를 세어 실어 보낸 값이다("이 반복은 이 날까지 만들어졌다"). 이것이
     * 없으면 열 때마다 최근 31일치를 올리고 서버가 서른 건을 건너뛴다 -- 결과는 같지만
     * 헛일이다.
     */
    const schedule: RecurringSchedule = {
      frequency: rule.frequency,
      everyDays: rule.everyDays,
      dayOfMonth: rule.dayOfMonth,
      month: rule.month,
      startDate: rule.startDate,
      endDate: rule.endDate,
      lastMadeOn: rule.lastMadeOn,
    };

    for (const dateKey of dueOccurrences(schedule, todayKey)) {
      items.push(draftItem(rule, dateKey, timeZone, recurringDedupeKey(rule.id, dateKey)));
    }
  }

  return items;
}

/**
 * 사람이 "만들기"를 눌러 그 자리에서 만드는 회차 하나.
 *
 * 주기 없는 반복이 쓴다. 밀린 회차와 **같은 모양**으로 만들어야 한다 -- 보관함에
 * 들어간 뒤로는 어느 쪽에서 왔는지 구별하지 않고, 서버의 구간 검사도 같은 것을 본다.
 * 다른 것은 열쇠 뒤에 붙는 표뿐이다(`manualDedupeKey`).
 *
 * **누른 그 순간의 시각으로 담는다.** 정해 둔 시각(`timeOfDay`)을 보지 않는다 -- 주기
 * 없는 반복에는 "몇 시에 만들어질 날" 이라는 것이 없고, 사람이 지금 쓴 돈을 지금 적는
 * 것이라 그때가 곧 거래 시각이다. 폼에서도 그 칸을 감춘다.
 *
 * 날짜와 시각을 **한 순간에서** 뽑는다. 날짜를 밖에서 받아 시각만 여기서 읽으면 자정을
 * 넘는 순간에 둘이 어긋나고, 그때 열쇠의 날짜와 거래 시각의 날짜가 달라 서버가 거절한다.
 *
 * 꺼 둔 반복도 만든다. 끄고 켜는 것은 "저절로 만들어질지"를 정하는 것이고, 주기 없는
 * 반복에는 저절로 만들어지는 일이 없어 그 단추 자리에 "만들기"가 대신 선다.
 */
export function manualDraftItem(
  rule: RecurringRuleDto.Response,
  timeZone: string,
): EntryDraftDto.CreateItem {
  const now = new Date();
  const dateKey = zonedDateKey(now, timeZone);
  return draftItem(rule, dateKey, timeZone, manualDedupeKey(rule.id, dateKey), now);
}

/** 반복 하나를 그 날짜의 후보로. 밀린 회차와 손으로 누른 회차가 함께 쓴다. */
function draftItem(
  rule: RecurringRuleDto.Response,
  dateKey: string,
  timeZone: string,
  dedupeKey: string,
  /** 손으로 누른 회차의 시각. 없으면 정해 둔 시각(없으면 정오)으로 그 날에 담는다. */
  at?: Date,
): EntryDraftDto.CreateItem {
  /*
   * 그 날의 몇 시로 적을지.
   *
   * 시각을 정해 두지 않았으면 정오로 둔다 -- 어느 시간대에서 보아도 같은 날에
   * 남는다. 하루의 시작(00:00)으로 두면 시간대가 다른 곳에서 전날이 된다.
   */
  const occurredAt = at ?? zonedFormValueToUtc(dateKey, rule.timeOfDay ?? '12:00', timeZone);

  return {
    source: 'recurring',
    dedupeKey,
    /*
     * 원문 자리에는 무엇을 적었는지 사람 말로 남긴다.
     *
     * 알림·캡처의 원문은 읽어 온 글이지만 반복에는 그런 것이 없다. 비워 두면
     * 화면의 "읽은 원문"이 빈 상자가 되고, 서버도 원문 없는 후보를 받지 않는다.
     */
    rawText: `${rule.description} · ${dateKey}`,
    kind: rule.kind,
    amount: rule.amount,
    currency: rule.currency,
    occurredAt: occurredAt.toISOString(),
    merchant: rule.merchant,
    description: rule.description,
    installmentMonths: rule.installmentMonths,
    personId: rule.personId,
    categoryId: rule.categoryId,
    accountId: rule.accountId,
    cardId: rule.cardId,
    // 사람이 적어 둔 값이라 읽어 낸 것과 달리 의심할 자리가 없다.
    confidence: 100,
    parser: 'recurring',
    recurringRuleId: rule.id,
  };
}
