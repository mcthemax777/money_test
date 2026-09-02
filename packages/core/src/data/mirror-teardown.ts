/*
 * 기기 사본을 버리는 자리.
 *
 * 사본을 가진 것은 앱뿐인데(웹은 서버에서 바로 읽는다) 세션이 끝나고 시작하는 자리는
 * core 의 로그인 스토어에 있다. 그래서 core 는 "버려라"는 신호만 두고, 실제로 파일을
 * 지우는 일은 앱이 등록한다. 토큰 저장소(`auth-tokens`)와 홈 창구(`home-port`)를
 * 갈아 끼우는 방식과 같다.
 *
 * 언제 버리는가가 이 파일의 핵심이다.
 *
 *   - 사용자가 로그아웃을 눌렀을 때. 이 기기를 떠나겠다는 뜻이다.
 *   - 다른 사용자가 로그인했을 때. 앞 사람의 가계부가 남아 있으면 안 된다.
 *
 * 토큰이 만료되어 401 을 받은 것은 여기에 들지 않는다. 설계 문서 D10 이 짚은 대로
 * 오프라인의 실제 상한이 리프레시 수명(7일)이라, 401 마다 사본을 지우면 열흘 만에 앱을
 * 연 사람이 그 사이 자기가 적은 것까지 잃는다. 그 경우는 세션만 정리하고 사본은 둔다.
 */

/** 사본을 지우는 실제 동작. 앱이 시작할 때 등록한다. */
export type MirrorTeardown = () => Promise<void>;

let teardown: MirrorTeardown | null = null;

/**
 * 사본을 지우는 방법을 등록한다. null 을 주면 등록을 걷는다.
 *
 * 웹은 부르지 않는다. 사본이 없으므로 아래 `clearLocalMirror` 가 그냥 지나간다.
 */
export function setMirrorTeardown(fn: MirrorTeardown | null): void {
  teardown = fn;
}

/**
 * 사본을 버린다. 등록된 것이 없으면 아무 일도 하지 않는다.
 *
 * 실패해도 던지지 않는다. 이 함수를 부르는 곳은 세션을 정리하는 자리라, 여기서 예외가
 * 올라가면 토큰과 스토어 정리가 중간에 멈춘다. 지우지 못한 사본보다 반쯤 정리된
 * 세션이 더 나쁘다.
 */
export async function clearLocalMirror(): Promise<void> {
  if (!teardown) return;

  try {
    await teardown();
  } catch (error) {
    console.error('기기 사본을 버리지 못했습니다:', error);
  }
}
