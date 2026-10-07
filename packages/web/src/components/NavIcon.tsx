'use client';

import { ChartPie, Landmark, PiggyBank, ReceiptText, Settings } from 'lucide-react';

import type { NavIconName } from '@money/core/lib/nav';

/**
 * 메뉴 그림. 이름을 그림으로 바꾼다.
 *
 * 메뉴 자체(무엇이 있고 어디로 가는지)는 core 가 정하고, 그림은 화면마다 다른
 * 꾸러미를 쓰므로 여기서 고른다. 앱에도 같은 이름을 받는 짝이 있다.
 */
const ICONS = {
  budget: PiggyBank,
  /*
   * 거래는 적어 둔 내역을 훑는 자리다. 종이에 줄이 적힌 그림으로 둔다 (2026-10-07 사용자 요청,
   * 그 전엔 오가는 화살표). 분석 탭의 거래내역 단추도 이 그림을 쓴다 -- 같은 곳으로 가는 길이다.
   */
  transactions: ReceiptText,
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
