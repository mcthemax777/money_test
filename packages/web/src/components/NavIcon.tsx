'use client';

import { ArrowLeftRight, ChartPie, Landmark, PiggyBank, Settings } from 'lucide-react';

import type { NavIconName } from '@money/core/lib/nav';

/**
 * 메뉴 그림. 이름을 그림으로 바꾼다.
 *
 * 메뉴 자체(무엇이 있고 어디로 가는지)는 core 가 정하고, 그림은 화면마다 다른
 * 꾸러미를 쓰므로 여기서 고른다. 앱에도 같은 이름을 받는 짝이 있다.
 */
const ICONS = {
  budget: PiggyBank,
  // 거래는 오간 돈을 훑는 자리다. 오가는 화살표로 둔다.
  transactions: ArrowLeftRight,
  // 분석은 원형 그래프로 둔다. 거래 탭 기간 줄의 분석 아이콘(막대)과 갈라 보인다.
  analysis: ChartPie,
  assets: Landmark,
  settings: Settings,
} as const;

export default function NavIcon({
  name,
  className,
  strokeWidth,
}: {
  name: NavIconName;
  className?: string;
  strokeWidth?: number;
}) {
  const Icon = ICONS[name];
  return <Icon className={className} strokeWidth={strokeWidth} aria-hidden />;
}
