'use client';

import AnalysisView from '@/components/AnalysisView';
import { useProjectGuard } from '@/hooks/useProjectGuard';

/**
 * 분석 화면. 본문은 `AnalysisView` 가 들고 있다. 거래 화면과 같이 이 자리는 프로젝트를 고른
 * 상태로 시작하게 만드는 일만 한다.
 */
export default function AnalysisPage() {
  const selectedProjectId = useProjectGuard();

  return <AnalysisView projectId={selectedProjectId} />;
}
