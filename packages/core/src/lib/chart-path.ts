/**
 * 꺾은선을 부드러운 곡선으로. SVG 의 `d` 문자열을 만든다.
 *
 * 웹은 Recharts 의 `type="monotone"` 으로 그리고, 앱은 SVG 를 손으로 그린다. 두 화면이
 * 같은 값을 다른 모양으로 그리면 폰으로 본 추이와 웹에서 본 추이가 달라 보인다. 그래서
 * **Recharts 가 쓰는 곡선(d3-shape 의 `curveMonotoneX`)을 그대로** 여기 옮겨 두고 앱이
 * 쓴다. 비슷한 곡선이 아니라 같은 곡선이어야 한다 -- 눈으로는 가려낼 수 없는 차이라,
 * 한 번 어긋나면 아무도 알아채지 못한 채 두 화면이 다른 그림을 그린다.
 *
 * **단조(monotone) 보간이다.** 일반적인 3차 곡선은 점과 점 사이에서 위아래로 넘쳐
 * (overshoot) 지나가는데, 잔액 추이에서 그것은 **있지도 않았던 잔액**을 그리는 일이다 --
 * 100만 원에서 120만 원으로 오른 구간에 125만 원짜리 봉우리가 생긴다. 단조 보간은
 * 구간 안에서 두 끝값을 넘지 않는 것이 규칙이라 그 봉우리가 서지 않는다.
 */

export interface ChartPoint {
  x: number;
  y: number;
}

/** 좌표를 짧게 적는다. `d` 문자열이 점 수만큼 길어지므로 소수 두 자리면 충분하다. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function sign(value: number): number {
  return value < 0 ? -1 : 1;
}

/**
 * 안쪽 점의 접선 기울기.
 *
 * 이웃한 두 구간의 기울기(`before`·`after`)를 보고 정한다. 부호가 갈리면 0 이다 --
 * 그 점이 봉우리이거나 골이라, 기울기를 주면 곡선이 그 너머로 넘친다. 부호가 같으면
 * 두 기울기와 그 가중평균의 절반 중 **가장 작은 것**을 고른다. 그 상한이 곧 "넘치지
 * 않는다" 는 약속이다.
 */
function innerSlope(before: number, after: number, widthBefore: number, widthAfter: number): number {
  const weighted = (before * widthAfter + after * widthBefore) / (widthBefore + widthAfter);
  const value =
    (sign(before) + sign(after)) *
    Math.min(Math.abs(before), Math.abs(after), 0.5 * Math.abs(weighted));
  // 부호가 갈리면 위 합이 0 이고, 폭이 0 인 자리에서는 NaN 이 된다. 둘 다 0 으로 눕힌다.
  return Number.isFinite(value) ? value : 0;
}

/**
 * 양 끝 점의 접선 기울기.
 *
 * 끝에는 이웃이 한쪽뿐이라 안쪽과 같은 방법을 쓸 수 없다. 그 구간의 기울기와 **안쪽
 * 이웃의 접선**으로 한쪽만 보고 잡는다. 구간 기울기를 그대로 쓰면 끝이 뻣뻣해져, 같은
 * 값을 웹보다 각지게 그린다.
 */
function edgeSlope(segmentSlope: number, neighborTangent: number, width: number): number {
  if (width === 0) return neighborTangent;
  return (3 * segmentSlope - neighborTangent) / 2;
}

/**
 * 점들을 잇는 부드러운 곡선.
 *
 * 점이 없으면 빈 글자, 하나면 그 자리로 옮기기만 한다(`M`). 둘이면 곧은 선이다 --
 * 이을 것이 하나뿐인 구간에 곡선을 둘 까닭이 없고, d3 도 그렇게 한다. 그릴 선이 없을
 * 때도 부르는 쪽이 갈라 적지 않게 한다.
 */
export function monotonePath(points: readonly ChartPoint[]): string {
  const n = points.length;
  if (n === 0) return '';

  const head = `M ${round(points[0].x)} ${round(points[0].y)}`;
  if (n === 1) return head;
  if (n === 2) return `${head} L ${round(points[1].x)} ${round(points[1].y)}`;

  /*
   * 구간마다의 너비와 기울기.
   *
   * 너비가 0 인 구간(같은 x 에 점이 둘)은 기울기를 잴 수 없다. 0 으로 두면 그 자리가
   * 평평해질 뿐 곡선이 무너지지는 않는다 -- 나눗셈을 그냥 두면 Infinity 가 `d` 에 실려
   * 선이 통째로 사라진다.
   */
  const widths: number[] = [];
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const width = points[i + 1].x - points[i].x;
    widths.push(width);
    slopes.push(width === 0 ? 0 : (points[i + 1].y - points[i].y) / width);
  }

  const tangents: number[] = new Array(n);
  for (let i = 1; i < n - 1; i += 1) {
    tangents[i] = innerSlope(slopes[i - 1], slopes[i], widths[i - 1], widths[i]);
  }
  // 끝은 안쪽 이웃이 정해진 뒤에야 잡을 수 있다.
  tangents[0] = edgeSlope(slopes[0], tangents[1], widths[0]);
  tangents[n - 1] = edgeSlope(slopes[n - 2], tangents[n - 2], widths[n - 2]);

  /*
   * 구간마다 3차 베지에 하나.
   *
   * 조종점은 양 끝에서 구간 너비의 1/3 만큼 떨어진 자리에, 그 점의 접선을 따라 둔다.
   * 그러면 곡선이 두 점을 지나면서 그 자리의 기울기도 맞춘다.
   */
  let path = head;
  for (let i = 0; i < n - 1; i += 1) {
    const step = widths[i] / 3;
    const from = points[i];
    const to = points[i + 1];
    path +=
      ` C ${round(from.x + step)} ${round(from.y + tangents[i] * step)}` +
      ` ${round(to.x - step)} ${round(to.y - tangents[i + 1] * step)}` +
      ` ${round(to.x)} ${round(to.y)}`;
  }
  return path;
}
