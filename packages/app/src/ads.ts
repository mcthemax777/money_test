/**
 * AdMob. 하단 배너와, 거래 저장 몇 번(core 의 INTERSTITIAL_EVERY)에 한 번 뜨는 전면광고.
 *
 * 띄울지는 core 의 `lib/ads` 가 정한다(지금 보는 가계부의 이용권이 무료일 때만). 여기는
 * SDK 를 깨우고 광고를 받아 두는 일만 한다.
 *
 * **광고 단위 id.** 개발 빌드는 Google 의 시험용 단위를 쓴다 -- 진짜 단위로 개발하면서
 * 광고를 누르면 계정이 정지될 수 있다. 출시 빌드는 아래 `RELEASE_AD_UNITS` 를 쓰고,
 * 비어 있으면 광고를 띄우지 않는다. AdMob 콘솔에서 만든 단위 id 를 거기 적는다. 앱 id 는
 * app.json 의 react-native-google-mobile-ads 플러그인 칸에 있다 (안드로이드는 실제 id, iOS 는 아직 시험용).
 *
 * **동의(EEA·영국 등).** 광고를 받기 전에 Google UMP 로 동의를 묻는다(`gatherAdConsent`).
 * 동의가 필요 없는 지역이면 아무 창도 뜨지 않고 바로 받을 수 있다. 창에 적히는 문구와 고를
 * 거리는 코드가 아니라 AdMob 콘솔의 "개인 정보 보호 및 메시지"에서 만든 GDPR 메시지다 --
 * 그 메시지를 게시하지 않으면 창이 뜨지 않고, 동의가 필요한 지역에서는 광고를 받을 수 없다.
 */
import mobileAds, {
  AdEventType,
  AdsConsent,
  AdsConsentPrivacyOptionsRequirementStatus,
  InterstitialAd,
  TestIds,
  type AdsConsentInfo,
} from 'react-native-google-mobile-ads';
import { create } from 'zustand';

import { setInterstitialPresenter } from '@money/core/lib/ads';

const RELEASE_AD_UNITS = {
  banner: 'ca-app-pub-3855040710986128/3981304072',
  interstitial: 'ca-app-pub-3855040710986128/1745103106',
};

/** 쓸 광고 단위. 출시 빌드에서 id 를 아직 적지 않았으면 null -- 그 광고는 띄우지 않는다. */
export const AD_UNITS = {
  banner: __DEV__ ? TestIds.ADAPTIVE_BANNER : RELEASE_AD_UNITS.banner || null,
  interstitial: __DEV__ ? TestIds.INTERSTITIAL : RELEASE_AD_UNITS.interstitial || null,
};

/** 받기에 실패하면 이만큼 쉬었다가 다시 받는다. 곧바로 되풀이하면 끊긴 동안 배터리만 먹는다. */
const RETRY_MS = 60_000;

/** 저장한 편집 창이 닫히는 것을 기다린다. 닫히는 도중에 광고를 덮으면 창이 남아 보인다. */
const SHOW_DELAY_MS = 400;

/** 띄우라고 한 뒤 이만큼 지나도 광고가 뜨지 않으면 뜨지 않은 것으로 본다. */
const OPEN_TIMEOUT_MS = 10_000;

interface AdConsentState {
  /** 동의 절차를 한 번 거쳤는가. 거치기 전에는 광고를 받지 않는다. */
  checked: boolean;
  /** 광고를 요청해도 되는가. 동의가 필요 없는 지역이거나, 필요한 지역에서 사용자가 답했다. */
  canRequestAds: boolean;
  /** 설정에 "광고 개인정보 옵션"을 세워야 하는가. 동의 창이 뜬 지역에서만 true 다. */
  privacyOptionsRequired: boolean;
}

/** 광고 동의 상태. 배너·전면광고·설정 화면이 함께 본다. 기기에 남기지 않는다 -- UMP 가 남긴다. */
export const useAdConsent = create<AdConsentState>(() => ({
  checked: false,
  canRequestAds: false,
  privacyOptionsRequired: false,
}));

function applyConsent(info: AdsConsentInfo): void {
  useAdConsent.setState({
    checked: true,
    canRequestAds: info.canRequestAds,
    privacyOptionsRequired:
      info.privacyOptionsRequirementStatus === AdsConsentPrivacyOptionsRequirementStatus.REQUIRED,
  });
}

let gathering: Promise<void> | null = null;

/**
 * 동의를 묻는다. 앱을 켠 뒤 한 번만 돈다(겹쳐 불러도 하나로 모인다).
 *
 * 필요한 지역이고 아직 답하지 않았으면 UMP 가 창을 띄운다. 끊겨 있어 묻지 못하면 지난번에
 * 받은 답으로 간다 -- 예전에 동의했으면 그대로 광고를 받고, 처음이면 받지 않는다.
 */
