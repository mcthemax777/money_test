import { useEffect, useRef, useState } from 'react';
import { cachedInstitutions, fetchInstitutions, invalidateInstitutions } from '../lib/institutions';
import { useMirrorVersion } from './useMirrorVersion';
import { useProject } from '../store/project';
import type { FinancialInstitutionType, Institution } from '../lib/types';
import { activeLocale, translate } from '../lib/i18n';

/**
 * 은행/카드사 목록을 불러온다. 웹과 앱이 함께 쓴다.
 * `options`는 CustomSelect가 그대로 받을 수 있는 모양이다.
 */
export function useInstitutions(type: FinancialInstitutionType) {
  const { selectedProjectId } = useProject();
  const [institutions, setInstitutions] = useState<Institution[]>(
    () => cachedInstitutions(type, selectedProjectId) ?? [],
  );
  const [isLoading, setIsLoading] = useState(
    () => cachedInstitutions(type, selectedProjectId) === undefined,
  );
  const [error, setError] = useState('');

  /*
   * 남이 기관을 추가한 것도 이 목록에 들어와야 한다.
   *
   * 기관은 기기 사본으로 내려오지 않고 여기 캐시에만 있다. 캐시는 만료가 없어서
   * (한 세션 동안 바뀌지 않는다고 보고 두었다) 버리지 않으면 앱을 껐다 켤 때까지
   * 옛 목록이 남는다. 신호가 오면 이 용도의 캐시만 버리고 다시 받는다.
   */
  const mirrorVersion = useMirrorVersion();
  const seenVersionRef = useRef(mirrorVersion);

  useEffect(() => {
    // 프로젝트를 바꾸면 그 프로젝트가 추가한 항목이 달라지므로 다시 불러온다.
    let cancelled = false;

    if (seenVersionRef.current !== mirrorVersion) {
      seenVersionRef.current = mirrorVersion;
      invalidateInstitutions(type);
    }

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
  }, [type, selectedProjectId, mirrorVersion]);

  return {
    institutions,
    options: institutions.map((i) => ({ id: i.id, name: i.name, icon: i.iconPath || undefined })),
    isLoading,
    error,
  };
}
