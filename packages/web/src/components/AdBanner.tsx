'use client';

import { useEffect, useRef } from 'react';
import { useShowAds } from '@money/core/lib/ads';

/**
 * 웹의 하단 배너(AdSense). 앱의 AdBanner 와 같은 규칙이다 -- 무료 가계부를 볼 때만 선다.
 *
 * 웹에는 전면광고가 없다. AdSense 는 코드가 원하는 때에 띄우는 전면광고를 주지 않는다.
 *
 * 게시자 id 와 광고 단위(slot)는 빌드 때 환경 변수로 받는다:
 *   NEXT_PUBLIC_ADSENSE_CLIENT       ca-pub-로 시작하는 게시자 id
 *   NEXT_PUBLIC_ADSENSE_BANNER_SLOT  배너 광고 단위 번호
 * 둘 중 하나라도 없으면 광고를 받지 않는다. 개발 서버에서는 대신 자리 표시만 그려 화면에서
 * 배너가 차지할 칸을 볼 수 있게 한다.
 */
const CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT ?? '';
const SLOT = process.env.NEXT_PUBLIC_ADSENSE_BANNER_SLOT ?? '';
const CONFIGURED = Boolean(CLIENT && SLOT);
const PLACEHOLDER = !CONFIGURED && process.env.NODE_ENV === 'development';

/** 배너 칸의 높이. 본문이 그만큼 비켜 준다(AdBannerSpacer). */
const HEIGHT = 'h-[60px] md:h-[90px]';

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/** 배너를 그리는가. 칸을 비켜 줄지도 이것으로 정한다. */
function useBannerVisible(): boolean {
  const showAds = useShowAds();
  return showAds && (CONFIGURED || PLACEHOLDER);
}

/**
 * AdSense 스크립트를 한 번만 붙인다. 붙이기 전에 쌓아 둔 요청은 스크립트가 와서 처리한다.
 */
function loadAdSenseScript(): void {
  const id = 'adsbygoogle-script';
  if (document.getElementById(id)) return;
  const script = document.createElement('script');
  script.id = id;
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(CLIENT)}`;
  document.head.appendChild(script);
}

/**
 * 화면 아래에 붙박인 배너. 좁은 화면에서는 아래 탭 바로 위, 넓은 화면에서는 사이드바 옆
 * 맨 아래다.
 */
export default function AdBanner() {
  const visible = useBannerVisible();
  const slotRef = useRef<HTMLModElement>(null);

  useEffect(() => {
    if (!visible || !CONFIGURED || !slotRef.current) return;
    loadAdSenseScript();
    try {
      // 이 칸에 광고 하나를 채워 달라는 요청. 칸이 새로 생길 때마다 한 번이다.
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // 광고 차단기 따위로 막혔다. 빈 칸으로 둔다 -- 광고 때문에 가계부가 멈춰서는 안 된다.
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className={`unfold fixed inset-x-0 z-30 flex items-center justify-center overflow-hidden border-t border-gray-200 bg-white md:left-64 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] md:bottom-0 ${HEIGHT}`}
    >
      {CONFIGURED ? (
        <ins
          ref={slotRef}
          className="adsbygoogle block h-full w-full"
          data-ad-client={CLIENT}
          data-ad-slot={SLOT}
          data-ad-format="horizontal"
          data-full-width-responsive="true"
        />
      ) : (
        <span className="text-xs text-gray-400">광고 자리 (NEXT_PUBLIC_ADSENSE_* 미설정)</span>
      )}
    </div>
  );
}

/** 본문 끝에 두어 배너가 마지막 줄을 가리지 않게 비켜 준다. */
export function AdBannerSpacer() {
  const visible = useBannerVisible();
  return visible ? <div aria-hidden className={HEIGHT} /> : null;
}
