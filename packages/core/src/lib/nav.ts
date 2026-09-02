/**
 * 화면 이동 메뉴.
 *
 * 넓은 화면의 사이드바와 좁은 화면의 하단 탭이 같은 목록을 쓴다. 두 곳에 따로
 * 적어 두면 메뉴를 하나 더할 때 한쪽만 고쳐져 화면 너비에 따라 갈 수 있는 곳이
 * 달라진다.
 */
import type { MessageKey } from '../lib/i18n';

/**
 * 메뉴에 세우는 그림의 이름.
 *
 * 그림 자체는 여기 두지 않는다. 웹은 lucide-react, 앱은 lucide-react-native 로
 * 서로 다른 컴포넌트를 쓰기 때문이다. 무엇을 그릴지만 정하고 고르는 일은 화면에 맡긴다.
 */
export type NavIconName =
  | 'home'
  | 'transactions'
  | 'ledger'
  | 'assets'
  | 'categories'
  | 'settings';

export interface NavItem {
  /**
   * 사전의 열쇠다. 이름 자체를 여기 적으면 언어를 바꿔도 메뉴만 한국어로 남는다.
   * 그리는 쪽(사이드바·아래 탭)이 t()로 꺼내 쓴다.
   */
  labelKey: MessageKey;
  href: string;
  /**
   * 하단 탭에 글자와 함께 세우는 그림.
   *
   * 글자만으로도 뜻은 통하지만, 다섯 칸이 나란히 선 줄에서는 모양이 먼저 눈에
   * 들어와 읽지 않고도 자리를 기억하게 된다. 사이드바는 한 줄에 하나씩이라
   * 쓰지 않는다.
   */
  icon: NavIconName;
}

/** 프로젝트가 있어야 뜻이 있는 메뉴. 프로젝트가 없으면 감춘다. */
const PROJECT_ITEMS: NavItem[] = [
  { labelKey: 'nav.home', href: '/home', icon: 'home' },
  /*
   * 거래는 훑어보는 자리다. 년월 -> 날짜·분류·수단 -> 거래로 파고든다.
   *
   * 가계 바로 앞에 둔다. 둘이 나란히 서 있는 것은 지금뿐이고, 가계가 들고 있는
   * 몇 가지를 거래로 옮긴 뒤에는 가계가 빠진다.
   */
  { labelKey: 'nav.transactions', href: '/transactions', icon: 'transactions' },
  // 가계는 장부다. 자산(Landmark)과 갈라 보이도록 펼친 책으로 둔다.
  { labelKey: 'nav.ledger', href: '/dashboard', icon: 'ledger' },
  { labelKey: 'nav.assets', href: '/assets', icon: 'assets' },
  { labelKey: 'nav.categories', href: '/categories', icon: 'categories' },
];

/** 프로젝트가 없어도 갈 수 있어야 하는 메뉴 (여기서 프로젝트를 만든다) */
const ALWAYS_ITEMS: NavItem[] = [{ labelKey: 'nav.settings', href: '/settings', icon: 'settings' }];

export function navItemsOf(hasProject: boolean): NavItem[] {
  return hasProject ? [...PROJECT_ITEMS, ...ALWAYS_ITEMS] : ALWAYS_ITEMS;
}

/**
 * 지금 보고 있는 화면인지.
 *
 * 설정만 하위 경로를 가려서 본다. 내 정보(/settings/profile)는 메뉴가 아니라
 * 따로 난 자리라, 그 화면에서 설정 메뉴까지 함께 켜지면 안 된다.
 */
export function isActiveNav(pathname: string, href: string): boolean {
  if (href === '/settings') {
    return pathname.startsWith('/settings') && !pathname.startsWith('/settings/profile');
  }
  if (href === '/assets') {
    return pathname === '/assets' || pathname === '/assets/';
  }
  return pathname === href;
}
