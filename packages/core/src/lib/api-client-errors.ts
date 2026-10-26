/**
 * API 클라이언트가 가르는 실패의 종류.
 *
 * 세션이 정말 끝났는가, 강제 업데이트로 막혔는가를 응답 모양으로 가른다. 인터셉터와 동기화·로그인
 * 화면이 같은 답을 내야 해서 한 곳에 둔다. 바깥에서는 `api-client` 로 가져다 쓴다.
 */

import type { AxiosError } from 'axios';

import { isOfflineError } from './offline-error';

/**
 * 서버가 강제 업데이트로 거절했는가 (426 · APP_UPDATE_REQUIRED).
 *
 * 다시 보내도 같은 답이다. 부르는 쪽은 재시도하지 말고, 세션도 끊지 않는다.
 */
export function isUpdateRequiredError(error: unknown): boolean {
  const response = (error as AxiosError | undefined)?.response;
  const code = (response?.data as { error?: { code?: string } } | undefined)?.error?.code;
  return response?.status === 426 && code === 'APP_UPDATE_REQUIRED';
}

/** 갱신 응답이 돌아오기 전에 로그아웃·다른 로그인이 있었다. 돌아온 토큰은 버린다. */
export class SessionChangedError extends Error {
  constructor() {
    super('Session changed during refresh');
    this.name = 'SessionChangedError';
  }
}

/**
 * 세션이 정말 끝났는가 -- 토큰을 지울 일인가 (2026-10-16).
 *
 * 서버가 **401 로 거절한 것만** 끝난 것이다. 5xx·429·426·404 는 서버가 잠시 앓거나 막은 것이지
 * 토큰이 죽었다는 뜻이 아니다. 그것까지 로그아웃으로 다루면 DB 가 잠깐 흔들리거나, 같은 공인 IP
 * 를 쓰는 가족이 함께 갱신해 상한(429)에 걸리거나, 강제 업데이트가 뜨는 순간 모두가 로그인 화면으로
 * 밀려나고 올리지 못한 입력까지 버려진다.
 *
 * 응답이 없는 실패 중 오프라인이 아닌 것("No refresh token" 처럼 기기 안에서 난 것)은 끝난 것으로 본다.
 */
export function isSessionEnded(error: unknown): boolean {
  // 갱신하는 사이 다른 세션이 들어섰다. 지우면 그 새 세션을 지운다.
  if (error instanceof SessionChangedError) return false;
  const status = (error as AxiosError | undefined)?.response?.status;
  if (status !== undefined) return status === 401;
  return !isOfflineError(error);
}
