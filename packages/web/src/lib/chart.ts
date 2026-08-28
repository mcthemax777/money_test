/**
 * 차트 공통 스타일.
 *
 * 자산 추이 차트(AssetHistoryChart)의 모양을 기준으로 삼는다. 결제수단·예산 화면의
 * 차트가 각자 다른 색과 축 형식을 쓰고 있어 같은 금액을 화면마다 다르게 읽게 됐다.
 * recharts 컴포넌트에 그대로 펼쳐 넣을 수 있는 형태로 한곳에 모은다.
 */
import { currencyDecimals } from '@money/types';

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

/**
 * 여러 갈래를 한 그림에 그릴 때 쓰는 색. 정해진 차례대로 쓰고 돌려 쓰지 않는다.
 *
 * 색맹 상태에서도 이웃한 두 색이 갈라지는지 검사를 거친 조합이다. 밝은 바탕과의
 * 대비가 3:1에 못 미치는 색이 섞여 있으므로, 이 색을 쓰는 그림은 이름표를 함께
 * 보여야 한다(색만으로 구분하게 두지 않는다).
 *
 * 여덟 갈래를 넘어가면 새 색을 만들지 않고 "기타"로 묶는다.
 */
export const CHART_CATEGORY_COLORS = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#4a3aa7',
  '#e34948',
] as const;

/**
 * Y축 폭.
 *
 * 만원/억 단위로 줄여 써도 네 자리가 들어갈 만큼은 필요하다. 꺾은선은 좁은 구간을
 * 확대해 그리므로 "1,234,560"이나 "1,000.5만"처럼 더 긴 눈금이 나온다.
 */
export const CHART_Y_AXIS_WIDTH = 76;

/** 꺾은선 점 크기. 마우스를 올린 점만 크게 보여 준다. */
export const CHART_DOT = { r: 3 } as const;
export const CHART_ACTIVE_DOT = { r: 5 } as const;

/** 눈금 간격으로 쓸 만한 값. 자리수를 곱해 1·2·5·10 배로 쓴다. */
const NICE_STEPS = [1, 2, 5, 10];

/**
 * 큰 단위부터. 눈금 간격이 그 단위로 적어도 구분되는지 위에서부터 따진다.
 *
 * 만·억은 보조 단위를 쓰지 않는 통화(원, 엔)의 자리 세는 법이다. 달러 금액에
 * 붙이면 "0.7만" 같은 눈금이 나오므로 통화에 따라 표를 바꾼다.
 */
const TICK_UNITS_WHOLE = [
  { div: 100_000_000, suffix: '억' },
  { div: 10_000, suffix: '만' },
  { div: 1, suffix: '' },
];

const TICK_UNITS_DECIMAL = [
  { div: 1_000_000, suffix: 'M' },
  { div: 1_000, suffix: 'K' },
  { div: 1, suffix: '' },
];

/** 소수점 자리를 몇 개 써야 이 간격이 글자로 드러나는지. 1 이상이면 필요 없다. */
function decimalsFor(stepInUnit: number): number {
  return stepInUnit >= 1 ? 0 : Math.ceil(-Math.log10(stepInUnit));
}

/**
 * 눈금 간격.
 *
 * 구간을 넷으로 나눈 값보다 크거나 같은 "1·2·5·10 × 10의 거듭제곱"을 고른다.
 * 1,234 대신 2,000처럼 읽기 쉬운 값이 되어 눈금 글자가 짧아진다.
 * 1원보다 잘게 쪼개지 않는다. 금액에 소수점이 나오면 읽을 수 없다.
 */
function niceStep(span: number): number {
  const raw = span / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  for (const step of NICE_STEPS) {
    if (raw <= step * magnitude) return Math.max(1, step * magnitude);
  }
  return Math.max(1, 10 * magnitude);
}

/**
 * 막대 그래프의 Y축 범위. 언제나 0에서 시작한다.
 *
 * 막대는 길이가 곧 값이다. 0이 아닌 값에서 시작하면 두 막대의 높이 비율이 실제
 * 금액의 비율과 달라져 눈으로 비교한 결과가 틀린다.
 *
 * 값이 모두 0이면 domain이 [0, 0]이 되어 recharts가 축을 그리지 못하고 막대가
 * 최대 높이로 보인다. 그때는 기본 상한을 준다.
 */
