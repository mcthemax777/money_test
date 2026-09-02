/**
 * 서버에 닿지 못한 것인가.
 *
 * "서버가 거절했다"와 "서버에 닿지 못했다"는 다르게 다뤄야 한다. 앞의 것은 세션을
 * 정리할 일이고, 뒤의 것은 잠시 뒤 다시 시도할 일이다. 이 둘을 섞으면 비행기 모드로
 * 앱을 열 때마다 로그아웃되고, 그 사이 사본에 담아 둔 것도 함께 버려진다.
 *
 * axios 는 응답을 받지 못하면 `response` 를 비워 둔다. 상태 코드가 있는 거절
 * (401, 403)은 오프라인이 아니다.
 */
export function isOfflineError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const candidate = error as { response?: unknown; code?: string; message?: string };
  if (candidate.response) return false;

  const code = candidate.code ?? '';
  if (['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND'].includes(code)) {
    return true;
  }
  return /network|timeout|failed to fetch/i.test(candidate.message ?? '');
}
