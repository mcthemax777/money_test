/**
 * 분류 상세의 "언제·무엇으로 썼나" 세 그래프 -- 요일별 평균, 시간대별 평균, 수단별 합계.
 *
 * 셋 다 분류 상세가 이미 받아 온 그 구간의 거래 목록에서 센다. 서버에 따로 묻지 않는
 * 까닭은 일별 누적과 같은 목록을 써야 그래프끼리 합이 맞기 때문이다. 금액은 걸린 줄만
 * 세는 `expenseAmountOf`/`incomeAmountOf` 를 거친다 (목록 소계와 같은 규칙).
 *
 * **평균은 "하루 평균"이다.** 요일은 그 요일의 합계를 구간 안에 그 요일이 며칠 있었는지로
 * 나누고, 시간대는 그 시간의 합계를 구간의 날 수로 나눈다. 거래 건수로 나누면 한 번 크게
 * 쓴 요일과 자주 조금씩 쓴 요일이 같은 값으로 보인다. 날 수는 **오늘까지**만 센다 --
 * 이번 달을 보는 중에 아직 오지 않은 날까지 넣으면 평균이 절반으로 깎인다.
 */
import type { EntryListItem, WeekStart } from '@money/types';

import {
  dateKeyOf,
  daysBetweenKeys,
  shiftDateKey,
  timeInputOf,
  weekdayNames,
  weekdayOf,
} from './datetime';
import { expenseAmountOf, incomeAmountOf } from './entries';
import { activeLocale, translate } from './i18n';

/** 막대 하나. 12개월 추이와 같은 모양이라 같은 막대 그래프가 그린다. */
export interface BarPoint {
  label: string;
  amount: number;
}

/** 수단 하나의 합계 */
export interface MethodSlice {
  name: string;
  value: number;
}

export interface UsagePattern {
  weekday: BarPoint[];
  hour: BarPoint[];
  methods: MethodSlice[];
  /** 시간을 적지 않아(자정으로 저장) 시간대에서 뺀 거래 수. */
  untimedCount: number;
  /**
   * 시간을 적은 거래로 센 금액이 있는가. 평균은 반올림하므로 막대 값으로는 가를 수 없다
   * (한 달에 10원이면 하루 평균이 0원이다).
   */
  hasTimedAmount: boolean;
}

interface UsagePatternInput {
  entries: EntryListItem[];
  /** 지출 분류면 지출을, 수입 분류면 수입을 센다. */
  type: 'income' | 'expense';
  /** 구간 "YYYY-MM-DD", 양끝 포함 */
  startKey: string;
  endKey: string;
  /** 오늘 "YYYY-MM-DD". 평균의 날 수를 여기서 끊는다. */
  todayKey: string;
  timeZone: string;
  weekStart: WeekStart;
}

export function buildUsagePattern({
  entries,
  type,
  startKey,
  endKey,
  todayKey,
  timeZone,
  weekStart,
}: UsagePatternInput): UsagePattern {
  const amountOf = type === 'expense' ? expenseAmountOf : incomeAmountOf;

  /*
   * 평균의 분모. 구간을 오늘에서 끊고, 요일마다 며칠 있었는지 센다.
   * 구간 전체가 앞날이면 날 수가 0이라 평균도 0이다 (0으로 나누지 않는다).
   */
  const lastKey = endKey < todayKey ? endKey : todayKey;
  const dayCount = Math.max(daysBetweenKeys(startKey, lastKey) + 1, 0);
  const weekdayDays = new Array<number>(7).fill(0);
  for (let index = 0; index < dayCount; index += 1) {
    weekdayDays[weekdayOf(shiftDateKey(startKey, index)).day] += 1;
  }

  const weekdaySums = new Array<number>(7).fill(0);
  const hourSums = new Array<number>(24).fill(0);
  const methodSums = new Map<string, MethodSlice>();
  let untimedCount = 0;
  const noMethod = translate(activeLocale(), 'detail.noMethod');

  for (const entry of entries) {
    const amount = amountOf(entry);
    if (amount === 0) continue;

    weekdaySums[weekdayOf(dateKeyOf(entry.date, timeZone)).day] += amount;

    // 시간을 적지 않은 거래는 그날 자정으로 저장된다. 0시에 넣으면 새벽에 몰아 쓴 것처럼 보인다.
    const time = timeInputOf(entry.date, timeZone);
    if (time === '') untimedCount += 1;
    else hourSums[Number(time.slice(0, 2))] += amount;

    /*
     * 수단. 카드로 냈으면 카드, 아니면 계좌다. 이체의 수수료는 보낸 계좌(accountId)에
     * 붙는다. 자산 탭의 결제수단 집계(`paymentMethods`)와 같은 규칙이다.
     */
    const id = entry.cardId ?? entry.accountId ?? '';
    const name = (entry.cardId ? entry.cardName : entry.accountName) || noMethod;
    const slice = methodSums.get(id);
    if (slice) slice.value += amount;
    else methodSums.set(id, { name, value: amount });
  }

  const averageOf = (sum: number, days: number) => (days > 0 ? Math.round(sum / days) : 0);

  // 요일은 사용자가 고른 시작 요일부터 늘어놓는다. 달력 머리글과 같은 차례다.
  const names = weekdayNames(weekStart);
  const weekday = names.map((label, index) => {
    const day = (weekStart + index) % 7;
    return { label, amount: averageOf(weekdaySums[day], weekdayDays[day]) };
  });

  const hour = hourSums.map((sum, value) => ({
    label: translate(activeLocale(), 'chart.hourTick', { hour: value }),
    amount: averageOf(sum, dayCount),
  }));

  // 환불이 더 커서 합이 0 이하가 된 수단은 원형에 그릴 수 없다.
  const methods = [...methodSums.values()]
    .filter((slice) => slice.value > 0)
    .sort((a, b) => b.value - a.value);

  return { weekday, hour, methods, untimedCount, hasTimedAmount: hourSums.some((sum) => sum > 0) };
}
