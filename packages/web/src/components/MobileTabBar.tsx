'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import NavIcon from '@/components/NavIcon';
import { useTranslation } from '@money/core/lib/i18n';
import { useNavPending } from '@/hooks/useNavPending';
import { isActiveNav, navItemsOf } from '@money/core/lib/nav';
import { useProject } from '@money/core/store/project';

/**
 * 좁은 화면의 아래쪽 탭.
 *
 * 사이드바의 메뉴를 그대로 아래로 옮긴 것이다. 한 손으로 드는 화면에서는 위쪽
 * 구석보다 엄지가 닿는 아래가 누르기 쉽고, 화면을 덮는 서랍과 달리 지금 어디에
 * 있는지가 늘 보인다.
 */
export default function MobileTabBar() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const { projects } = useProject();
  const { pendingHref, start } = useNavPending();
  const items = navItemsOf(projects.length > 0);

  return (
    /*
      아래 여백(safe-area)은 아이폰의 홈 표시줄 자리다. 그만큼 띄우지 않으면
      마지막 칸이 그 막대에 깔려 눌리지 않는다. AppShell이 본문에 비켜 주는
      높이도 같은 식으로 맞춰 두었다.
    */
    <nav className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)]">
      <ul className="flex h-14 items-stretch gap-1 px-2 py-1.5">
        {items.map((item) => {
          const pending = pendingHref === item.href;
          // 누르는 즉시 켠다. 다음 화면이 뜨기 전에는 이 표시가 유일한 대답이다.
          const active = pending || isActiveNav(pathname, item.href);
          return (
            <li key={item.href} className="flex-1">
              {/*
                고른 칸은 옅은 파란 알약이다. 사이드바 메뉴·분류 목록·예산 줄이
                전부 같은 표시(bg-blue-50 + text-blue-600 + rounded-lg)를 쓴다.
                글자 색만 바꾸면 좁은 화면에서 어디에 있는지 눈에 잘 띄지 않는다.
              */}
              <Link
                href={item.href}
                onClick={() => start(item.href)}
                aria-current={active ? 'page' : undefined}
                className={`flex h-full flex-col items-center justify-center gap-1 rounded-lg transition ${
                  active ? 'bg-blue-50 font-medium text-blue-600' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {/*
                  그림은 글자 색을 따른다. 고른 칸이 한 덩이로 보여야 한다.
                  받는 중에는 그 자리에 도는 원을 둔다. 색만 바뀌면 이미 그 화면인
                  것인지 아직 오는 중인지 갈리지 않는다.
                */}
                {pending ? (
                  <span
                    className="h-5 w-5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600"
                    aria-hidden
                  />
                ) : (
                  <NavIcon name={item.icon} className="h-5 w-5" strokeWidth={active ? 2.25 : 1.75} />
                )}
                <span className="text-[11px] leading-none">{t(item.labelKey)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
