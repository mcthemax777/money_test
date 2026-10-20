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
import type { CurrencyCode, ExchangeRateInfo } from './currency';
import { Dec, type DecInput } from './decimal';

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

/** 한 통화쌍의 가장 최근 값. 저장소(서버는 Prisma, 기기는 사본)에서 읽어 넘긴다. */
export interface StoredRate {
  rate: DecInput;
  /** "YYYY-MM-DD" */
  date: string;
  source: string;
}

/**
 * 통화쌍 하나의 환율. 서버 `ExchangeRatesService.getRate` 와 기기 사본이 함께 쓰는 차례다.
 *
 *   1. 그 쌍을 직접 정한 최신 값
 *   2. 반대 방향만 정해 두었으면 그 역수 (소수 여덟째 자리, 출처에 "(역수)")
 *   3. 고정값 표 (`fallbackRate`, 출처 'fallback')
 *
 * 셋 다 없으면 null 이다. 서버는 그때 오류를 주고, 기기는 서버에 맡긴다. 예전에는 두 곳에 같은
 * 차례를 따로 적어 두었고, 기기가 역수를 빠뜨려 총자산이 서버와 갈린 적이 있다(2026-10-16).
 */
export async function resolveRate(
  from: CurrencyCode,
  to: CurrencyCode,
  latest: (base: CurrencyCode, quote: CurrencyCode) => Promise<StoredRate | null>,
): Promise<ExchangeRateInfo | null> {
  if (from === to) return { from, to, rate: '1', source: 'identity' };

  const direct = await latest(from, to);
  if (direct) return { from, to, rate: Dec.of(direct.rate).toString(), date: direct.date, source: direct.source };

  const inverse = await latest(to, from);
  if (inverse && !Dec.of(inverse.rate).isZero()) {
    return {
      from,
      to,
      rate: Dec.of(1).dividedBy(inverse.rate, 8).toString(),
      date: inverse.date,
      source: `${inverse.source} (역수)`,
    };
  }

  const fallback = fallbackRate(from, to);
  return fallback ? { from, to, rate: fallback, source: 'fallback' } : null;
}
