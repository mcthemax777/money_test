'use client';

import TransactionsView from '@/components/TransactionsView';
import { useProjectGuard } from '@/hooks/useProjectGuard';

/**
 * 거래 화면.
 *
 * 본문은 전부 `TransactionsView` 가 들고 있다. 분류·태그 화면도 상세에서 "거래내역
 * 보기"를 누르면 제 자리에서 같은 것을 그리므로, 화면 하나에 묶어 두면 두 자리의
 * 거래 목록이 갈린다.
 *
 * 이 자리가 하는 일은 프로젝트를 고른 상태로 시작하게 만드는 것뿐이다. 돌아갈 곳은
 * 없다 -- 메뉴에 있는 화면이라 ← 를 세우지 않는다.
 */
export default function TransactionsPage() {
  const selectedProjectId = useProjectGuard();

  return <TransactionsView projectId={selectedProjectId} />;
}
