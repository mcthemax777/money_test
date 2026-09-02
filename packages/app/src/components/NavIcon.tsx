import { ArrowLeftRight, BookOpen, House, Landmark, Settings, Tags } from 'lucide-react-native';

import type { NavIconName } from '@money/core/lib/nav';

/**
 * 메뉴 그림. 이름을 그림으로 바꾼다.
 *
 * 메뉴 자체(무엇이 있고 어디로 가는지)는 core 가 정하고, 그림은 웹과 앱이 서로 다른
 * 꾸러미를 쓰므로 여기서 고른다. 웹에도 같은 이름을 받는 짝이 있다.
 */
const ICONS = {
  home: House,
  // 거래는 오간 돈을 훑는 자리다. 장부(BookOpen)와 갈라 보이도록 오가는 화살표로 둔다.
  transactions: ArrowLeftRight,
  // 가계는 장부다. 자산(Landmark)과 갈라 보이도록 펼친 책으로 둔다.
  ledger: BookOpen,
  assets: Landmark,
  categories: Tags,
  settings: Settings,
} as const;

export default function NavIcon({
  name,
  color,
  size = 20,
  strokeWidth,
}: {
  name: NavIconName;
  color: string;
  size?: number;
  strokeWidth?: number;
}) {
  const Icon = ICONS[name];
  return <Icon color={color} size={size} strokeWidth={strokeWidth} />;
}
