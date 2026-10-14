'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import CountBadge from '@/components/CountBadge';
import NavIcon from '@/components/NavIcon';
import { useTranslation } from '@money/core/lib/i18n';
import { useNavPending } from '@/hooks/useNavPending';
import { isActiveNav, navItemsOf } from '@money/core/lib/nav';
import { useInboxCount } from '@money/core/store/inbox-count';
import { useInquiryUnread } from '@money/core/store/inquiry-unread';
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
  /*
   * 칸의 빨간 수. 거래는 보관함에 기다리는 후보, 설정은 읽지 않은 문의 답이다. (앱의 설정 칸은
   * 보내지 못한 거래도 더한다 -- 웹은 기기 사본이 없어 보내지 못한 거래가 생기지 않는다.)
   */
  const inboxBadge = useInboxCount(useProject((state) => state.selectedProjectId));
  const inquiryBadge = useInquiryUnread((state) => state.count);
  const badges: Record<string, number> = { '/transactions': inboxBadge, '/settings': inquiryBadge };
  /** 알약이 설 칸. 누르는 즉시 그 칸으로 미끄러진다 (2026-10-15 사용자 요청, 앱과 같다). */
  const activeIndex = items.findIndex(
    (item) => pendingHref === item.href || (!pendingHref && isActiveNav(pathname, item.href)),
  );

  return (
    /*
      아래 여백(safe-area)은 아이폰의 홈 표시줄 자리다. 그만큼 띄우지 않으면
      마지막 칸이 그 막대에 깔려 눌리지 않는다. AppShell이 본문에 비켜 주는
      높이도 같은 식으로 맞춰 두었다.
    */
    <nav className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)]">
      <ul className="relative flex h-14 items-stretch gap-1 px-2 py-1.5">
        {/*
          고른 칸의 옅은 파란 알약. 칸마다 칠하지 않고 하나를 두어 칸 사이를 미끄러진다. 폭은 칸 하나
          (gap-1·px-2 를 뺀 몫), 자리는 제 폭 + 간격씩 옮긴다.
        */}
        {activeIndex >= 0 && (
          <li
            aria-hidden
            className="pointer-events-none absolute bottom-1.5 left-2 top-1.5 rounded-lg bg-blue-50 transition-transform duration-300 ease-out"
            style={{
              width: `calc((100% - 16px - ${4 * (items.length - 1)}px) / ${items.length})`,
              transform: `translateX(calc(${activeIndex} * (100% + 4px)))`,
            }}
          />
        )}
        {items.map((item) => {
          const pending = pendingHref === item.href;
          // 누르는 즉시 켠다. 다음 화면이 뜨기 전에는 이 표시가 유일한 대답이다.
          const active = pending || isActiveNav(pathname, item.href);
          return (
            <li key={item.href} className="relative flex-1">
              {/*
                고른 칸은 옅은 파란 알약이다. 사이드바 메뉴·분류 목록·예산 줄이
                전부 같은 표시(bg-blue-50 + text-blue-600 + rounded-lg)를 쓴다.
                글자 색만 바꾸면 좁은 화면에서 어디에 있는지 눈에 잘 띄지 않는다.
              */}
              <Link
                href={item.href}
                onClick={() => start(item.href)}
                aria-current={active ? 'page' : undefined}
                className={`group flex h-full flex-col items-center justify-center gap-1 rounded-lg transition ${
                  active ? 'font-medium text-blue-600' : 'text-gray-600 hover:bg-gray-50'
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
                  /* 누르는 동안 살짝 줄었다가 놓으면 돌아온다. */
                  <span className="relative transition-transform duration-150 group-active:scale-90">
                    <NavIcon name={item.icon} className="h-5 w-5" strokeWidth={active ? 2.25 : 1.75} />
                    <CountBadge count={badges[item.href] ?? 0} />
                  </span>
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
