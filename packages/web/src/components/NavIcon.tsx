'use client';

import { BookOpen, House, Landmark, Settings, Tags } from 'lucide-react';

import type { NavIconName } from '@money/core/lib/nav';

/**
 * 메뉴 그림. 이름을 그림으로 바꾼다.
 *
 * 메뉴 자체(무엇이 있고 어디로 가는지)는 core 가 정하고, 그림은 화면마다 다른
 * 꾸러미를 쓰므로 여기서 고른다. 앱에도 같은 이름을 받는 짝이 있다.
 */
const ICONS = {
  home: House,
  // 가계는 장부다. 자산(Landmark)과 갈라 보이도록 펼친 책으로 둔다.
  ledger: BookOpen,
  assets: Landmark,
  categories: Tags,
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
