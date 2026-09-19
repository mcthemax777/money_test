/**
 * 부드러운 선이 값을 왜곡하지 않는가.
 *
 * 실행:
 *   npx tsx packages/core/scripts/chart-path-smoke.ts
 *
 * 곡선을 쓰는 까닭은 보기 좋아서인데, 그 대가로 **없던 값이 그려지면** 안 된다.
 * 일반적인 3차 곡선은 점 사이에서 위아래로 넘치므로(overshoot), 100만에서 120만으로
 * 오른 구간에 125만짜리 봉우리가 선다. 잔액 추이에서 그것은 거짓말이다.
 *
 * 그래서 셋을 못 박는다.
 *   1. 곡선이 **모든 점을 지난다**.
 *   2. 구간 안에서 **두 끝값을 넘지 않는다** (단조 보간의 약속).
 *   3. 점이 없거나 하나일 때도 터지지 않는다.
 *
 * **웹과 같은 곡선인지는 여기서 보지 않는다.** 그 확인은 d3-shape 의 `curveMonotoneX`
 * 와 직접 견주어 했고(손으로 고른 아홉 경우와 무작위 500회, 모두 같은 `d` 였다), 그
 * 꾸러미는 웹이 Recharts 를 거쳐 끌어오는 것이라 core 의 검사가 기댈 자리가 아니다.
 * 여기서 지키는 것은 그 곡선이 지켜야 할 **성질**이다.
 */
import { monotonePath, type ChartPoint } from '../src/lib/chart-path';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

/** `d` 문자열을 3차 베지에 구간들로 되읽는다. 검사가 제 출력을 믿지 않게 한다. */
function segmentsOf(d: string): Array<[ChartPoint, ChartPoint, ChartPoint, ChartPoint]> {
  const numbers = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  const segments: Array<[ChartPoint, ChartPoint, ChartPoint, ChartPoint]> = [];

  let from: ChartPoint = { x: numbers[0], y: numbers[1] };
  for (let i = 2; i + 5 < numbers.length + 1; i += 6) {
    const c1 = { x: numbers[i], y: numbers[i + 1] };
    const c2 = { x: numbers[i + 2], y: numbers[i + 3] };
    const to = { x: numbers[i + 4], y: numbers[i + 5] };
    segments.push([from, c1, c2, to]);
    from = to;
  }
  return segments;
}

/** 3차 베지에의 한 자리. */
function at(seg: [ChartPoint, ChartPoint, ChartPoint, ChartPoint], t: number): number {
  const u = 1 - t;
  return (
    u * u * u * seg[0].y +
    3 * u * u * t * seg[1].y +
    3 * u * t * t * seg[2].y +
    t * t * t * seg[3].y
  );
}

/** 이 점들로 그린 곡선이 구간의 두 끝값을 넘는 일이 있는가. */
function overshoot(ys: number[]): number {
  const points = ys.map((y, index) => ({ x: index * 10, y }));
  const segments = segmentsOf(monotonePath(points));

  let worst = 0;
  for (const seg of segments) {
    const low = Math.min(seg[0].y, seg[3].y);
    const high = Math.max(seg[0].y, seg[3].y);
    for (let step = 0; step <= 100; step += 1) {
      const y = at(seg, step / 100);
      // 반올림(소수 두 자리)만큼의 오차는 넘침이 아니다.
      worst = Math.max(worst, low - y - 0.01, y - high - 0.01);
    }
  }
  return Math.max(0, Number(worst.toFixed(2)));
}

// ── 1. 점을 지난다 ──
const rising = [{ x: 0, y: 100 }, { x: 10, y: 60 }, { x: 20, y: 80 }, { x: 30, y: 20 }];
const segments = segmentsOf(monotonePath(rising));
eq('구간 수는 점보다 하나 적다', segments.length, rising.length - 1);
eq(
  '모든 점을 지난다',
  segments.every((seg, index) => seg[0].y === rising[index].y && seg[3].y === rising[index + 1].y),
  true,
);

// ── 2. 넘치지 않는다 ──
//
// 봉우리와 골이 이어지는 모양이 곡선을 가장 크게 밀어 올리는 자리다.
eq('오르내리는 값에서 넘치지 않는다', overshoot([100, 60, 80, 20, 90, 30]), 0);
eq('한 번 크게 뛰어도 넘치지 않는다', overshoot([0, 0, 0, 1000, 1000]), 0);
eq('계속 오르기만 해도 넘치지 않는다', overshoot([10, 20, 30, 40, 50]), 0);
eq('평평한 구간이 섞여도 넘치지 않는다', overshoot([50, 50, 10, 10, 50]), 0);

// 평평한 값은 평평하게 남아야 한다. 곡선이 물결치면 없던 오르내림이 보인다.
const flat = segmentsOf(monotonePath([0, 1, 2, 3].map((i) => ({ x: i * 10, y: 42 }))));
eq(
  '값이 같으면 선도 평평하다',
  flat.every((seg) => seg.every((point) => point.y === 42)),
  true,
);

// ── 3. 그릴 것이 없을 때 ──
eq('점이 없으면 빈 글자', monotonePath([]), '');
eq('점이 하나면 옮기기만', monotonePath([{ x: 5, y: 7 }]), 'M 5 7');
// 이을 것이 하나뿐인 구간에 곡선을 둘 까닭이 없다. d3 도 그렇게 한다.
eq('점이 둘이면 곧은 선', monotonePath([{ x: 0, y: 1 }, { x: 10, y: 5 }]), 'M 0 1 L 10 5');
// 같은 x 에 점이 둘이면 기울기를 잴 수 없다. 터지지 않고 평평하게 지난다.
eq(
  '같은 자리의 점에도 무한대가 실리지 않는다',
  /Infinity|NaN/.test(monotonePath([{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 20 }])),
  false,
);

console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
