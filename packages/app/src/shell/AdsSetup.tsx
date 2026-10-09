/*
 * 광고 동의를 묻고, 동의를 받으면 SDK 를 깨워 전면광고를 받아 둔다. 화면을 그리지 않는다.
 *
 * 무료 가계부를 볼 때만 움직인다. 유료 가계부만 쓰는 사람에게는 동의 창도 뜨지 않고 SDK 도
 * 한 번도 돌지 않는다. 유료 가계부로 옮기거나 동의를 거두면 받아 둔 전면광고를 내려놓는다
 * (배너는 AdBanner 가 스스로 접는다).
 *
 * 차례는 Google 이 정한 대로다: 동의 → (요청해도 되면) SDK 깨우기 → 광고 요청.
 */
import { useEffect } from 'react';

import { useShowAds } from '@money/core/lib/ads';
import { useConnectivity } from '@money/core/store/connectivity';

import { AD_UNITS, gatherAdConsent, initAds, startInterstitials, useAdConsent } from '../ads';

export default function AdsSetup() {
  const showAds = useShowAds();
  const isOffline = useConnectivity((state) => state.isOffline);
  const canRequestAds = useAdConsent((state) => state.canRequestAds);

  /*
   * 동의를 묻는다. 아직 받지 못했으면 연결이 돌아올 때 다시 묻는다 -- 끊겨 있던 첫 실행에서
   * 묻지 못한 사람이 앱을 다시 켤 때까지 광고 없이 남지 않게.
   */
  useEffect(() => {
    if (!showAds || isOffline || canRequestAds) return;
    void gatherAdConsent();
  }, [showAds, isOffline, canRequestAds]);

  useEffect(() => {
    const unitId = AD_UNITS.interstitial;
    if (!showAds || !canRequestAds || !unitId) return;

    let stop: (() => void) | null = null;
    let cancelled = false;
    initAds()
      .then(() => {
        if (!cancelled) stop = startInterstitials(unitId);
      })
      .catch(() => {
        // SDK 를 깨우지 못했다. 광고 없이 쓴다 -- 광고 때문에 가계부가 멈춰서는 안 된다.
      });

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [showAds, canRequestAds]);

  return null;
}
