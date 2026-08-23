import { useEffect, useState } from 'react';
import type { CurrencyCode, ExchangeRateInfo } from '@money/types';
import { apiClient } from '@/lib/api-client';
import { useProject } from '@/store/project';

/**
 * 기준통화 기준 환율.
 *
 * 거래 입력 폼이 통화를 고르는 순간 환율 칸을 채우는 데 쓴다. 사용자가 그 값을
 * 고쳐도 여기 담긴 값은 바뀌지 않는다(폼이 자기 상태로 들고 간다). 서버가 아직
 * 외부 API에서 가져오지 않은 통화는 고정값이 내려오며 `source`가 'fallback'이다.
 *
 * 프로젝트마다 기준통화가 다를 수 있어 프로젝트를 키로 캐시한다.
 */
const cache = new Map<string, ExchangeRateInfo[]>();

export function useExchangeRates() {
  const { selectedProjectId } = useProject();
  const key = selectedProjectId ?? 'default';
  const [rates, setRates] = useState<ExchangeRateInfo[]>(() => cache.get(key) ?? []);

  useEffect(() => {
    let cancelled = false;

    const cached = cache.get(key);
    if (cached) {
      setRates(cached);
      return;
    }

    apiClient
      .getExchangeRates(selectedProjectId)
      .then((res) => {
        cache.set(key, res.rates ?? []);
        if (!cancelled) setRates(res.rates ?? []);
      })
      .catch(() => {
        // 환율을 못 받아도 폼은 열려 있어야 한다. 사용자가 직접 넣으면 된다.
        if (!cancelled) setRates([]);
      });

    return () => {
      cancelled = true;
    };
  }, [key, selectedProjectId]);

  /** 1 currency = ? 기준통화. 모르는 통화는 빈 문자열(= 사용자가 직접 입력). */
  const rateOf = (currency: CurrencyCode): string =>
    rates.find((r) => r.from === currency)?.rate ?? '';

  return { rates, rateOf };
}