export function barDomain(values: number[]): [number, number] {
  const max = Math.max(0, ...values);
  return [0, max > 0 ? Math.ceil((max * 1.2) / 100) * 100 : 1000];
}

export interface LineAxis {
  domain: [number, number];
  ticks: number[];
  tickFormatter: (value: number) => string;
}

/**
 * 꺾은선 그래프의 Y축. 값이 움직인 구간만 보여 준다.
 *
 * 0에서 시작하면 큰 금액의 작은 변동이 직선으로 보인다. 1,000만 원이 한 달에
 * 1,001만 원이 되는 움직임은 0부터 그린 축에서 1픽셀도 되지 않는다. recharts의
 * 기본값이 [0, 'auto']라 이 값을 주지 않으면 언제나 0에서 시작한다.
 *
 * 막대에는 쓰지 않는다(barDomain 주석 참고). 꺾은선은 점의 높이가 아니라 선의
 * 기울기를 읽는 그래프라 아래를 잘라도 뜻이 뒤집히지 않는다.
 *
 * 눈금을 직접 만들어 돌려준다. recharts에 맡기면 구간을 넷으로 갈라 1,000만
 * 원대에서 250원처럼 소수점이 붙는 값이 나오고, 그 눈금들이 모두 "1,000만"으로
 * 반올림되어 같은 글자가 여러 번 찍힌다. 단위와 소수점 자리도 간격에서 정한다.
 */
export function lineAxis(values: number[], currency: string): LineAxis {
  const [lo, hi, step] = bounds(values);

  const ticks: number[] = [];
  // 부동소수 누적 오차를 피하려고 간격의 배수로 만든다.
  for (let i = 0; lo + step * i <= hi + step / 2; i += 1) ticks.push(lo + step * i);

  const maxAbs = Math.max(Math.abs(lo), Math.abs(hi));
  // 간격이 그 단위에서 소수점 두 자리 안에 드러나는 첫 단위를 쓴다. 1,000만 원대의
  // 5,000원 간격을 억으로 적으면 눈금이 전부 "1.0억"이 된다.
  const units = currencyDecimals(currency) === 0 ? TICK_UNITS_WHOLE : TICK_UNITS_DECIMAL;
  const unit =
    units.find((u) => maxAbs >= u.div && decimalsFor(step / u.div) <= 2) ??
    units[units.length - 1];
  const decimals = Math.min(decimalsFor(step / unit.div), 2);

  return {
    domain: [lo, hi],
    ticks,
    tickFormatter: (value: number) =>
      value === 0
        ? '0'
        : `${(value / unit.div).toLocaleString('ko-KR', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
          })}${unit.suffix}`,
  };
}

/** 꺾은선 축의 아래끝·위끝·눈금 간격. 끝은 간격의 배수에 맞춘다. */
function bounds(values: number[]): [number, number, number] {
  if (values.length === 0) return [0, 1000, 250];

  const min = Math.min(...values);
  const max = Math.max(...values);

  // 값이 하나뿐이거나 전부 같으면 구간이 없다. 그 값을 가운데 두고 여백을 만든다.
  if (min === max) {
    if (min === 0) return [0, 1000, 250];
    const step = niceStep(Math.abs(min));
    return [min - step, min + step, step];
  }

  const step = niceStep(max - min);
  return [Math.floor(min / step) * step, Math.ceil(max / step) * step, step];
}

/**
 * 축 눈금은 큰 단위로 줄여 쓴다. 낱단위로 적으면 자리수가 길어 겹친다.
 *
 * 만/억은 보조 단위를 쓰지 않는 통화(원, 엔)의 자리 세는 법이다. 달러처럼
 * 소수 단위를 쓰는 통화에 붙이면 "0만"만 늘어서므로 K/M으로 줄인다.
 */
export function formatAxisAmount(value: number, currency: string): string {
  const abs = Math.abs(value);

  if (currencyDecimals(currency) === 0) {
    if (abs >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억`;
    if (abs >= 10_000) return `${Math.round(value / 10_000).toLocaleString('ko-KR')}만`;
    return value.toLocaleString('ko-KR');
  }

  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

/**
 * 툴팁 금액. recharts는 [값, 이름] 순서로 받는다.
 *
 * 축은 줄여 쓰지만 툴팁은 원 단위 전체 금액을 보여 준다.
 */
export function formatTooltipAmount(
  value: unknown,
  name: string,
  currency: string,
): [string, string] {
  return [formatCurrency(toNumber(value as string | number), currency), name];
}

