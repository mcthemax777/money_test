import { useEffect, useState } from 'react';
import { cachedInstitutions, fetchInstitutions } from '@money/core/lib/institutions';
import { useProject } from '@money/core/store/project';
import type { FinancialInstitutionType, Institution } from '@money/core/lib/types';
import { activeLocale, translate } from '@money/core/lib/i18n';

/**
 * 은행/카드사 목록을 불러온다.
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
