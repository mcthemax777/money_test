import { useEffect, useState } from 'react';
import Animated, { FadeIn } from 'react-native-reanimated';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';

import { useShowAds } from '@money/core/lib/ads';
import { useConnectivity } from '@money/core/store/connectivity';

import { AD_UNITS, initAds, useAdConsent } from '../ads';

/**
 * 하단 배너. 탭 막대 바로 위에 붙는다.
 *
 * 무료 가계부를 볼 때만, 그리고 광고 동의를 받은 뒤에만 선다(AdsSetup 이 묻는다). 끊겨 있으면 받을 수 없으므로 자리도 비운다 -- 빈 칸을
 * 남기면 본문만 그만큼 줄어든다. 받기에 실패해도(채울 광고가 없다) 같은 까닭으로 접고,
 * 다시 연결되면 한 번 더 받는다.
 *
 * 처음 받은 배너는 옅은 데서 떠오른다. 본문이 갑자기 밀려 올라가는 것보다 덜 거슬린다.
 */
export default function AdBanner() {
  const showAds = useShowAds();
  const isOffline = useConnectivity((state) => state.isOffline);
  const canRequestAds = useAdConsent((state) => state.canRequestAds);
  const [failed, setFailed] = useState(false);
  /** SDK 를 깨운 뒤에 배너를 그린다. 깨우기 전에 그리면 첫 요청이 버려질 수 있다. */
  const [sdkReady, setSdkReady] = useState(false);
  const [loaded, setLoaded] = useState(false);

  /* 다시 연결되면 실패한 것을 잊고 새로 받는다. */
  useEffect(() => {
    if (!isOffline) setFailed(false);
  }, [isOffline]);

  useEffect(() => {
    if (!showAds || !canRequestAds) return;
    let cancelled = false;
    initAds().then(
      () => {
        if (!cancelled) setSdkReady(true);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [showAds, canRequestAds]);

  const unitId = AD_UNITS.banner;
  if (!showAds || !canRequestAds || !sdkReady || isOffline || failed || !unitId) return null;

  return (
    <Animated.View
      key={loaded ? 'shown' : 'loading'}
      entering={loaded ? FadeIn.duration(180) : undefined}
      style={loaded ? undefined : { height: 0, overflow: 'hidden' }}
      className="items-center border-t border-gray-200 bg-white"
    >
      <BannerAd
        unitId={unitId}
        size={BannerAdSize.LARGE_ANCHORED_ADAPTIVE_BANNER}
        onAdLoaded={() => setLoaded(true)}
        onAdFailedToLoad={() => {
          setLoaded(false);
          setFailed(true);
        }}
      />
    </Animated.View>
  );
}