export function gatherAdConsent(): Promise<void> {
  if (!gathering) {
    gathering = AdsConsent.gatherConsent()
      .catch(() => AdsConsent.getConsentInfo())
      .then(applyConsent)
      .catch(() => {
        // 지난 답도 읽지 못했다. 광고 없이 쓴다 -- 동의 없이 받는 쪽이 더 나쁘다.
        useAdConsent.setState({ checked: true, canRequestAds: false, privacyOptionsRequired: false });
      })
      .finally(() => {
        // 다음에 다시 물을 수 있게 비운다 (끊겨서 지난 답으로 갔던 경우).
        gathering = null;
      });
  }
  return gathering;
}

/**
 * 동의를 바꾸는 창. 설정의 "광고 개인정보 옵션"이 연다.
 *
 * 거두면 canRequestAds 가 false 가 되어 배너가 접히고 전면광고를 내려놓는다(AdsSetup).
 */
export async function showAdPrivacyOptions(): Promise<void> {
  applyConsent(await AdsConsent.showPrivacyOptionsForm());
}

let initialized: Promise<void> | null = null;

/** SDK 를 한 번만 깨운다. 동의를 받은 뒤에만 부른다. 실패하면 다음에 다시 시도할 수 있게 비운다. */
export function initAds(): Promise<void> {
  if (!initialized) {
    initialized = mobileAds()
      .initialize()
      .then(() => undefined)
      .catch((error: unknown) => {
        initialized = null;
        throw error;
      });
  }
  return initialized;
}

/**
 * 전면광고를 받아 두고 core 에 꽂는다. 돌려주는 함수로 뺀다.
 *
 * 띄운 뒤에는 다음 것을 곧바로 받아 둔다. 그 횟수째 저장에서 그제야 받기 시작하면 그
 * 자리에서는 띄울 것이 없다.
 */
export function startInterstitials(unitId: string): () => void {
  const ad = InterstitialAd.createForAdRequest(unitId);
  let ready = false;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const load = () => {
    if (stopped) return;
    ready = false;
    ad.load();
  };

  const listeners = [
    ad.addAdEventListener(AdEventType.LOADED, () => {
      ready = true;
    }),
    ad.addAdEventListener(AdEventType.CLOSED, load),
    ad.addAdEventListener(AdEventType.ERROR, () => {
      ready = false;
      if (retry) clearTimeout(retry);
      retry = setTimeout(load, RETRY_MS);
    }),
  ];

  setInterstitialPresenter({
    isReady: () => ready && !stopped,
    show: () =>
      new Promise<boolean>((resolve) => {
        // 같은 광고를 두 번 띄우지 않게 지금 막아 둔다. 닫히면 CLOSED 가 다음 것을 받는다.
        ready = false;

        /*
         * 떴는지는 OPENED 이벤트로 판단한다. show() 의 약속이 풀리는 것은 "띄우라는 요청을
         * 넘겼다"일 뿐 화면에 떴다는 뜻이 아니다. 끝내 OPENED 가 오지 않으면(ERROR, 시간 초과)
         * 뜨지 않은 것으로 보고 횟수를 남긴다 -- 다음 저장에서 다시 띄운다.
         */
        let settled = false;
        const finish = (shown: boolean) => {
          if (settled) return;
          settled = true;
          /*
           * 뜨지 않았는데 광고가 아직 받아진 채면 다시 띄울 수 있다고 적어 둔다. 라이브러리는
           * 받아 둔 광고가 있으면 load() 를 무시해 LOADED 가 다시 오지 않으므로, 여기서 적지
           * 않으면 이 세션에서는 다시는 띄우지 못한다.
           */
          if (!shown) ready = ad.loaded && !stopped;
          removeOpened();
          removeError();
          clearTimeout(giveUp);
          resolve(shown);
        };
        const removeOpened = ad.addAdEventListener(AdEventType.OPENED, () => finish(true));
        const removeError = ad.addAdEventListener(AdEventType.ERROR, () => finish(false));
        const giveUp = setTimeout(() => finish(false), SHOW_DELAY_MS + OPEN_TIMEOUT_MS);

        setTimeout(() => {
          if (stopped) {
            finish(false);
            return;
          }
          ad.show().catch(() => {
            // 받아 둔 광고가 없었거나 이미 띄우는 중이었다. 새로 받아 두고 다음 저장을 기다린다.
            load();
            finish(false);
          });
        }, SHOW_DELAY_MS);
      }),
  });
  load();

  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    listeners.forEach((remove) => remove());
    setInterstitialPresenter(null);
  };
}
