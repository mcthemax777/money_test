/**
 * 가로로 끌어 기간을 넘기는 손짓의 판정. 웹(포인터)과 앱(PanResponder)이 함께 쓴다.
 *
 * 각자 문턱을 두면 한쪽만 고쳤을 때 같은 손이 웹에서는 넘어가고 앱에서는 안 넘어간다.
 * 거리는 px, 속도는 px/ms 다 (앱 PanResponder 의 vx 와 같은 단위).
 */

/** 이만큼(px) 가로로 움직이기 전에는 손을 가져오지 않는다. 단추를 누른 손이 삼켜지지 않게 한다. */
export const PERIOD_SWIPE_CLAIM = 12;

/**
 * 가로가 세로의 몇 배를 넘어야 "가로로 끈다"로 보는지.
 *
 * 1 이면 비스듬히 훑어 내리던 손도 기간 넘기기로 잡혀, 화면을 내리다 달이 바뀐다.
 * 확실히 옆으로 민 손만 가져온다.
 */
export const PERIOD_SWIPE_RATIO = 2;

/** 이만큼(px) 넘게 끌었으면 손을 뗄 때 넘긴다. */
export const PERIOD_SWIPE_COMMIT = 64;

/** 짧게 튕겨도 넘기는 속도(px/ms). 이때도 손을 가져온 거리(CLAIM)만큼은 움직였어야 한다. */
export const PERIOD_SWIPE_FLICK = 0.5;

/** 끄는 동안 내용이 손을 따라가는 비율. 1 이면 손에 붙어 다녀 넘길지 말지가 흐려진다. */
export const PERIOD_SWIPE_FOLLOW = 0.4;

/** 넘긴 뒤 새 기간이 옆에서 들어오는 거리(px)와 시간(ms). */
export const PERIOD_SWIPE_SLIDE = 48;
export const PERIOD_SWIPE_MS = 180;

/** 이 손을 기간 넘기기로 가져올지. 가로가 세로보다 확실히 클 때만 참이다. */
export function claimsPeriodSwipe(dx: number, dy: number): boolean {
  return Math.abs(dx) > PERIOD_SWIPE_CLAIM && Math.abs(dx) > Math.abs(dy) * PERIOD_SWIPE_RATIO;
}

/**
 * 손을 뗄 때 기간을 몇 칸 옮길지. 0 이면 넘기지 않고 제자리로 돌아간다.
 *
 * 왼쪽으로 밀면(dx < 0) 다음 기간(+1), 오른쪽으로 밀면 지난 기간(-1)이다. 종이를 넘기는
 * 방향이고, 자산 추이 그래프의 끌기(오른쪽으로 끌면 지난 날짜)와도 같다.
 */
export function periodSwipeStep(dx: number, vx: number): -1 | 0 | 1 {
  const fast = Math.abs(vx) > PERIOD_SWIPE_FLICK;
  // 멀리 끌었어도 반대로 튕기며 놓았으면(되돌리다 놓은 손) 넘기지 않는다.
  if (fast && Math.sign(vx) !== Math.sign(dx)) return 0;
  const far = Math.abs(dx) > PERIOD_SWIPE_COMMIT;
  const flicked = fast && Math.abs(dx) > PERIOD_SWIPE_CLAIM;
  if (!far && !flicked) return 0;
  return dx < 0 ? 1 : -1;
}
