/**
 * 환율 행이 없을 때 쓰는 값.
 *
 * 사용자가 환율을 넣지 않은 프로젝트에서도 외화 계좌의 원화 값을 보여 줘야 한다. 이 표는
 * 변경 피드로 나가는 데이터가 아니라 **코드에 박힌 상수**라, 서버와 기기가 같은 값을 보려면
 * 양쪽이 의존하는 곳에 한 벌만 두는 수밖에 없다.
 *
 * 이 값이 없으면 오프라인 순자산에서 외화 계좌가 1:1 로 세어진다. 100달러가 100원이 되어
 * 총자산이 조용히 어긋난다 (실제로 그랬다).
 */
export const FALLBACK_RATES: Record<string, string> = {
  'USD:KRW': '1380',
  'JPY:KRW': '9.2',
  'USD:JPY': '150',
};

/**
 * 고정값 표에서 환율을 찾는다. 뒤집힌 쌍이면 역수를 만든다.
 *
 * 모르는 쌍이면 null 이다. 1 로 눙치지 않는다 -- 부르는 쪽이 "모른다"와 "1 이다"를
 * 가려서 다뤄야 한다.
 */
export function fallbackRate(from: string, to: string): string | null {
  if (from === to) return '1';

  const direct = FALLBACK_RATES[`${from}:${to}`];
  if (direct) return direct;

  const inverse = FALLBACK_RATES[`${to}:${from}`];
  if (!inverse) return null;

  const value = Number(inverse);
  if (!Number.isFinite(value) || value === 0) return null;
  return String(Number((1 / value).toFixed(8)));
}
