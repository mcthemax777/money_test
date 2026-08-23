import { useEffect, useState } from 'react';
import type { CurrencyCode, ExchangeRateInfo } from '@money/types';
import { apiClient } from '@/lib/api-client';
import { useProject } from '@/store/project';

/**
 * 저장 통화 기준 환율.
 *
 * 거래 입력 폼이 "이 금액이 얼마로 기록되는지"를 미리 보여 주는 데 쓴다.
 * 설정에서 정한 값이 없는 통화는 서버가 들고 있는 고정값이 내려오며
 * `source`가 'fallback'이다.
 *
 * 프로젝트마다 저장 통화가 다를 수 있어 프로젝트를 키로 캐시한다.
 */
const cache = new Map<string, ExchangeRateInfo[]>();

/**
 * 캐시를 버린다. 설정에서 환율을 바꾸거나 되돌린 뒤에 부른다.
 *
 * 이 캐시는 만료가 없어서, 버리지 않으면 화면을 새로 고칠 때까지 예전 값이
 * 계속 보인다. 저장은 새 환율로 되는데 폼에 적힌 환율만 옛 값이라 더 헷갈린다.
 */
export function clearExchangeRateCache() {
  cache.clear();
}

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
