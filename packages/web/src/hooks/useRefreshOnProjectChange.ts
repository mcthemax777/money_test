import { useEffect } from 'react';
import { useProject } from '@/store/project';

export function useRefreshOnProjectChange(callback: () => void) {
  const { selectedProjectId } = useProject();

  useEffect(() => {
    callback();
  }, [selectedProjectId]);
}
