import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { useProject } from '@/store/project';
import type { FinancialInstitutionType, Institution } from '@/lib/types';
import { activeLocale, translate } from '@/lib/i18n';

/**
 * 불러온 목록을 (용도, 프로젝트)별로 기억해 둔다.
 *
 * 한 화면에 이 훅을 쓰는 폼이 여러 개 올라간다. 자산 페이지만 해도 페이지 자체와
 * 계좌 추가/계좌 수정/카드 수정 모달이 각자 같은 목록을 필요로 해서,
 * 캐시가 없으면 열지도 않은 모달들 때문에 같은 요청이 다섯 번 나간다.
 *
 * 값은 기본 제공 항목이 대부분이라 한 세션 안에서 바뀌지 않는다고 보고 무기한 보관한다.
 * 프로젝트 전용 항목을 추가하는 화면이 생기면 그곳에서 invalidate를 불러야 한다.
 */
const cache = new Map<string, Institution[]>();
/** 같은 키로 동시에 들어온 요청을 하나로 합친다. */
const inFlight = new Map<string, Promise<Institution[]>>();
/**
 * invalidate 시점을 세는 값.
 *
 * 요청이 날아가 있는 동안 invalidate가 일어나면, 뒤늦게 도착한 응답은 이미 낡은 목록이다.
 * 그것을 캐시에 쓰면 다시 비울 방법이 없으므로 출발 시점의 세대와 비교해 버린다.
 */
let generation = 0;

function cacheKey(type: FinancialInstitutionType, projectId: string | null) {
  return `${type}:${projectId ?? 'default'}`;
}

function fetchInstitutions(
  type: FinancialInstitutionType,
  projectId: string | null,
): Promise<Institution[]> {
  const key = cacheKey(type, projectId);

  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);

  const pending = inFlight.get(key);
  if (pending) return pending;

  const startedAt = generation;
  const request = apiClient
    .getInstitutions(type, projectId)
    .then((data) => {
      const rows = data || [];
      // 출발한 뒤 invalidate가 있었다면 이 응답은 낡은 것이다. 캐시에 쓰지 않는다.
      if (startedAt === generation) cache.set(key, rows);
      return rows;
    })
    .finally(() => {
      // 실패한 요청은 캐시에 남기지 않는다. 다음 시도에서 다시 나가야 한다.
      if (inFlight.get(key) === request) inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}

/** 기관 목록이 바뀐 뒤 다시 불러오게 한다. type을 주면 그 용도만 비운다. */
export function invalidateInstitutions(type?: FinancialInstitutionType) {
  // 날아가 있는 요청의 응답이 낡은 목록을 되살리지 못하게 세대를 올린다.
  generation += 1;

  const matches = (key: string) => !type || key.startsWith(`${type}:`);
  for (const key of [...cache.keys()]) {
    if (matches(key)) cache.delete(key);
  }
  // 합쳐 둔 요청도 버린다. 남겨 두면 invalidate 직후의 호출이 낡은 promise를 받는다.
  for (const key of [...inFlight.keys()]) {
    if (matches(key)) inFlight.delete(key);
  }
}

/**
 * 은행/카드사 목록을 불러온다.
 * `options`는 CustomSelect가 그대로 받을 수 있는 모양이다.
 */
export function useInstitutions(type: FinancialInstitutionType) {
  const { selectedProjectId } = useProject();
  const [institutions, setInstitutions] = useState<Institution[]>(
    () => cache.get(cacheKey(type, selectedProjectId)) ?? [],
  );
  const [isLoading, setIsLoading] = useState(
    () => !cache.has(cacheKey(type, selectedProjectId)),
  );
  const [error, setError] = useState('');

  useEffect(() => {
    // 프로젝트를 바꾸면 그 프로젝트가 추가한 항목이 달라지므로 다시 불러온다.
    let cancelled = false;

    const load = async () => {
      try {
        setIsLoading(true);
        setError('');
        const data = await fetchInstitutions(type, selectedProjectId);
        if (!cancelled) setInstitutions(data);
      } catch {
        // 목록을 못 불러와도 폼 자체는 열려 있어야 한다. 빈 목록 + 안내로 둔다.
        if (!cancelled) {
          setInstitutions([]);
          setError(translate(activeLocale(), 'institutions.loadFailed'));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [type, selectedProjectId]);

  return {
    institutions,
    options: institutions.map((i) => ({ id: i.id, name: i.name, icon: i.iconPath || undefined })),
    isLoading,
    error,
  };
}
