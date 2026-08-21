/**
 * 차트 공통 스타일.
 *
 * 자산 추이 차트(AssetHistoryChart)의 모양을 기준으로 삼는다. 결제수단·예산 화면의
 * 차트가 각자 다른 색과 축 형식을 쓰고 있어 같은 금액을 화면마다 다르게 읽게 됐다.
 * recharts 컴포넌트에 그대로 펼쳐 넣을 수 있는 형태로 한곳에 모은다.
 */
import { formatCurrency, toNumber } from './money';

/**
 * 격자선. 가로선만 남긴다.
 *
 * 세로 점선은 막대나 꺾은선과 겹쳐 데이터처럼 보이고 읽기를 방해한다.
 */
export const CHART_GRID = {
  strokeDasharray: '3 3',
  stroke: '#eee',
  vertical: false,
} as const;

export const CHART_MARGIN = { top: 8, right: 16, bottom: 8, left: 8 } as const;

/** 축 글자 크기. 원 단위 금액이 길어 12px보다 크면 눈금이 겹친다. */
export const CHART_TICK = { fontSize: 12 } as const;

export const CHART_TOOLTIP_STYLE = {
  backgroundColor: '#fff',
  border: '1px solid #ccc',
} as const;

/** 선·막대 기본 색 (tailwind blue-600) */
export const CHART_COLOR = '#2563eb';

/** Y축 폭. 만원/억 단위로 줄여 써도 네 자리가 들어갈 만큼은 필요하다. */
export const CHART_Y_AXIS_WIDTH = 64;

/** 꺾은선 점 크기. 마우스를 올린 점만 크게 보여 준다. */
export const CHART_DOT = { r: 3 } as const;
export const CHART_ACTIVE_DOT = { r: 5 } as const;

/** 축 눈금은 만원/억 단위로 줄여 쓴다. 원 단위로 적으면 자리수가 길어 겹친다. */
export function formatAxisAmount(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억`;
  if (abs >= 10_000) return `${Math.round(value / 10_000).toLocaleString('ko-KR')}만`;
  return value.toLocaleString('ko-KR');
}

/**
 * 툴팁 금액. recharts는 [값, 이름] 순서로 받는다.
 *
 * 축은 줄여 쓰지만 툴팁은 원 단위 전체 금액을 보여 준다.
 */
export function formatTooltipAmount(value: unknown, name: string): [string, string] {
  return [formatCurrency(toNumber(value as string | number)), name];
}

/** 일 단위 X축 눈금: 1 → "1일" */
export function formatDayTick(day: number | string): string {
  return `${day}일`;
}
