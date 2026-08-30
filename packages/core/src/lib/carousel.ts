/**
 * 가로로 늘어놓은 줄에서 칸의 자리를 재는 계산.
 *
 * 넘기는 방법이 둘(끌기, 양옆 버튼)인데 둘 다 "칸이 어디서 시작하는가"를 알아야
 * 한다. 각자 재면 한쪽만 고쳤을 때 버튼과 끌기가 서로 다른 자리에 선다.
 */

/**
 * 칸마다 그 칸이 시작하는 스크롤 좌표.
 *
 * `offsetLeft`를 쓰지 않는다. 그 값은 자리를 잡은(position) 부모가 무엇이냐에 따라
 * 달라져서, 줄을 감싼 상자에 relative가 붙고 안 붙고에 결과가 바뀐다. 화면 좌표에서
 * 줄의 위치를 빼고 지금 스크롤한 만큼을 더하면 그런 사정과 무관하다.
 */
export function itemStarts(el: HTMLElement): number[] {
  const rowLeft = el.getBoundingClientRect().left;

  return Array.from(el.children).map(
    (child) => child.getBoundingClientRect().left - rowLeft + el.scrollLeft,
  );
}

/**
 * 손을 뗀 뒤 붙을 칸을 고른다.
 *
 * 가장 가까운 칸으로 붙이면 반 넘게 끌어야 다음 칸으로 넘어간다. 넘기려고 미는
 * 사람에게는 그것이 "안 넘어간다"로 읽힌다. 그래서 두 가지를 함께 본다.
 *
 *   - 방향: 조금이라도 그쪽으로 끌었으면 그쪽 칸으로 넘긴다. 반을 넘길 필요가 없다.
 *   - 속도: 빠르게 튕기면 그 속도로 더 미끄러진 자리를 셈해, 여러 칸을 건너뛴다.
 *
 * 살짝 흔들린 것까지 넘기지는 않는다. 끈 거리가 MIN_TRAVEL보다 짧고 속도도 없으면
 * 원래 서 있던 칸에 그대로 둔다.
 */
const MIN_TRAVEL = 8;

/** 속도를 거리로 바꿀 때 곱하는 시간(ms). 튕긴 뒤 미끄러지는 거리다. */
const MOMENTUM_MS = 220;

function indexOfNearest(starts: number[], position: number): number {
  let best = 0;
  for (let i = 1; i < starts.length; i += 1) {
    if (Math.abs(starts[i] - position) < Math.abs(starts[best] - position)) best = i;
  }
  return best;
}

export function flickTarget(options: {
  /** 칸마다의 시작 좌표 */
  starts: number[];
  /** 끌기 시작할 때 서 있던 자리 */
  from: number;
  /** 손을 뗀 자리 */
  current: number;
  /** 손을 뗄 때의 스크롤 속도(px/ms). 오른쪽으로 넘기는 중이면 양수 */
  velocity: number;
  /** 더 갈 수 없는 자리 */
  maxScroll: number;
}): number {
  const { starts, from, current, velocity, maxScroll } = options;
  if (starts.length === 0) return current;

  const traveled = current - from;
  const direction = traveled !== 0 ? Math.sign(traveled) : Math.sign(velocity);
  const startIndex = indexOfNearest(starts, from);

  // 미끄러진 끝자리를 셈해 거기서 가장 가까운 칸을 고른다. 빠를수록 멀리 간다.
  const projected = current + velocity * MOMENTUM_MS;
  let index = indexOfNearest(starts, projected);

  // 그 셈이 제자리를 가리켜도, 그쪽으로 끌었다면 한 칸은 넘긴다.
  if (index === startIndex && direction !== 0 && Math.abs(traveled) >= MIN_TRAVEL) {
    index = startIndex + direction;
  }

  index = Math.min(Math.max(index, 0), starts.length - 1);

  return Math.min(starts[index], Math.max(0, maxScroll));
}
