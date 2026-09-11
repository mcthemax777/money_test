/**
 * 주기별 사용액 막대의 속.
 *
 * 어느 주기가 실적을 채웠는지, 축에 무엇이라 적을지, 축의 위아래를 어디에 둘지를
 * 정한다. 그리는 일만 플랫폼이 맡는다 -- 웹은 recharts, 앱은 react-native-svg 다.
 */
import { barDomain } from './chart';
import { formatDateMarker, formatMonthShort, lastDayOfMonth } from './datetime';
import { activeLocale, translate, type MessageKey } from './i18n';
import { toNumber } from './money';
import type { CardUsagePeriod } from './types';

/**
 * 주기의 위치.
 *
 * 'closed' 마감된 주기 · 'ongoing' 오늘이 들어 있는 주기 · 'future' 아직 시작도 하지
 * 않은 주기(할부로 금액만 미리 잡혀 있다).
 */
export type CardUsagePhase = 'closed' | 'ongoing' | 'future';

/** 주기의 위치를 적는 말. 예전 목록에 적던 "마감/진행"을 그대로 쓴다. */
const PHASE_LABEL: Record<CardUsagePhase, MessageKey> = {
  closed: 'settlement.closed',
  ongoing: 'settlement.ongoing',
  future: 'settlement.upcoming',
};

/** 실적을 채운 주기 (tailwind emerald-500) */
export const CARD_USAGE_REACHED_COLOR = '#10b981';
/** 실적에 못 미친 주기 (tailwind amber-500) */
export const CARD_USAGE_SHORT_COLOR = '#f59e0b';
/** 아직 오지 않은 주기. 할부가 미리 잡혀 있을 뿐이라 달성 여부를 말할 수 없다 (gray-300) */
export const CARD_USAGE_FUTURE_COLOR = '#d1d5db';
/** 실적 기준선 (gray-700). 막대 색 둘과 겹치지 않는 색이어야 선이 선으로 읽힌다. */
export const CARD_USAGE_TARGET_COLOR = '#374151';

/** 진행 중인 주기의 막대 투명도. 아직 늘어날 값이라 채도를 낮춰 확정된 주기와 가른다. */
export const CARD_USAGE_ONGOING_OPACITY = 0.55;

export interface CardUsageBar {
  /** 주기를 가리키는 값. 목록의 열쇠로 쓴다. */
  key: string;
  /** 축에 적는 이름 */
  label: string;
  /** 눌렀을 때 적는 말. 구간 전체와 마감 여부다. */
  range: string;
  amount: number;
  phase: CardUsagePhase;
  /** 막대 색. 기준액이 없으면 달성 여부를 말할 수 없어 부르는 쪽의 기본색을 쓴다. */
  fill: string | null;
  fillOpacity: number;
}

/**
 * 축에 적을 이름.
 *
 * 마감일이 말일이면 주기가 곧 달력의 달이라 "8월" 한 마디면 된다. 마감일이 8일이면
 * 8.9~9.8처럼 주기가 두 달에 걸쳐 있어, 달 이름 하나로는 어느 쪽을 가리키는지 알 수
 * 없다. 그때는 양끝 날짜를 그대로 적는다.
 *
 * 날짜는 Intl에 맡기지 않고 숫자로 적는다. 한국어 Intl은 "8. 9."처럼 점 뒤에 빈칸을
 * 넣어, 양끝을 이으면 눈금 하나가 두 배로 길어진다.
 */
export function cardUsageAxisLabel(startKey: string, endKey: string): string {
  const [, startMonth, startDay] = startKey.split('-').map(Number);
  const [, endMonth, endDay] = endKey.split('-').map(Number);

  // 1일에 시작해 그 달 말일에 끝나면 달력의 한 달이다. 마감일 31일이 2월에서 28일로
  // 줄어드는 경우까지 이 검사 하나로 걸린다.
  if (startMonth === endMonth && startDay === 1 && endDay === lastDayOfMonth(endKey.slice(0, 7))) {
    return formatMonthShort(endMonth);
  }

  return `${startMonth}.${startDay}~${endMonth}.${endDay}`;
}

/**
 * 주기 목록을 막대로 옮긴다.
 *
 * @param todayKey 프로젝트 타임존의 오늘 "YYYY-MM-DD". 아직 오지 않은 주기를 가른다.
 * @param target 실적 기준액. 없으면 색으로 달성 여부를 말하지 않는다.
 */
export function cardUsageBars(
  periods: CardUsagePeriod[],
  todayKey: string,
  target: number | null,
): CardUsageBar[] {
  const t = (key: MessageKey) => translate(activeLocale(), key);

  return periods.map((period) => {
    // 주기의 양끝은 UTC 달력 표시자다. 앞 열 자로 잘라 날짜끼리 견준다.
    const startKey = period.periodStart.slice(0, 10);
    const endKey = period.periodEnd.slice(0, 10);
    const phase: CardUsagePhase = period.closed
      ? 'closed'
      : startKey > todayKey
        ? 'future'
        : 'ongoing';
    const amount = toNumber(period.usage);

    return {
      key: endKey,
      label: cardUsageAxisLabel(startKey, endKey),
      range: `${formatDateMarker(period.periodStart)} ~ ${formatDateMarker(period.periodEnd)} · ${t(
        PHASE_LABEL[phase],
      )}`,
      amount,
      phase,
      fill:
        phase === 'future'
          ? CARD_USAGE_FUTURE_COLOR
          : target === null
            ? null
            : amount >= target
              ? CARD_USAGE_REACHED_COLOR
              : CARD_USAGE_SHORT_COLOR,
      fillOpacity: phase === 'ongoing' ? CARD_USAGE_ONGOING_OPACITY : 1,
    };
  });
}

/**
 * 막대 축의 아래끝·위끝.
 *
 * 위끝은 기준선까지 함께 센다. 선이 그래프 밖으로 나가면 선을 그은 뜻이 없다.
 *
 * 아래끝은 보통 0이다 (막대는 길이가 곧 값이라 0에서 시작해야 한다). 취소가 사용보다
 * 많은 주기는 사용액이 음수인데, 0에서 자르면 그 막대가 축 아래로 잘려 나가 아무것도
 * 그려지지 않으므로 그때만 아래를 열어 준다.
 */
export function cardUsageDomain(bars: CardUsageBar[], target: number | null): [number, number] {
  const amounts = bars.map((bar) => bar.amount);
  const [, top] = barDomain(target === null ? amounts : [...amounts, target]);

  const lowest = Math.min(0, ...amounts);
  const bottom = lowest < 0 ? Math.floor((lowest * 1.2) / 100) * 100 : 0;

  return [bottom, top];
}
